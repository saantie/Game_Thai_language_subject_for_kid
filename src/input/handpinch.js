// input/handpinch.js — input layer ด้วย MediaPipe Hand Landmarker (โหมด AR)
// ยิง event เดียวกับ pointer.js: onPick(x,y,slop) / onMove(x,y) / onRelease(x,y)
// เกมไม่รู้ว่า input มาจากนิ้วจริงหรือเมาส์ (สเปก §3.5)
//
// ท่าจับ = "กำมือ" (fist) — ง่ายกว่าจีบสองนิ้วสำหรับเด็ก: กำ = หยิบ, แบ = ปล่อย
//
// มาตรการสำหรับมือเด็ก (ดู .claude/skills/setup-ar):
//   - sticky hand lock  : เด็กหลายคนหน้ากล้อง → ล็อกมือเดียว ไม่สลับกลางทาง
//   - hysteresis        : กำหลวมค่าแกว่ง → threshold เข้า/ออกคนละค่า
//   - grip confirmation : false detection เฟรมเดียว → ต้องกำต่อเนื่องก่อนนับ
//   - EMA smoothing     : มือสั่น → กรองตำแหน่งก่อนส่งเข้าเกม
//   - magnet grab       : ส่ง GRAB_SLOP ให้ game.js ขยายรัศมีหยิบ
//   - hand-size normalize: เด็กยืนใกล้/ไกลกล้อง → ระยะนิ้วหารด้วยขนาดมือ
//
// มาตรการเชิงระบบ (มือถือ):
//   - pause()/resume()  : เกม pause inference ช่วงที่ไม่ใช้มือ — ลดความร้อน
//   - visibilitychange  : สลับแอปแล้ว Android ตัดกล้องเงียบๆ (ไม่ยิง ended)
//                         → กลับมาแล้วขอกล้องใหม่อัตโนมัติ ใช้ landmarker เดิม
//   - watchdog          : requestVideoFrameCallback ตายเงียบเมื่อ video หยุด
//                         → ตรวจ loop stall ทุก 1 วิ แล้ว restart chain

// กำมือ: วัดค่าเฉลี่ยระยะ "ปลายนิ้ว 4 นิ้ว (ชี้/กลาง/นาง/ก้อย) → กลางฝ่ามือ"
// normalize ด้วยขนาดมือ — แบมือค่า ~1.0–1.4, กำมือค่า ~0.3–0.6
const GRIP_ON  = 0.60; // เริ่มกำเมื่อค่าเฉลี่ยต่ำกว่านี้
const GRIP_OFF = 0.85; // ปล่อยเมื่อสูงกว่านี้ — ช่องว่างกันฟองหลุดๆ ติดๆ ตอนเด็กกำหลวม
const GRIP_ON_FRAMES = 3; // ต้องกำต่อเนื่อง 3 เฟรม (~125ms @24fps) ก่อนนับเป็นการหยิบ —
                          // false detection เฟรมเดียวเคยยิง pick+release ที่จุดเดิม
                          // = หย่อนฟองลงหม้อเอง เกมเล่นเองเป็นลูป (bug v119)
const SMOOTH    = 0.4;  // EMA alpha — ตอบสนองไวพอ แต่ตัด jitter ความถี่สูง
const DEAD_ZONE = 3;    // px หลัง smoothing
const GRAB_SLOP = 1.6;  // รัศมีหยิบขยายสำหรับ pinch (game.js onPick param ที่ 3)
const LOST_RESET = 15;  // ไม่เจอมือติดต่อกัน ~0.5 วิ → ปลด hand lock

const CAM_CONSTRAINTS = {
  // 640×480@24 — พอสำหรับ hand landmark, ลดภาระ ISP/inference ลดความร้อนมือถือ
  video: { width: 640, height: 480, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
  audio: false,
};

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
  if (!videoEl || !navigator.mediaDevices?.getUserMedia) return null;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(CAM_CONSTRAINTS);
  } catch (err) {
    return null; // ปฏิเสธ/ไม่มีกล้อง → caller เล่นต่อด้วย touch ตามปกติ
  }
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', ''); // กัน fullscreen hijack บนมือถือ
  videoEl.muted = true;
  await videoEl.play().catch(() => {});

  const landmarker = await loadHandLandmarker();
  if (!landmarker) {
    stream.getTracks().forEach((t) => t.stop());
    videoEl.srcObject = null;
    return null;
  }

  // ---- state ทั้งหมดอยู่ใน closure — สร้างใหม่หลัง destroy ได้เสมอ ----
  let running = true;
  let paused = false;
  let recovering = false;
  let lastVideoTime = -1;
  let isGripping = false;
  let gripFrames = 0;          // นับเฟรมกำมือต่อเนื่อง — กัน phantom grip เฟรมเดียว
  let lastX = 0, lastY = 0;
  let sx = 0, sy = 0;          // ตำแหน่งหลัง EMA smoothing
  let lockedWrist = null;      // ข้อมือของมือที่ล็อก จากเฟรมก่อน
  let lostFrames = 0;
  let loopGen = 0;             // token กัน loop ซ้อนกันเมื่อ watchdog restart chain
  let lastTickTs = performance.now();

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
      if (isGripping && bestD > 0.35) return null;
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

  // grip (กำมือ) detection + hysteresis + hand-size normalization
  // ห้ามใช้ raw distance โดยไม่ normalize — เด็กยืนใกล้กล้องกว่าผู้ใหญ่ threshold ผิดเสมอ
  // landmark: 0=ข้อมือ, 9=กลางฝ่ามือ, ปลายนิ้ว 8=ชี้ 12=กลาง 16=นาง 20=ก้อย
  function getGripState(lm, canvasW, canvasH) {
    const wrist = lm[0], palm = lm[9];
    const handSize = Math.hypot(wrist.x - palm.x, wrist.y - palm.y);
    // ค่าเฉลี่ยระยะปลายนิ้ว→กลางฝ่ามือ (ไม่รวมนิ้วโป้ง — โป้งขยับน้อยตอนกำ)
    let sum = 0;
    for (const t of [8, 12, 16, 20]) {
      sum += Math.hypot(lm[t].x - palm.x, lm[t].y - palm.y);
    }
    const norm = handSize > 0.01 ? sum / 4 / handSize : sum / 4;
    // hysteresis: threshold เข้า/ออกคนละค่า — ระหว่างกลางคงสถานะเดิม
    const gripping = isGripping ? norm < GRIP_OFF : norm < GRIP_ON;
    // ตำแหน่งลาก = กลางฝ่ามือ (กำมือแล้วปลายนิ้วชี้หายไปในกำปั้น ใช้ไม่ได้)
    const { x, y } = toCanvas(palm.x, palm.y, canvasW, canvasH);
    return { gripping, x, y };
  }

  function forceRelease() {
    gripFrames = 0;
    if (!isGripping) return;
    isGripping = false;
    handlers.onRelease && handlers.onRelease(lastX, lastY);
  }

  function updateGripState(gripping, x, y) {
    // EMA smoothing ก่อนใช้พิกัดทุกครั้ง — ฟองไม่สั่นตามมือเด็ก
    sx += (x - sx) * SMOOTH;
    sy += (y - sy) * SMOOTH;

    if (gripping && !isGripping) {
      // ยืนยันกำต่อเนื่องก่อนนับ — ตัด phantom grip จาก false detection
      if (++gripFrames < GRIP_ON_FRAMES) { lastX = sx; lastY = sy; return; }
      isGripping = true;
      sx = x; sy = y; // reset filter ตอนเริ่มกำ กันตำแหน่งค้างจากรอบก่อน
      handlers.onPick && handlers.onPick(sx, sy, GRAB_SLOP);
    } else if (gripping && isGripping) {
      if (Math.hypot(sx - lastX, sy - lastY) > DEAD_ZONE) {
        handlers.onMove && handlers.onMove(sx, sy);
      }
    } else if (!gripping && isGripping) {
      isGripping = false;
      handlers.onRelease && handlers.onRelease(sx, sy);
    }
    if (!gripping) gripFrames = 0;
    lastX = sx; lastY = sy;
  }

  function detectLoop(gen) {
    if (!running || gen !== loopGen) return; // destroy แล้ว หรือ chain นี้ถูกแทนที่
    lastTickTs = performance.now();

    if (!paused && !videoEl.paused && videoEl.currentTime !== lastVideoTime) {
      lastVideoTime = videoEl.currentTime;

      // อ่านขนาดสดทุกเฟรม — รองรับหมุนจอ/resize (ห้าม capture ครั้งเดียว)
      const canvasW = fxCanvas.clientWidth;
      const canvasH = fxCanvas.clientHeight;

      // detectForVideo ทำงานบน main thread ~5–15ms/frame
      const result = landmarker.detectForVideo(videoEl, performance.now());

      const hand = selectHand(result.landmarks);
      if (hand) {
        const { gripping, x, y } = getGripState(hand, canvasW, canvasH);
        updateGripState(gripping, x, y);
      } else {
        // ไม่เห็นมือ (หรือมือที่ล็อกหลุดเฟรม) → release ทันที
        // [decision 2026-07-02: ไม่ใช้ grace period — ฟองลอยกลับที่เดิม
        //  ซึ่ง game.js จัดการให้เมื่อ release นอกหม้อ]
        forceRelease();
      }
    }

    // sync กับ video frame จริง ลด inference ซ้ำซ้อน (fallback rAF)
    if ('requestVideoFrameCallback' in videoEl) {
      videoEl.requestVideoFrameCallback(() => detectLoop(gen));
    } else {
      requestAnimationFrame(() => detectLoop(gen));
    }
  }

  function handleCameraLost() {
    forceRelease();
    onCameraLost && onCameraLost(); // main.js destroy + แจ้งผู้เล่นใช้ touch
  }

  // Android ตัด camera track เมื่อจอดับ/สลับแอป/มีสายเข้า — บางเครื่องยิง ended
  // บางเครื่องตายเงียบ (เจอจาก visibilitychange แทน)
  function handleTrackEnded() {
    if (!running) return;
    if (document.hidden) return; // ยังอยู่แอพอื่น — รอกู้คืนตอน visibilitychange
    reacquireCamera();
  }

  // ขอกล้องใหม่โดยใช้ landmarker เดิม (ไม่ต้องโหลด model ซ้ำ) — กู้คืนได้ใน ~1 วิ
  async function reacquireCamera() {
    if (recovering || !running) return;
    recovering = true;
    try {
      const s2 = await navigator.mediaDevices.getUserMedia(CAM_CONSTRAINTS);
      stream.getTracks().forEach((t) => t.stop());
      stream = s2;
      videoEl.srcObject = s2;
      await videoEl.play().catch(() => {});
      s2.getVideoTracks()[0].onended = handleTrackEnded;
      lastVideoTime = -1;
    } catch (err) {
      handleCameraLost(); // ขอใหม่ไม่ได้ (ถูกถอนสิทธิ์/กล้องถูกแอพอื่นยึด) → touch
    } finally {
      recovering = false;
    }
  }

  function onVisibility() {
    if (!running || document.hidden) return;
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended' || track.muted) {
      reacquireCamera(); // กลับมาจากแอพอื่นแล้วกล้องตาย → ขอใหม่
    } else {
      videoEl.play().catch(() => {}); // แค่ video ถูก pause → เล่นต่อ
    }
  }

  stream.getVideoTracks()[0].onended = handleTrackEnded;
  document.addEventListener('visibilitychange', onVisibility);

  // watchdog: requestVideoFrameCallback ไม่ fire เมื่อ video หยุดนิ่ง (กล้องถูกตัด)
  // → chain ตายเงียบแม้กล้องกลับมาแล้ว — ตรวจ stall แล้วเริ่ม chain ใหม่ (gen กันซ้อน)
  const watchdog = setInterval(() => {
    if (!running) return;
    if (performance.now() - lastTickTs > 2000) {
      loopGen++;
      detectLoop(loopGen);
    }
  }, 1000);

  detectLoop(loopGen);

  return {
    // เกม pause ช่วงที่ไม่ใช้มือ (READING/LISTENING/REWARD ฯลฯ) — ข้าม inference
    // ลดความร้อนมือถือ + คืน CPU ให้ Speech Recognition (กล้องยังเปิด ภาพไม่ค้าง)
    pause() {
      paused = true;
      forceRelease(); // กันฟองค้างมือ
    },
    resume() {
      paused = false;
    },
    destroy() {
      running = false; // หยุด loop ก่อน close — กันเรียก detect บน landmarker ที่ปิดแล้ว
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisibility);
      forceRelease();
      stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
      landmarker.close();
    },
  };
}
