// input/handpinch.js — input layer ด้วย MediaPipe Hand Landmarker (โหมด AR)
// ยิง event เดียวกับ pointer.js: onPick(x,y,slop) / onMove(x,y) / onRelease(x,y)
// เกมไม่รู้ว่า input มาจากนิ้วจริงหรือเมาส์ (สเปก §3.5)
//
// มาตรการสำหรับมือเด็ก (ดู .claude/skills/setup-ar):
//   - sticky hand lock  : เด็กหลายคนหน้ากล้อง → ล็อกมือเดียว ไม่สลับกลางทาง
//   - hysteresis        : จีบหลวมค่าแกว่ง → threshold เข้า/ออกคนละค่า
//   - EMA smoothing     : มือสั่น → กรองตำแหน่งก่อนส่งเข้าเกม
//   - magnet grab       : ส่ง GRAB_SLOP ให้ game.js ขยายรัศมีหยิบ
//   - hand-size normalize: เด็กยืนใกล้/ไกลกล้อง → pinch distance หารด้วยขนาดมือ

const PINCH_ON  = 0.30; // เริ่มจีบเมื่อ normDist ต่ำกว่านี้
const PINCH_OFF = 0.45; // ปล่อยเมื่อสูงกว่านี้ — ช่องว่างกันฟองหลุดๆ ติดๆ ตอนเด็กจีบหลวม
const PINCH_ON_FRAMES = 3; // ต้องจีบต่อเนื่อง 3 เฟรม (~100ms) ก่อนนับเป็นการหยิบ —
                           // false detection เฟรมเดียวเคยยิง pick+release ที่จุดเดิม
                           // = หย่อนฟองลงหม้อเอง เกมเล่นเองเป็นลูป (bug v119)
const SMOOTH    = 0.4;  // EMA alpha — ตอบสนองไวพอ แต่ตัด jitter ความถี่สูง
const DEAD_ZONE = 3;    // px หลัง smoothing
const GRAB_SLOP = 1.6;  // รัศมีหยิบขยายสำหรับ pinch (game.js onPick param ที่ 3)
const LOST_RESET = 15;  // ไม่เจอมือติดต่อกัน ~0.5 วิ → ปลด hand lock

async function initCamera(videoEl, onCameraLost) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', ''); // กัน fullscreen hijack บนมือถือ
    videoEl.muted = true;
    await videoEl.play();
    // Android ตัด camera track เงียบๆ เมื่อจอดับ/สลับแอป/มีสายเข้า —
    // ไม่ฟัง event นี้เกมจะค้างสภาพ "AR เปิดอยู่แต่มือใช้ไม่ได้"
    stream.getVideoTracks()[0].onended = () => onCameraLost && onCameraLost();
    return stream;
  } catch (err) {
    // NotAllowedError = ปฏิเสธ / NotFoundError = ไม่มีกล้อง → caller fallback pointer
    return null;
  }
}

async function loadHandLandmarker() {
  // dynamic import — offline/เน็ตหลุด ต้อง fail นุ่มนวล ไม่พาเกมหลัก (PWA) crash
  let bundle;
  try {
    bundle = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js'
    );
  } catch (err) {
    return null;
  }
  const { FilesetResolver, HandLandmarker } = bundle;
  try {
    const vision = await FilesetResolver.forVisionTasks('./public/models/wasm');
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: './public/models/hand_landmarker.task',
        delegate: 'GPU', // fallback CPU อัตโนมัติถ้า GPU ไม่พร้อม
      },
      runningMode: 'VIDEO', // IMAGE จะช้า 3–5x เพราะไม่ใช้ temporal tracking
      numHands: 2,          // ต้องเห็นทุกมือเพื่อทำ sticky lock — ตั้ง 1 แล้วมีเด็ก
                            // หลายคน MediaPipe จะสลับมือแบบสุ่ม ตัวชี้กระโดดข้ามจอ
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch (err) {
    return null; // โหลด wasm/model ไม่ได้ → fallback pointer
  }
}

export async function createHandPinchInput(fxCanvas, handlers, onCameraLost) {
  const videoEl = document.getElementById('camVideo');
  if (!videoEl) return null;

  const stream = await initCamera(videoEl, onCameraLost);
  if (!stream) return null;

  const landmarker = await loadHandLandmarker();
  if (!landmarker) {
    stream.getTracks().forEach((t) => t.stop());
    videoEl.srcObject = null;
    return null;
  }

  // ---- state ทั้งหมดอยู่ใน closure — สร้างใหม่หลัง destroy ได้เสมอ ----
  let running = true;
  let paused = false;
  let lastVideoTime = -1;
  let isPinching = false;
  let pinchFrames = 0;         // นับเฟรมจีบต่อเนื่อง — กัน phantom pinch เฟรมเดียว
  let lastX = 0, lastY = 0;
  let sx = 0, sy = 0;          // ตำแหน่งหลัง EMA smoothing
  let lockedWrist = null;      // ข้อมือของมือที่ล็อก จากเฟรมก่อน
  let lostFrames = 0;

  function handSizeOf(lm) {
    return Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
  }

  // sticky hand lock — คืน landmarks ของมือที่คุมเกม หรือ null ถ้ามือที่ล็อกหลุดเฟรม
  function selectHand(allHands) {
    if (allHands.length === 0) {
      if (++lostFrames >= LOST_RESET) lockedWrist = null;
      return null;
    }
    lostFrames = 0;

    if (lockedWrist) {
      let best = null, bestD = Infinity;
      for (const lm of allHands) {
        const d = Math.hypot(lm[0].x - lockedWrist.x, lm[0].y - lockedWrist.y);
        if (d < bestD) { bestD = d; best = lm; }
      }
      // ระหว่างลากฟองห้ามสลับมือเด็ดขาด — มือเดิมกระโดดไกลผิดปกติ = มือที่ล็อก
      // หลุดเฟรมและ best คือมือของเด็กอีกคน → ถือว่าไม่เจอมือ
      if (isPinching && bestD > 0.35) return null;
      lockedWrist = { x: best[0].x, y: best[0].y };
      return best;
    }

    // ยังไม่มี lock → เลือกมือใหญ่สุด (ใกล้กล้องสุด = คนที่กำลังเล่น)
    let best = allHands[0];
    for (const lm of allHands) {
      if (handSizeOf(lm) > handSizeOf(best)) best = lm;
    }
    lockedWrist = { x: best[0].x, y: best[0].y };
    return best;
  }

  // map พิกัด normalized ของ MediaPipe → CSS px บน canvas
  // camVideo แสดงแบบ object-fit:cover — ต้องใช้สูตร cover เดียวกับที่ browser
  // scale video ไม่งั้นตำแหน่งนิ้วบนจอเพี้ยนตามส่วนที่ถูก crop
  // (mirror ซ้าย-ขวาด้วย 1-nx เพราะกล้อง selfie; CSS ก็ scaleX(-1) ให้ภาพตรงกัน)
  function toCanvas(nx, ny, canvasW, canvasH) {
    const vidW = videoEl.videoWidth || 640;
    const vidH = videoEl.videoHeight || 480;
    const scale = Math.max(canvasW / vidW, canvasH / vidH);
    const dw = vidW * scale, dh = vidH * scale;
    return {
      x: (1 - nx) * dw - (dw - canvasW) / 2,
      y: ny * dh - (dh - canvasH) / 2,
    };
  }

  // pinch detection + hysteresis + hand-size normalization
  // ห้ามใช้ raw distance โดยไม่ normalize — เด็กยืนใกล้กล้องกว่าผู้ใหญ่ threshold ผิดเสมอ
  function getPinchState(lm, canvasW, canvasH) {
    const thumb = lm[4], index = lm[8], wrist = lm[0], mid = lm[9];
    const rawDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
    const handSize = Math.hypot(wrist.x - mid.x, wrist.y - mid.y);
    const normDist = handSize > 0.01 ? rawDist / handSize : rawDist;
    // hysteresis: threshold เข้า/ออกคนละค่า — ระหว่างกลางคงสถานะเดิม
    const pinching = isPinching ? normDist < PINCH_OFF : normDist < PINCH_ON;
    const { x, y } = toCanvas(index.x, index.y, canvasW, canvasH);
    return { pinching, x, y };
  }

  function forceRelease() {
    pinchFrames = 0;
    if (!isPinching) return;
    isPinching = false;
    handlers.onRelease && handlers.onRelease(lastX, lastY);
  }

  function updatePinchState(pinching, x, y) {
    // EMA smoothing ก่อนใช้พิกัดทุกครั้ง — ฟองไม่สั่นตามมือเด็ก
    sx += (x - sx) * SMOOTH;
    sy += (y - sy) * SMOOTH;

    if (pinching && !isPinching) {
      // ยืนยันจีบต่อเนื่องก่อนนับ — ตัด phantom pinch จาก false detection
      if (++pinchFrames < PINCH_ON_FRAMES) { lastX = sx; lastY = sy; return; }
      isPinching = true;
      sx = x; sy = y; // reset filter ตอนเริ่มจีบ กันตำแหน่งค้างจากรอบก่อน
      handlers.onPick && handlers.onPick(sx, sy, GRAB_SLOP);
    } else if (pinching && isPinching) {
      if (Math.hypot(sx - lastX, sy - lastY) > DEAD_ZONE) {
        handlers.onMove && handlers.onMove(sx, sy);
      }
    } else if (!pinching && isPinching) {
      isPinching = false;
      handlers.onRelease && handlers.onRelease(sx, sy);
    }
    if (!pinching) pinchFrames = 0;
    lastX = sx; lastY = sy;
  }

  function detectLoop() {
    if (!running) return; // destroy() แล้ว → จบ ไม่ schedule ต่อ

    if (!paused && !videoEl.paused && videoEl.currentTime !== lastVideoTime) {
      lastVideoTime = videoEl.currentTime;

      // อ่านขนาดสดทุกเฟรม — รองรับหมุนจอ/resize (ห้าม capture ครั้งเดียว)
      const canvasW = fxCanvas.clientWidth;
      const canvasH = fxCanvas.clientHeight;

      // detectForVideo ทำงานบน main thread ~5–15ms/frame
      const result = landmarker.detectForVideo(videoEl, performance.now());

      const hand = selectHand(result.landmarks);
      if (hand) {
        const { pinching, x, y } = getPinchState(hand, canvasW, canvasH);
        updatePinchState(pinching, x, y);
      } else {
        // ไม่เห็นมือ (หรือมือที่ล็อกหลุดเฟรม) → release ทันที
        // [decision 2026-07-02: ไม่ใช้ grace period — ฟองลอยกลับที่เดิม
        //  ซึ่ง game.js จัดการให้เมื่อ release นอกหม้อ]
        forceRelease();
      }
    }

    // sync กับ video frame จริง ลด inference ซ้ำซ้อน (fallback rAF)
    if ('requestVideoFrameCallback' in videoEl) {
      videoEl.requestVideoFrameCallback(detectLoop);
    } else {
      requestAnimationFrame(detectLoop);
    }
  }

  detectLoop();

  return {
    // ช่วง LISTENING (ไมค์ฟังเด็กอ่าน) — ข้าม inference คืน CPU ให้ Speech Recognition
    pause() {
      paused = true;
      forceRelease(); // กันฟองค้างมือระหว่างรอบฟังเสียง
    },
    resume() {
      paused = false;
    },
    destroy() {
      running = false; // หยุด loop ก่อน close — กันเรียก detect บน landmarker ที่ปิดแล้ว
      forceRelease();
      stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
      landmarker.close();
    },
  };
}
