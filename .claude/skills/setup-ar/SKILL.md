---
description: step-by-step guide implement handpinch.js ด้วย MediaPipe Hand Landmarker — camera permission, sticky hand lock (กันหลายมือ/หลายเด็ก), จับด้วยการจีบสองนิ้ว (thumb+index) + hysteresis + confirmation ทั้งสองทิศทาง + smoothing สำหรับมือเด็ก, hand-size normalization, magnet grab + drag guard, hybrid touch+AR, ปุ่มเปิด/ปิด AR หน้าแรก, กู้คืนกล้องอัตโนมัติหลังสลับแอป, pause ตาม state ลดความร้อนมือถือ
---

# /setup-ar

Implement `src/input/handpinch.js` ให้ emit `onPick/onMove/onRelease` เหมือน `pointer.js`
ทำให้ `game.js` ไม่รู้ว่า input มาจากนิ้วจริงหรือเมาส์ (interface เดียวกันตามสเปก §3.5)

**ท่าจับ = จีบสองนิ้ว (thumb+index pinch)** [decision 2026-07-05]: เคยลองเปลี่ยนเป็น
กำมือ (fist) แล้วเพิ่มฟีเจอร์โยนด้วยแรงเหวี่ยง แต่ทดสอบเครื่องจริงพบว่าทั้งสองท่าทาง
ต้องตรวจจับละเอียดเกินไป ควบคุมยาก — กลับมาใช้จีบสองนิ้วซึ่งเสถียร/ควบคุมง่ายกว่า
และตัดฟีเจอร์โยนออก (อย่า implement ท่ากำมือหรือฟีเจอร์โยนอีกโดยไม่ปรึกษาก่อน)

**ออกแบบสำหรับผู้เล่นเด็ก** — คู่มือนี้รวมมาตรการกันบั๊กจากพฤติกรรมเด็กจริง:
- เด็กหลายคน (หลายมือ) หน้ากล้องพร้อมกัน → sticky hand lock (Step 3ก)
- จีบนิ้วหลวม/ไม่แน่น → hysteresis สองระดับ (Step 3ข)
- false detection เฟรมเดียวทำเกม "เล่นเอง" → pinch confirmation ทั้งสองทิศทาง
  (Step 5) + drop ต้องลากจริง (Step 5.5) [บทเรียน bug v119 และ v125]
- มือสั่น → EMA smoothing (Step 5)
- จีบไม่โดนฟองพอดี → magnet grab + สแนปติดมือทันทีตอนหยิบ (Step 5.5)
- เด็กเผลอจิ้มจอ → hybrid: touch ใช้ได้ควบคู่ AR เสมอ (Step 6)

และมาตรการกันบั๊กเชิงระบบ:
- หมุนจอ/resize → อ่านขนาด canvas ทุกเฟรม (Step 4)
- สลับแอป/จอดับแล้ว Android ตัดกล้อง **แบบตายเงียบไม่ยิง ended** →
  visibilitychange + watchdog ขอกล้องใหม่อัตโนมัติ ใช้ landmarker เดิม (Step 1)
- offline → import CDN ล้มเหลวแบบนุ่มนวล ไม่ crash (Step 2)
- มือถือร้อนจาก inference ตลอดเวลา → pause ทุก state ที่ไม่ใช้มือ ผูกกับ setState
  ของเกม + กล้อง 24fps (Step 4 + 6) [บทเรียนทดสอบเครื่องจริง v120]

อุปกรณ์เป้าหมาย: **มือถือ Android** และ **โน้ตบุ๊ก/PC + webcam** (ไม่ใช่ iPad — ไม่ต้องใส่ workaround iOS-specific นอกจาก playsinline พื้นฐาน)

---

## ก่อนเริ่ม — Prerequisites

1. ตรวจว่ามีไฟล์ MediaPipe WASM + model ใน `public/models/`:
   ```
   public/models/hand_landmarker.task
   public/models/wasm/                 ← vision_wasm_internal.js + .wasm
   ```
   ถ้าไม่มี — แจ้งวิธีดาวน์โหลดจาก MediaPipe CDN และหยุด รอให้ไฟล์พร้อมก่อน

2. ตรวจว่า `index.html` มี `<video id="camVideo">` สำหรับ AR overlay (สเปก §0 layer [1])
   ถ้าไม่มี — เพิ่มก่อนเริ่ม implement

---

## Step 1 — Camera permission flow

**ลำดับการขอ permission สำคัญ:** เกมขอไมค์อยู่แล้วตอนกด "เริ่มเล่น"
(`audio.requestMicPermission()` ใน `src/audio.js` ~บรรทัด 80) — ต้อง init กล้อง
**หลัง** promise ของไมค์ resolve เสร็จ ภายใน user gesture เดียวกัน:

```js
// main.js — ใน startBtn.onclick
await audio.requestMicPermission();       // ไมค์ก่อน
const arInput = await createHandPinchInput(scene.fxCanvas, handlers);  // แล้วค่อยกล้อง
```

ห้ามยิงสองคำขอพร้อมกัน — Android บางรุ่น prompt ซ้อนกันแล้วอันแรกถูก dismiss อัตโนมัติ

Camera constraints ใน `handpinch.js`:

```js
const CAM_CONSTRAINTS = {
  // 640×480@24 — พอสำหรับ hand landmark, ลดภาระ ISP/inference ลดความร้อนมือถือ
  video: { width: 640, height: 480, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
  audio: false,
};
```

**สำคัญ:** ถ้าขอกล้องไม่ได้ (`NotAllowedError`/`NotFoundError`) ให้คืน `null` แล้ว
เกมเล่นต่อด้วย touch อัตโนมัติ — อย่า throw ให้ game crash, AR เป็น optional feature
และใส่ `playsinline` + `muted` ที่ videoEl กัน fullscreen hijack บนมือถือ

### กู้คืนเมื่อกล้องถูกตัด (สลับแอป/จอดับ/สายเข้า) — บทเรียนเครื่องจริง

Android ตัด camera track เมื่อผู้ใช้สลับไปแอพอื่น และ **หลายเครื่องตัดแบบตายเงียบ
ไม่ยิง event `ended`** — กลับเข้าเกมแล้วภาพค้าง เล่น AR ต่อไม่ได้ ต้องมี 3 ชั้น:

```js
// ชั้น 1: track.onended (เครื่องที่ยิง event) — ถ้ายัง hidden อยู่ให้รอ ไม่ขอกล้องซ้อน
track.onended = () => { if (!document.hidden) reacquireCamera(); };

// ชั้น 2: visibilitychange — กลับเข้าแอพ เช็ค track ตายไหม (ended/muted) → ขอใหม่
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const t = stream.getVideoTracks()[0];
  if (!t || t.readyState === 'ended' || t.muted) reacquireCamera();
  else videoEl.play().catch(() => {});          // แค่ video pause → เล่นต่อ
});

// reacquireCamera: getUserMedia ใหม่ + สลับ srcObject — ใช้ landmarker เดิม
// (ไม่โหลด model ซ้ำ กู้คืนได้ ~1 วิ) ถ้าขอไม่ได้จริง → onCameraLost → touch
```

**ชั้น 3 — watchdog:** `requestVideoFrameCallback` จะ**ไม่ fire อีกเลย**เมื่อ video
หยุดนิ่ง → detect chain ตายเงียบแม้กล้องกลับมาแล้ว ต้องมี `setInterval` ตรวจทุก 1 วิ
ว่า loop เดินอยู่ไหม (เทียบ timestamp ล่าสุด > 2 วิ = stall) แล้วเริ่ม chain ใหม่
พร้อม generation token กัน chain เก่าที่ค้างอยู่กลับมาซ้อน

เมื่อ `onCameraLost` ถูกเรียก (กู้ไม่ได้จริง ๆ) main.js ต้อง `destroy()` ตัว AR input
+ เสียงแม่มดแจ้งสั้น ๆ ("ใช้นิ้วจิ้มจอแทนได้เลยจ้ะ") — touch ยังทำงานเพราะ hybrid (Step 6)

---

## Step 2 — Load MediaPipe HandLandmarker

**ห้ามใช้ static import จาก CDN** — เกมเป็น PWA ที่ต้องเปิด offline ได้ ถ้า static import
แล้วไม่มีเน็ต ทั้งโมดูลจะพัง ต้องใช้ dynamic `import()` ใน try/catch:

```js
async function loadHandLandmarker() {
  let vision_bundle;
  try {
    vision_bundle = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js');
  } catch (err) {
    return null;   // offline / เน็ตหลุด → caller fallback pointer, เกมหลักเล่นต่อได้
  }
  const { FilesetResolver, HandLandmarker } = vision_bundle;

  const vision = await FilesetResolver.forVisionTasks('./models/wasm/');
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: './models/hand_landmarker.task',
      delegate: 'GPU',              // fallback CPU อัตโนมัติถ้า GPU ไม่พร้อม
    },
    runningMode: 'VIDEO',           // ไม่ใช่ IMAGE — สำคัญมาก
    numHands: 2,                    // ★ ต้องเห็นทุกมือเพื่อทำ sticky lock (Step 3ก)
                                    //   ถ้าตั้ง 1 แล้วมีเด็กหลายคนหน้ากล้อง MediaPipe
                                    //   จะสลับมือเองแบบสุ่ม → ตัวชี้กระโดดข้ามจอ
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}
```

**Limitation ที่ยอมรับแล้ว:** AR mode ต้องมีเน็ตตอนโหลดครั้งแรก (bundle มาจาก CDN)
— offline เกมยังเล่นได้ปกติด้วย touch/pointer ห้ามค้างจอโหลดหรือ crash

**อย่าใช้ `runningMode: 'IMAGE'`** — inference จะช้าลง 3–5x เพราะไม่ใช้ temporal tracking

**หมายเหตุ PC webcam:** เด็กมักยืนไกลกล้อง มือเล็กในเฟรม — ถ้า detection หลุดบ่อย
ลด `minHandDetectionConfidence` เป็น 0.5 ได้ (hand-size normalization ใน Step 3
ชดเชยเรื่อง threshold ให้แล้ว ไม่ต้องกลัว pinch เพี้ยน)

---

## Step 3 — Sticky hand lock + Pinch hysteresis (สเปก §3.5)

### 3ก) Sticky hand selection — กันหลายมือ/หลายเด็ก

เมื่อ `numHands: 2` ผลลัพธ์อาจมีหลายมือ ต้องเลือก **มือเดียว** และล็อกไว้:

```js
let lockedWrist = null;   // ตำแหน่งข้อมือมือที่ล็อก จากเฟรมก่อน
let lostFrames = 0;
const LOST_RESET = 15;    // ไม่เจอมือเลย ~0.5 วิ → ปลด lock

function handSizeOf(lm) {
  return Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
}

// คืน { lm, idx } ของมือที่ควรคุมเกม หรือ null ถ้ามือที่ล็อกหลุดเฟรม — ต้องคืน idx
// ด้วยเพื่อจับคู่กับ result.handednesses[idx] (ใช้ใน palmUpScore ท้ายไฟล์)
function selectHand(result) {
  const hands = result.landmarks;
  if (!hands || hands.length === 0) {
    if (++lostFrames >= LOST_RESET) lockedWrist = null;
    return null;
  }
  lostFrames = 0;

  if (lockedWrist) {
    // เลือกมือที่ข้อมือใกล้ตำแหน่งเดิมที่สุด (มือเดียวกับเฟรมก่อน)
    let bestIdx = -1, bestD = Infinity;
    hands.forEach((lm, i) => {
      const d = Math.hypot(lm[0].x - lockedWrist.x, lm[0].y - lockedWrist.y);
      if (d < bestD) { bestD = d; bestIdx = i; }
    });
    // ★ ระหว่างลากฟอง (isPinching) ห้ามสลับไปมืออื่นเด็ดขาด —
    //   ถ้ามือเดิมกระโดดไปไกลผิดปกติ แปลว่ามือที่ล็อกหลุดเฟรม
    //   และ best คือมือของเด็กอีกคน → ถือว่าไม่เจอมือ
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
```

### 3ข) Pinch detection + hysteresis + hand-size normalization

นี่คือจุดที่สเปกเตือนไว้โดยเฉพาะ:

```js
// landmark index:  4 = นิ้วโป้งปลาย, 8 = นิ้วชี้ปลาย, 0 = ข้อมือ, 9 = กลางฝ่ามือ
const PINCH_ON  = 0.30;   // เริ่มจีบเมื่อ normDist ต่ำกว่านี้
const PINCH_OFF = 0.45;   // เลิกจีบเมื่อ normDist สูงกว่านี้ — ช่องว่าง 0.30–0.45
                          // กันเด็กจีบหลวมแล้วฟองหลุด ๆ ติด ๆ กลางทาง (rapid pick/release)

function getPinchState(lm, canvasW, canvasH) {
  const thumb = lm[4], index = lm[8], wrist = lm[0], mid = lm[9];

  // raw distance นิ้วโป้ง-ชี้ (normalized 0–1 ใน MediaPipe space)
  const rawDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);

  // hand size = ระยะข้อมือถึงกลางฝ่ามือ (normalize กัน scale variance จากระยะกล้อง)
  const handSize = Math.hypot(wrist.x - mid.x, wrist.y - mid.y);
  const normDist = handSize > 0.01 ? rawDist / handSize : rawDist;

  // hysteresis: threshold เข้า/ออกคนละค่า — ระหว่างกลางคงสถานะเดิม
  const pinching = isPinching ? normDist < PINCH_OFF : normDist < PINCH_ON;

  // ตำแหน่งลาก = ปลายนิ้วชี้ (ตรงกับที่เด็กมองว่า "นิ้วอยู่ตรงไหน" ตอนจีบ)
  const { x, y } = toCanvas(index.x, index.y, canvasW, canvasH); // ดูสูตร cover ที่ Step 6
  return { pinching, x, y };
}
```

**ห้ามใช้ raw distance โดยไม่ normalize** — เด็กยืนใกล้กล้องกว่าผู้ใหญ่ threshold จะผิดเสมอ

**ห้ามใช้ threshold เดี่ยว** (เช่น `normDist < 0.35` ทั้งเข้าและออก) — มือเด็กจีบไม่แน่น
ค่า distance จะแกว่งรอบ threshold ทำให้หยิบ-หลุดรัว ๆ ฟองร่วงกลางทาง

---

## Step 4 — Inference loop (ต้องไม่บล็อก game loop และหยุด/ทำลายได้จริง)

3 กติกาที่ห้ามพลาด:
1. **`running` flag** — `destroy()` ต้องหยุด loop ได้ ไม่งั้นเฟรมถัดไปจะเรียก
   `detectForVideo` บน landmarker ที่ `close()` ไปแล้ว = throw
2. **อ่านขนาด canvas ทุกเฟรม** — ห้าม capture `canvasW/H` ครั้งเดียวตอนสร้าง
   เด็กหมุนมือถือแนวตั้ง↔แนวนอนแล้วพิกัดจะเพี้ยนถาวรทั้งจอ
3. **`paused` flag** — ช่วง LISTENING (ไมค์ฟังเด็กอ่าน) ต้องข้าม inference
   คืน CPU ให้ Speech Recognition บน Android เครื่องอ่อน (ช่วงนั้นไม่ใช้มืออยู่แล้ว)

```js
let running = true;
let paused = false;
let lastVideoTime = -1;

function detectLoop(gen) {
  if (!running || gen !== loopGen) return;     // destroy() แล้ว → จบ ไม่ schedule ต่อ

  if (!paused && !videoEl.paused && videoEl.currentTime !== lastVideoTime) {
    lastVideoTime = videoEl.currentTime;

    // อ่านขนาดสด ๆ ทุกเฟรม — รองรับหมุนจอ/resize
    const canvasW = fxCanvas.clientWidth;
    const canvasH = fxCanvas.clientHeight;

    // detectForVideo ทำงานบน main thread แต่ใช้เวลา ~5–15ms/frame
    const result = landmarker.detectForVideo(videoEl, performance.now());

    const hand = selectHand(result);             // sticky lock จาก Step 3ก
    if (hand) {
      const { pinching, x, y } = getPinchState(hand.lm, canvasW, canvasH);
      updatePinchState(pinching, x, y);
    } else {
      // ไม่เห็นมือ (หรือมือที่ล็อกหลุดเฟรม) → release ทันที
      // [decision เคาะแล้ว 2026-07-02: ไม่ใช้ grace period — ฟองลอยกลับที่เดิม
      //  ซึ่ง game.js จัดการให้อยู่แล้วเมื่อ release นอกหม้อ]
      forceRelease();
    }
  }

  // ใช้ requestVideoFrameCallback แทน rAF ถ้า browser รองรับ
  // (sync กับ video frame จริง ลด redundant inference)
  if ('requestVideoFrameCallback' in videoEl) {
    videoEl.requestVideoFrameCallback(() => detectLoop(gen));
  } else {
    requestAnimationFrame(() => detectLoop(gen));
  }
}
```

---

## Step 5 — Pinch state machine + smoothing → emit events

มือเด็กสั่นมากกว่าผู้ใหญ่ — ส่งพิกัดดิบเข้าเกมฟองจะสั่นตาม ต้อง smooth ก่อน:

```js
let isPinching = false;
let pinchOnFrames = 0;         // นับเฟรมจีบต่อเนื่อง — กัน phantom pick เฟรมเดียว
let pinchOffFrames = 0;        // นับเฟรมเลิกจีบต่อเนื่อง — กัน phantom release เฟรมเดียว
let lastX = 0, lastY = 0;
let sx = 0, sy = 0;            // ตำแหน่งหลัง smoothing
const SMOOTH = 0.4;            // EMA alpha — 0.4 ตอบสนองไวพอ แต่ตัด jitter ความถี่สูง
const DEAD_ZONE = 3;           // px หลัง smoothing แล้ว
const GRAB_SLOP = 2.2;         // รัศมีหยิบขยายสำหรับ pinch (magnet grab, Step 5.5)
const PINCH_ON_FRAMES  = 3;    // ★ ต้องจีบต่อเนื่อง 3 เฟรมก่อนนับ — ดูคำเตือนล่างสุด
const PINCH_OFF_FRAMES = 4;    // ★ ต้องเลิกจีบต่อเนื่อง 4 เฟรมก่อนปล่อยจริง — ดูคำเตือน

function updatePinchState(pinching, x, y) {
  // EMA smoothing ก่อนใช้พิกัดทุกครั้ง
  sx += (x - sx) * SMOOTH;
  sy += (y - sy) * SMOOTH;

  if (pinching && !isPinching) {
    // ยืนยันจีบต่อเนื่องก่อนนับ — ตัด phantom pick จาก false detection
    if (++pinchOnFrames < PINCH_ON_FRAMES) { lastX = sx; lastY = sy; return; }
    isPinching = true;
    sx = x; sy = y;            // reset filter ตอนเริ่มจีบ กันตำแหน่งค้างจากรอบก่อน
    handlers.onPick && handlers.onPick(sx, sy, GRAB_SLOP);   // ★ ส่ง slop เป็น param ที่ 3
  } else if (pinching && isPinching) {
    if (Math.hypot(sx - lastX, sy - lastY) > DEAD_ZONE) {
      handlers.onMove && handlers.onMove(sx, sy);
    }
  } else if (!pinching && isPinching) {
    // ยืนยันเลิกจีบต่อเนื่องก่อนปล่อยจริง — ตัด phantom release จาก landmark
    // เพี้ยนแวบเดียว (พบจริงตอนใช้ท่ากำมือ: มือเอียง/คว่ำตอนเอื้อมลงใกล้หม้อ
    // ทำให้ normDist พุ่งผิดๆ จากมุมกล้อง ไม่ใช่ปล่อยจริง — ปัญหาเดียวกันเกิดกับ
    // จีบได้ จึงคงมาตรการนี้ไว้แม้กลับมาใช้จีบแล้ว)
    if (++pinchOffFrames < PINCH_OFF_FRAMES) { lastX = sx; lastY = sy; return; }
    isPinching = false;
    handlers.onRelease && handlers.onRelease(sx, sy);
  }
  if (pinching) pinchOffFrames = 0;   // ยังจีบอยู่ปกติ → รีเซ็ตนับเลิกจีบ
  if (!pinching) pinchOnFrames = 0;   // ยังไม่จีบ (หรือจีบไม่ต่อเนื่องพอ) → รีเซ็ตนับจีบ
  lastX = sx; lastY = sy;
}
```

**⚠️ ห้ามตัด pinch confirmation ออกทั้งสองทิศทาง** (ตอนออกแบบครั้งแรกเคยตัดฝั่งจับ
เพราะกลัวหน่วง — ผิดพลาด, ภายหลังพบว่าฝั่งปล่อยก็ต้องมี confirmation เช่นกัน):
- **ฝั่งจับ:** false detection ของ MediaPipe เฟรมเดียวจะยิง pick+release ที่จุดเดิมทันที
  ถ้าฟองลอยซ้อน drop zone ของหม้อ = หย่อนเอง → เกมเข้ารอบอ่าน-เปิดไมค์-จบรอบวนเอง
  ไม่หยุด "แม่มดพูดรัว ไมค์เด้งรัว" (bug จริง v119)
- **ฝั่งปล่อย:** มือเอียง/คว่ำตอนเอื้อมลงใกล้หม้อทำให้ landmark เพี้ยนแวบเดียว
  normDist พุ่งเกิน PINCH_OFF ผิดๆ (ไม่ใช่เลิกจีบจริง) ฟองหลุดเองผิดจังหวะ (บทเรียน
  จากตอนทดลองใช้ท่ากำมือ v125 — ปัญหาเดียวกันเกิดกับจีบได้)
- 3–4 เฟรม @24fps = ~125–165ms เด็กไม่รู้สึกหน่วง

**ทำไมส่ง slop เป็น parameter ไม่ใช่ flag โหมด:** touch กับ pinch ทำงานพร้อมกัน
(hybrid, Step 6) — flag เดียวแบบ `app.inputIsHand` แยกไม่ออกว่า event นี้มาจากแหล่งไหน
pointer.js ไม่ต้องแก้อะไร (ไม่ส่ง param ที่ 3 → game.js default 1.0 = พฤติกรรมเดิมเป๊ะ)

---

## Step 5.5 — Magnet grab ใน game.js (จุดเดียวที่ต้องแก้นอก handpinch.js)

นิ้วเด็ก + ความคลาดของ landmark ทำให้จีบพลาดฟองที่ตั้งใจหยิบบ่อย
`onPick()` ใน `game.js` (~บรรทัด 617) ปัจจุบันวนหา "ฟองแรกที่โดน":

```js
// เดิม — first hit ภายใน b.r พอดี
if (Math.hypot(x - b.x, y - b.y) <= b.r) { held = b; ... return; }
```

เปลี่ยนเป็น **หาฟองที่ใกล้ที่สุด** ภายในรัศมีขยาย พร้อม guard กัน input สองแหล่งชนกัน
และ **สแนปฟองไปจุดจีบทันที** (แม่เหล็กติดนิ้วจริง ไม่ใช่แค่ขยายรัศมีหยิบ):

```js
function onPick(x, y, slop = 1.0) {          // pointer ไม่ส่ง slop → 1.0 พฤติกรรมเดิม
  if (held) return;                          // ★ hybrid guard: จีบถือฟองอยู่แล้ว
                                             //   เด็กแตะจอ (หรือกลับกัน) ต้องไม่หยิบ
                                             //   ฟองตัวที่สองทับ — ไม่งั้นฟองแรกค้าง
                                             //   สถานะ held=true เป็น orphan
  if (state !== 'IDLE' && state !== 'DRAGGING') return;

  let best = null, bestD = Infinity;
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (b.dead) continue;
    const d = Math.hypot(x - b.x, y - b.y);
    if (d <= b.r * slop && d < bestD) { bestD = d; best = b; }
  }
  if (best) {
    held = best;
    held.x = x; held.y = y;   // ★ แม่เหล็กดูดติดนิ้วทันที — ไม่รอ onMove ขยับก่อน
                               //   (เดิมฟองค้างตำแหน่งเก่าจนกว่าจะขยับเกิน dead zone
                               //   รู้สึกเหมือนไม่ติดนิ้ว — บทเรียนทดสอบเครื่องจริง)
    /* ... โค้ดหยิบเดิม: pop, setState, sfx ... */
  }
}
```

ต้องเลือก "ใกล้สุด" ไม่ใช่ "ตัวแรกที่โดน" — เมื่อ slop 2.2 รัศมีอาจซ้อนกันหลายฟอง
first-hit จะหยิบฟองผิดตัว

**Drag guard ใน `onRelease` (ชั้นป้องกันที่สองของ bug v119):** จุดหยิบต้องถูกจำไว้
(`b.grabX/grabY`) และการหย่อนลงหม้อนับเฉพาะเมื่อ "ลากจริง":

```js
// phantom pinch หยิบ+ปล่อยที่จุดเดิม — ถ้าฟองลอยซ้อน zone หม้อ = หย่อนเองทันที
const dragged = Math.hypot(x - (b.grabX ?? x), y - (b.grabY ?? y)) > Math.max(24, b.r * 0.6);
const overMouth = dragged && Math.hypot(x - c.cx, (y - c.cy) / 1.1) <= c.rx;
```

เด็กลากจริงเคลื่อนที่ไกลกว่านี้เสมอ — ไม่กระทบการเล่นปกติ (ยืนยันด้วย Playwright test)

**⚠️ อย่าเพิ่มฟีเจอร์ "โยนด้วยแรงเหวี่ยง"** (เคยลองแล้วถอดออก 2026-07-05) — การเก็บ
ความเร็วลากมาคำนวณ trajectory แล้วเช็คว่าจะ "ลอยเข้า" โซนหม้อ ฟังดูดีในทฤษฎีแต่รู้สึก
ควบคุมยากในทางปฏิบัติ (ทดสอบเครื่องจริงแล้วผู้ใช้ขอถอดออก) — ถ้ามีคนขอฟีเจอร์ทำนอง
นี้อีก ให้ทวนกับผู้ใช้ก่อนว่าเจตนาคืออะไรจริงๆ อาจแก้ที่ magnet grab radius/threshold
แทนจะตรงจุดกว่า

---

## Step 6 — Hybrid wiring ใน main.js + mirror mapping

```js
export async function createHandPinchInput(fxCanvas, handlers, onCameraLost) {
  const videoEl = document.getElementById('camVideo');
  const stream = await initCamera(videoEl, onCameraLost);
  if (!stream) return null;   // caller: เกมเล่นต่อด้วย touch ตามปกติ

  const landmarker = await loadHandLandmarker();
  if (!landmarker) {          // offline / โหลด bundle ไม่ได้
    stream.getTracks().forEach(t => t.stop());
    return null;
  }

  detectLoop(loopGen);

  return {
    pause()  { paused = true;
               // ถ้ากำลังลากฟองอยู่ ปล่อยก่อน — กันฟองค้างมือระหว่างรอบฟังเสียง
               forceRelease(); },
    resume() { paused = false; },
    destroy() {
      running = false;                         // ★ หยุด loop ก่อน close
      stream.getTracks().forEach(t => t.stop());
      landmarker.close();
    },
  };
}
```

**ใน `main.js`** — hybrid: pointer ทำงาน **เสมอ** แล้วซ้อน AR ถ้าเปิดได้:
```js
createPointerInput(scene.fxCanvas, handlers);        // touch/เมาส์ ใช้ได้ตลอด

let arInput = await createHandPinchInput(scene.fxCanvas, handlers, () => {
  // กล้องถูก Android ตัด (จอดับ/สลับแอป/สายเข้า) → ปิด AR ให้เรียบร้อย
  arInput && arInput.destroy();
  arInput = null;
  audio.voice('retry');   // หรือเสียงเฉพาะ "ใช้นิ้วจิ้มจอแทนได้เลยจ้ะ"
});
// arInput = null ก็ไม่เป็นไร — เกมเล่นได้ด้วย touch อยู่แล้ว

// ★ pause inference ทุก state ที่ไม่ใช้มือ — ผูกกับ setState ของ game.js
//   (READING/LISTENING/EVALUATING/REWARD/REVEAL = เวลาส่วนใหญ่ของเกม)
//   เหตุผล: inference รันตลอด = มือถือร้อนจนเด็กเล่นนานไม่ได้ (บทเรียนเครื่องจริง)
//   + ช่วง LISTENING คืน CPU ให้ Speech Recognition ไปด้วยในตัว
app.arPause  = () => { if (arInput) arInput.pause(); };
app.arResume = () => { if (arInput && screen === 'game') arInput.resume(); };

// ใน game.js — จุดเดียวครอบทุก path:
function setState(s) {
  state = s;
  if (s === 'IDLE' || s === 'DRAGGING') { if (app.arResume) app.arResume(); }
  else if (app.arPause) app.arPause();
}
```

**Mirror + coordinate mapping — ระวัง 2 จุด:**

1. สูตร mirror อย่างเดียว (`(1 - index.x) * canvasW`) ใช้ได้เมื่อ **ไม่แสดง** ภาพกล้อง
   (camVideo ซ่อน ใช้แค่ tracking) — แต่ถ้าเปิด `#camVideo` เป็น AR overlay ด้วย
   `object-fit: cover` พิกัดนิ้วบนจอจะเพี้ยนตามส่วนที่ถูก crop ต้อง map ผ่าน
   สูตร cover เดียวกับที่ browser scale video (ฟังก์ชัน `toCanvas` ที่ Step 3ข ใช้จริง):
   ```js
   function toCanvas(nx, ny, canvasW, canvasH) {
     const vidW = videoEl.videoWidth || 640, vidH = videoEl.videoHeight || 480;
     const scale = Math.max(canvasW / vidW, canvasH / vidH);
     const dw = vidW * scale, dh = vidH * scale;
     return {
       x: (1 - nx) * dw - (dw - canvasW) / 2,   // mirror ซ้าย-ขวาในตัว (1-nx)
       y: ny * dh - (dh - canvasH) / 2,
     };
   }
   ```
2. `#camVideo` ต้องใส่ CSS `transform: scaleX(-1)` (mirror แบบกระจก) ให้ภาพตรงกับ
   พิกัดที่ flip แล้ว — ไม่งั้นเด็กขยับมือขวา ตัวชี้ไปซ้าย

---

## ท่าทางส่วนขยาย (bonus, ไม่ผูกกับการหยิบ/ปล่อยฟองหลัก)

`onHandFrame(frame)` — handler เสริม (นอกเหนือจาก onPick/onMove/onRelease) ที่
handpinch.js เรียก**ทุกเฟรม**ที่เจอมือ (ไม่ขึ้นกับ pinch state) ส่ง
`{ x, y, open, spread, palmUp }` ของนิ้วชี้ — `pointer.js` ไม่มี concept นี้ (ไม่เรียก)
เพราะเป็นฟีเจอร์เฉพาะกล้อง AR ปัจจุบัน `open` และ `spread` เป็นค่าเดียวกัน (`!isPinching`)
คือ true เมื่อมือเปิดอยู่ไม่ได้จีบ — เก็บเป็นสอง field แยกไว้เผื่ออนาคตอยากแยกเงื่อนไข:

- **ประกายดาวลอยตามนิ้วชี้ตอนมือเปิด** — game.js เรียก `spawnDragTrail(x,y)` เมื่อ
  `spread` เป็น true
- **หงายมือ + กวาดขึ้น → เดาะฟองใกล้เคียงลอยขึ้น** — ใช้ `palmUpScore()` (cross
  product 2D ของ wrist→index_mcp กับ wrist→pinky_mcp, กลับเครื่องหมายตาม handedness)
  ตรวจทิศฝ่ามือ ร่วมกับความเร็วเคลื่อนที่ขึ้นของนิ้วชี้ (คำนวณใน game.js) → ดันฟอง
  ใกล้เคียงลอยขึ้น เคลื่อนลงไม่มีผล (ตั้งใจให้ตบลงไม่ได้)
- ทั้งสองอย่างเป็น**ของเสริม** ไม่กระทบการหยิบ/ปล่อยหลัก — ถ้าทำให้ debug ยากขึ้นหรือ
  ผู้ใช้อยากตัดออก ลบได้โดยไม่กระทบ pinch mechanic

**⚠️ ท่าหงายมือยังไม่ผ่านทดสอบเครื่องจริง** — `palmUpScore()` ใช้ 2D cross product
ประมาณทิศฝ่ามือ ไม่ใช่ 3D orientation เต็มรูปแบบ ถ้าทดสอบแล้วเดาะไม่ขึ้น/ทิศกลับด้าน
ให้ negate ค่าที่ return ใน `palmUpScore()` — เป็นค่าคงที่จุดเดียว แก้ง่าย

---

## Step 7 — อัปเดต PWA + ทดสอบกับเด็กจริง

- รัน `/sw-sync` เพิ่ม `public/models/` เข้า APP_SHELL (model ต้องแคช offline)
- รัน `/ar-perf-check` ก่อน deploy บน Android จริง

**Checklist ทดสอบพฤติกรรมเด็กก่อน deploy:**
- [ ] 2 คนยื่นมือหน้ากล้องพร้อมกัน → ตัวชี้ต้องไม่กระโดดสลับมือ (sticky lock ทำงาน)
- [ ] จีบหลวม ๆ ค้างไว้แล้วลาก → ฟองต้องไม่หลุดกลางทาง (hysteresis ทำงาน)
- [ ] มือสั่นขณะถือฟอง → ฟองต้องไม่สั่นตาม (smoothing ทำงาน)
- [ ] จีบเยื้องข้างฟองเล็กน้อย → ต้องยังหยิบได้ และหยิบตัวที่ใกล้สุด สแนปติดนิ้วทันที
      (magnet grab)
- [ ] ยืนใกล้กล้อง (เด็กเล็ก) และไกลกล้อง (PC webcam) → pinch ต้องยังทำงานทั้งคู่
      (hand-size normalization)
- [ ] ลากฟองแล้วเอามือออกนอกเฟรม → ฟองลอยกลับที่เดิม ไม่ค้างกลางจอ
- [ ] จิ้มจอขณะ AR เปิดอยู่ → touch ต้องหยิบฟองได้ปกติ และถ้าจีบถือฟองอยู่
      การจิ้มต้องไม่แย่งหยิบฟองตัวที่สอง (hybrid guard)
- [ ] หมุนจอแนวตั้ง↔แนวนอนกลางเกม → จีบนิ้วแล้วตำแหน่งยังตรง
- [ ] สลับแอปอื่นแล้วกลับมา → **กล้องกลับมาเอง เล่น AR ต่อได้** ไม่ใช่ภาพค้าง
      (visibilitychange + watchdog ทำงาน) — ถ้ากู้ไม่ได้ต้องมีเสียงแจ้ง + touch ใช้ได้
- [ ] เปิดเกมแบบ offline → เกมเล่นได้ปกติด้วย touch, ไม่ crash, ไม่ค้างจอโหลด AR
- [ ] ระหว่างรอบอ่าน/ฟังเสียง/รางวัล → inference หยุดจริง (CPU ลด, ไม่มี onPick หลุดมา)
- [ ] เล่นต่อเนื่อง 10 นาทีบนมือถือจริง → เครื่องอุ่นได้แต่ต้องไม่ร้อนจน throttle/fps ตก
- [ ] ปล่อยฟองโดยไม่ลาก (จีบ+ปล่อยจุดเดิม) บนฟองที่ลอยใกล้หม้อ → ต้องไม่หย่อนลงหม้อ
- [ ] เอื้อมมือถือฟองลงต่ำใกล้หม้อ (มือเอียง/คว่ำธรรมชาติ) → ฟองต้องไม่หลุดเองกลางทาง
      (pinch-off confirmation ทำงาน — นี่คือบั๊กจริงที่เจอตอนใช้ท่ากำมือ)
