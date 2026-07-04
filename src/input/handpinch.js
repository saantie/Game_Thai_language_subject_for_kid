// input/handpinch.js — input layer ด้วย MediaPipe Hand Landmarker (โหมด AR)
// ยิง event เดียวกับ pointer.js: onPick(x,y,slop) / onMove(x,y) / onRelease(x,y)
// เกมไม่รู้ว่า input มาจากนิ้วจริงหรือเมาส์ (สเปก §3.5)
//
// ท่าจับ = "จีบสองนิ้ว" (thumb+index pinch)
// [decision 2026-07-05: เคยลองเปลี่ยนเป็นกำมือ (fist) แล้วเพิ่มฟีเจอร์โยนด้วยแรงเหวี่ยง
//  แต่ทดสอบเครื่องจริงพบว่าท่าทางทั้งสองต้องตรวจจับละเอียดเกินไป ควบคุมยาก — กลับมา
//  ใช้จีบสองนิ้วซึ่งเสถียร/ควบคุมง่ายกว่า และตัดฟีเจอร์โยนออก]
//
// มาตรการสำหรับมือเด็ก (ดู .claude/skills/setup-ar):
//   - sticky hand lock  : เด็กหลายคนหน้ากล้อง → ล็อกมือเดียว ไม่สลับกลางทาง
//   - hysteresis        : จีบหลวมค่าแกว่ง → threshold เข้า/ออกคนละค่า
//   - pinch confirmation: false detection เฟรมเดียว → ต้องจีบ/ปล่อยต่อเนื่องก่อนนับ
//     (ทั้งสองทิศทาง — กันทั้ง phantom pick และ phantom release จาก landmark เพี้ยน
//     แวบเดียวตอนมือเอียงมุมกล้อง เช่นตอนเอื้อมลงใกล้หม้อ)
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

// จีบสองนิ้ว: distance(นิ้วโป้ง, นิ้วชี้) normalize ด้วยขนาดมือ (กัน scale variance)
const PINCH_ON  = 0.30;  // เริ่มจีบเมื่อ normDist ต่ำกว่านี้
const PINCH_OFF = 0.45;  // เลิกจีบเมื่อสูงกว่านี้ — hysteresis กันฟองหลุดๆ ติดๆ ตอนจีบหลวม
const PINCH_ON_FRAMES  = 3; // ต้องจีบต่อเนื่อง 3 เฟรม (~125ms @24fps) ก่อนนับเป็นการหยิบ —
                            // false detection เฟรมเดียวเคยยิง pick+release ที่จุดเดิม
                            // = หย่อนฟองลงหม้อเอง เกมเล่นเองเป็นลูป (bug v119)
const PINCH_OFF_FRAMES = 4; // ต้องเลิกจีบต่อเนื่อง 4 เฟรม (~165ms) ก่อนปล่อยจริง — กัน
                            // landmark เพี้ยนแวบเดียวตอนมือเอียง/คว่ำใกล้หม้อ (บทเรียน
                            // จากตอนใช้ท่ากำมือ — ปัญหาเดียวกันเกิดกับจีบได้เช่นกัน)
const SMOOTH    = 0.4;  // EMA alpha — ตอบสนองไวพอ แต่ตัด jitter ความถี่สูง
const DEAD_ZONE = 3;    // px หลัง smoothing
const GRAB_SLOP = 2.2;  // รัศมีหยิบขยายสำหรับ pinch (game.js onPick param ที่ 3) — แม่เหล็ก
                        // ดูดฟองเข้าหานิ้วตอนจีบ (กันจีบพลาดฟองบ่อยจากนิ้วเด็ก+ความคลาด
                        // ของ landmark)
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
  let isPinching = false;
  let pinchOnFrames = 0;       // นับเฟรมจีบต่อเนื่อง — กัน phantom pick เฟรมเดียว
  let pinchOffFrames = 0;      // นับเฟรมเลิกจีบต่อเนื่อง — กัน phantom release เฟรมเดียว
  let lastX = 0, lastY = 0;
  let sx = 0, sy = 0;          // ตำแหน่งหลัง EMA smoothing
  let lockedWrist = null;      // ข้อมือของมือที่ล็อก จากเฟรมก่อน
  let lostFrames = 0;
  let loopGen = 0;             // token กัน loop ซ้อนกันเมื่อ watchdog restart chain
  let lastTickTs = performance.now();

  function handSizeOf(lm) {
    return Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
  }

  // sticky hand lock — คืน { lm, idx } ของมือที่คุมเกม หรือ null ถ้ามือที่ล็อกหลุดเฟรม
  // ต้องคืน idx ด้วย (ไม่ใช่แค่ landmarks) เพื่อจับคู่กับ result.handednesses[idx]
  // สำหรับคำนวณทิศฝ่ามือ (ดู palmUpScore)
  function selectHand(result) {
    const hands = result.landmarks;
    if (!hands || hands.length === 0) {
      if (++lostFrames >= LOST_RESET) lockedWrist = null;
      return null;
    }
    lostFrames = 0;

    if (lockedWrist) {
      let bestIdx = -1, bestD = Infinity;
      hands.forEach((lm, i) => {
        const d = Math.hypot(lm[0].x - lockedWrist.x, lm[0].y - lockedWrist.y);
        if (d < bestD) { bestD = d; bestIdx = i; }
      });
      // ระหว่างลากฟองห้ามสลับมือเด็ดขาด — มือเดิมกระโดดไกลผิดปกติ = มือที่ล็อก
      // หลุดเฟรมและ best คือมือของเด็กอีกคน → ถือว่าไม่เจอมือ
      if (isPinching && bestD > 0.35) return null;
      lockedWrist = { x: hands[bestIdx][0].x, y: hands[bestIdx][0].y };
      return { lm: hands[bestIdx], idx: bestIdx };
    }

    // ยังไม่มี lock → เลือกมือใหญ่สุด (ใกล้กล้องสุด = คนที่กำลังเล่น)
    let bestIdx = 0;
    hands.forEach((lm, i) => { if (handSizeOf(lm) > handSizeOf(hands[bestIdx])) bestIdx = i; });
    lockedWrist = { x: hands[bestIdx][0].x, y: hands[bestIdx][0].y };
    return { lm: hands[bestIdx], idx: bestIdx };
  }

  // ทิศฝ่ามือ ("หงายมือ" สำหรับเดาะฟองลอยขึ้น/ประกายดาว): cross product 2D ของเวกเตอร์
  // wrist→index_mcp(5) และ wrist→pinky_mcp(17) บอกทิศที่ฝ่ามือหันเทียบกล้อง (แนวคิด
  // เดียวกับ backface culling ใน 2D) กลับเครื่องหมายกันมือซ้าย/ขวา (เป็นภาพกระจกกัน)
  // [ยังไม่ผ่านทดสอบเครื่องจริง — ถ้าเดาะแล้วฟองไม่ลอยขึ้น/ทิศกลับด้าน ให้ negate ค่านี้]
  function palmUpScore(lm, handLabel) {
    const wrist = lm[0], idxMcp = lm[5], pinkyMcp = lm[17];
    const v1x = idxMcp.x - wrist.x, v1y = idxMcp.y - wrist.y;
    const v2x = pinkyMcp.x - wrist.x, v2y = pinkyMcp.y - wrist.y;
    let cross = v1x * v2y - v1y * v2x;
    if (handLabel === 'Left') cross = -cross;
    return cross;
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
  // landmark: 4=ปลายนิ้วโป้ง 8=ปลายนิ้วชี้ 0=ข้อมือ 9=กลางฝ่ามือ
  function getPinchState(lm, canvasW, canvasH) {
    const thumb = lm[4], index = lm[8], wrist = lm[0], mid = lm[9];
    const rawDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
    const handSize = Math.hypot(wrist.x - mid.x, wrist.y - mid.y);
    const normDist = handSize > 0.01 ? rawDist / handSize : rawDist;
    // hysteresis: threshold เข้า/ออกคนละค่า — ระหว่างกลางคงสถานะเดิม
    const pinching = isPinching ? normDist < PINCH_OFF : normDist < PINCH_ON;
    // ตำแหน่งลาก = ปลายนิ้วชี้ (ตรงกับที่เด็กมองว่า "นิ้วอยู่ตรงไหน" ตอนจีบ)
    const { x, y } = toCanvas(index.x, index.y, canvasW, canvasH);
    return { pinching, x, y };
  }

  function forceRelease() {
    pinchOnFrames = 0;
    pinchOffFrames = 0;
    if (!isPinching) return;
    isPinching = false;
    handlers.onRelease && handlers.onRelease(lastX, lastY);
  }

  function updatePinchState(pinching, x, y) {
    // EMA smoothing ก่อนใช้พิกัดทุกครั้ง — ฟองไม่สั่นตามมือเด็ก
    sx += (x - sx) * SMOOTH;
    sy += (y - sy) * SMOOTH;

    if (pinching && !isPinching) {
      // ยืนยันจีบต่อเนื่องก่อนนับ — ตัด phantom pick จาก false detection
      if (++pinchOnFrames < PINCH_ON_FRAMES) { lastX = sx; lastY = sy; return; }
      isPinching = true;
      sx = x; sy = y; // reset filter ตอนเริ่มจีบ กันตำแหน่งค้างจากรอบก่อน
      handlers.onPick && handlers.onPick(sx, sy, GRAB_SLOP);
    } else if (pinching && isPinching) {
      if (Math.hypot(sx - lastX, sy - lastY) > DEAD_ZONE) {
        handlers.onMove && handlers.onMove(sx, sy);
      }
    } else if (!pinching && isPinching) {
      // ยืนยันเลิกจีบต่อเนื่องก่อนปล่อยจริง — ตัด phantom release จาก landmark
      // เพี้ยนแวบเดียว (พบจริงตอนใช้ท่ากำมือ: มือเอียง/คว่ำตอนเอื้อมลงใกล้หม้อ
      // ทำให้ normDist พุ่งผิดๆ จากมุมกล้อง ไม่ใช่ปล่อยจริง)
      if (++pinchOffFrames < PINCH_OFF_FRAMES) { lastX = sx; lastY = sy; return; }
      isPinching = false;
      handlers.onRelease && handlers.onRelease(sx, sy);
    }
    if (pinching) pinchOffFrames = 0;   // ยังจีบอยู่ปกติ → รีเซ็ตนับเลิกจีบ
    if (!pinching) pinchOnFrames = 0;   // ยังไม่จีบ (หรือจีบไม่ต่อเนื่องพอ) → รีเซ็ตนับจีบ
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

      const hand = selectHand(result);
      if (hand) {
        const { pinching, x, y } = getPinchState(hand.lm, canvasW, canvasH);
        updatePinchState(pinching, x, y);

        // ส่งเฟรมมือดิบทุกเฟรมที่เจอมือ (ไม่ขึ้นกับ pinch state) ให้ game.js ทำ
        // star trail ตอนมือเปิด + เดาะฟองลอยขึ้นตอนหงายมือ — pointer.js ไม่มี concept นี้
        const handLabel = result.handednesses?.[hand.idx]?.[0]?.categoryName;
        const palmUp = palmUpScore(hand.lm, handLabel) > 0;
        handlers.onHandFrame && handlers.onHandFrame({
          x, y, open: !isPinching, spread: !isPinching, palmUp,
        });
      } else {
        // ไม่เห็นมือ (หรือมือที่ล็อกหลุดเฟรม) → release ทันที
        // [decision 2026-07-02: ไม่ใช้ grace period — ฟองลอยกลับที่เดิม
        //  ซึ่ง game.js จัดการให้เมื่อ release นอกหม้อ]
        forceRelease();
        handlers.onHandFrame && handlers.onHandFrame(null);
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
      handlers.onHandFrame && handlers.onHandFrame(null); // เคลียร์ _handPrev ฝั่ง game.js
      stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
      landmarker.close();
    },
  };
}
