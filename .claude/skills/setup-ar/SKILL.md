---
description: step-by-step guide implement handpinch.js ด้วย MediaPipe Hand Landmarker — camera permission, sticky hand lock (กันหลายมือ/หลายเด็ก), จับด้วยการกำมือ (fist) + hysteresis + confirmation + smoothing สำหรับมือเด็ก, hand-size normalization, magnet grab + drag guard, hybrid touch+AR, ปุ่มเปิด/ปิด AR หน้าแรก, กู้คืนกล้องอัตโนมัติหลังสลับแอป, pause ตาม state ลดความร้อนมือถือ
---

# /setup-ar

Implement `src/input/handpinch.js` ให้ emit `onPick/onMove/onRelease` เหมือน `pointer.js`
ทำให้ `game.js` ไม่รู้ว่า input มาจากนิ้วจริงหรือเมาส์ (interface เดียวกันตามสเปก §3.5)

**ออกแบบสำหรับผู้เล่นเด็ก** — คู่มือนี้รวมมาตรการกันบั๊กจากพฤติกรรมเด็กจริง:
- เด็กหลายคน (หลายมือ) หน้ากล้องพร้อมกัน → sticky hand lock (Step 3ก)
- จีบนิ้วหลวม/ไม่แน่น → hysteresis สองระดับ (Step 3ข)
- false detection เฟรมเดียวทำเกม "เล่นเอง" → pinch confirmation 3 เฟรม (Step 5)
  + drop ต้องลากจริง (Step 5.5) [บทเรียน bug v119]
- มือสั่น → EMA smoothing (Step 5)
- จีบไม่โดนฟองพอดี → magnet grab (Step 5.5)
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

// คืน landmarks ของมือที่ควรคุมเกม หรือ null ถ้ามือที่ล็อกหลุดเฟรม
function selectHand(allHands) {
  if (allHands.length === 0) {
    if (++lostFrames >= LOST_RESET) lockedWrist = null;
    return null;
  }
  lostFrames = 0;

  if (lockedWrist) {
    // เลือกมือที่ข้อมือใกล้ตำแหน่งเดิมที่สุด (มือเดียวกับเฟรมก่อน)
    let best = null, bestD = Infinity;
    for (const lm of allHands) {
      const d = Math.hypot(lm[0].x - lockedWrist.x, lm[0].y - lockedWrist.y);
      if (d < bestD) { bestD = d; best = lm; }
    }
    // ★ ระหว่างลากฟอง (isPinching) ห้ามสลับไปมืออื่นเด็ดขาด —
    //   ถ้ามือเดิมกระโดดไปไกลผิดปกติ แปลว่ามือที่ล็อกหลุดเฟรม
    //   และ best คือมือของเด็กอีกคน → ถือว่าไม่เจอมือ
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
```

### 3ข) Grip detection + hysteresis + hand-size normalization

> **ท่าจับของโปรดักชัน = "กำมือ" (fist) ไม่ใช่จีบสองนิ้ว** [decision 2026-07-03]:
> เด็กกำมือได้ง่ายและเสถียรกว่าจีบนิ้วมาก สูตร: ค่าเฉลี่ยระยะปลายนิ้ว 4 นิ้ว
> (landmark 8,12,16,20) → กลางฝ่ามือ (9) หารด้วย handSize — แบมือ ~1.0–1.4,
> กำมือ ~0.3–0.6 → `GRIP_ON 0.60 / GRIP_OFF 0.85` และ**ตำแหน่งลากใช้กลางฝ่ามือ**
> (กำมือแล้วปลายนิ้วชี้หายเข้าไปในกำปั้น) — โครงด้านล่างเป็นตัวอย่างแบบ pinch เดิม
> หลักการ normalize/hysteresis เหมือนกันทุกประการ ดูโค้ดจริงใน `src/input/handpinch.js`

นี่คือจุดที่สเปกเตือนไว้โดยเฉพาะ:

```js
// landmark index:  4 = นิ้วโป้งปลาย, 8 = นิ้วชี้ปลาย, 0 = ข้อมือ, 9 = กลางฝ่ามือ
const PINCH_ON  = 0.30;   // เริ่มจีบเมื่อ normDist ต่ำกว่านี้
const PINCH_OFF = 0.45;   // ปล่อยเมื่อ normDist สูงกว่านี้ — ช่องว่าง 0.30–0.45
                          // กันเด็กจีบหลวมแล้วฟองหลุด ๆ ติด ๆ กลางทาง (rapid pick/release)

function getPinchState(landmarks, canvasW, canvasH, wasPinching) {
  const thumb = landmarks[4];
  const index = landmarks[8];
  const wrist = landmarks[0];
  const mid   = landmarks[9];

  // raw distance นิ้วโป้ง-ชี้ (normalized 0–1 ใน MediaPipe space)
  const rawDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);

  // hand size = ระยะข้อมือถึงกลางฝ่ามือ (normalize กัน scale variance จากระยะกล้อง)
  const handSize = Math.hypot(wrist.x - mid.x, wrist.y - mid.y);
  const normDist = handSize > 0.01 ? rawDist / handSize : rawDist;

  // hysteresis: threshold เข้า/ออกคนละค่า — ระหว่างกลางคงสถานะเดิม
  const pinching = wasPinching ? normDist < PINCH_OFF : normDist < PINCH_ON;

  // พิกัดตำแหน่งนิ้วชี้ในหน่วย canvas px (mirror ด้านซ้าย-ขวาเพราะกล้อง selfie)
  const x = (1 - index.x) * canvasW;
  const y = index.y * canvasH;

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

function detectLoop(landmarker, videoEl, fxCanvas, handlers) {
  if (!running) return;                        // destroy() แล้ว → จบ ไม่ schedule ต่อ

  if (!paused && !videoEl.paused && videoEl.currentTime !== lastVideoTime) {
    lastVideoTime = videoEl.currentTime;

    // อ่านขนาดสด ๆ ทุกเฟรม — รองรับหมุนจอ/resize
    const canvasW = fxCanvas.clientWidth;
    const canvasH = fxCanvas.clientHeight;

    // detectForVideo ทำงานบน main thread แต่ใช้เวลา ~5–15ms/frame
    const result = landmarker.detectForVideo(videoEl, performance.now());

    const hand = selectHand(result.landmarks);   // sticky lock จาก Step 3ก
    if (hand) {
      const { pinching, x, y } = getPinchState(hand, canvasW, canvasH, isPinching);
      updatePinchState(pinching, x, y, handlers);
    } else {
      // ไม่เห็นมือ (หรือมือที่ล็อกหลุดเฟรม) → release ทันที
      // [decision เคาะแล้ว 2026-07-02: ไม่ใช้ grace period — ฟองลอยกลับที่เดิม
      //  ซึ่ง game.js จัดการให้อยู่แล้วเมื่อ release นอกหม้อ]
      if (isPinching) {
        isPinching = false;
        handlers.onRelease && handlers.onRelease(lastX, lastY);
      }
    }
  }

  // ใช้ requestVideoFrameCallback แทน rAF ถ้า browser รองรับ
  // (sync กับ video frame จริง ลด redundant inference)
  if ('requestVideoFrameCallback' in videoEl) {
    videoEl.requestVideoFrameCallback(() => detectLoop(landmarker, videoEl, fxCanvas, handlers));
  } else {
    requestAnimationFrame(() => detectLoop(landmarker, videoEl, fxCanvas, handlers));
  }
}
```

---

## Step 5 — Pinch state machine + smoothing → emit events

มือเด็กสั่นมากกว่าผู้ใหญ่ — ส่งพิกัดดิบเข้าเกมฟองจะสั่นตาม ต้อง smooth ก่อน:

```js
let isPinching = false;
let pinchFrames = 0;           // นับเฟรมจีบต่อเนื่อง
let lastX = 0, lastY = 0;
let sx = 0, sy = 0;            // ตำแหน่งหลัง smoothing
const SMOOTH = 0.4;            // EMA alpha — 0.4 ตอบสนองไวพอ แต่ตัด jitter ความถี่สูง
const DEAD_ZONE = 3;           // px หลัง smoothing แล้ว
const GRAB_SLOP = 1.6;         // รัศมีหยิบขยายสำหรับ pinch (magnet grab, Step 5.5)
const PINCH_ON_FRAMES = 3;     // ★ ต้องจีบต่อเนื่อง 3 เฟรมก่อนนับ — ดูคำเตือนล่างสุด

function updatePinchState(pinching, x, y, handlers) {
  // EMA smoothing ก่อนใช้พิกัดทุกครั้ง
  sx += (x - sx) * SMOOTH;
  sy += (y - sy) * SMOOTH;

  if (pinching && !isPinching) {
    // ยืนยันจีบต่อเนื่องก่อนนับ — ตัด phantom pinch จาก false detection
    if (++pinchFrames < PINCH_ON_FRAMES) { lastX = sx; lastY = sy; return; }
    isPinching = true;
    sx = x; sy = y;            // reset filter ตอนเริ่มจีบ กันตำแหน่งค้างจากรอบก่อน
    handlers.onPick && handlers.onPick(sx, sy, GRAB_SLOP);   // ★ ส่ง slop เป็น param ที่ 3
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
```

**⚠️ ห้ามตัด pinch confirmation ออก** (ตอนออกแบบครั้งแรกเคยตัดเพราะกลัวหน่วง —
ผิดพลาด): false detection ของ MediaPipe เฟรมเดียวจะยิง pick+release ที่จุดเดิมทันที
ถ้าฟองลอยซ้อน drop zone ของหม้อ = หย่อนเอง → เกมเข้ารอบอ่าน-เปิดไมค์-จบรอบวนเอง
ไม่หยุด "แม่มดพูดรัว ไมค์เด้งรัว" (bug จริง v119) — 3 เฟรม @24fps = ~125ms เด็กไม่รู้สึก

**ทำไมส่ง slop เป็น parameter ไม่ใช่ flag โหมด:** touch กับ pinch ทำงานพร้อมกัน
(hybrid, Step 6) — flag เดียวแบบ `app.inputIsHand` แยกไม่ออกว่า event นี้มาจากแหล่งไหน
pointer.js ไม่ต้องแก้อะไร (ไม่ส่ง param ที่ 3 → game.js default 1.0 = พฤติกรรมเดิมเป๊ะ)

---

## Step 5.5 — Magnet grab ใน game.js (จุดเดียวที่ต้องแก้นอก handpinch.js)

นิ้วเด็ก + ความคลาดของ landmark ทำให้จีบพลาดฟองที่ตั้งใจหยิบบ่อย
`onPick()` ใน `game.js` (~บรรทัด 543) ปัจจุบันวนหา "ฟองแรกที่โดน":

```js
// เดิม — first hit ภายใน b.r พอดี
if (Math.hypot(x - b.x, y - b.y) <= b.r) { held = b; ... return; }
```

เปลี่ยนเป็น **หาฟองที่ใกล้ที่สุด** ภายในรัศมีขยาย พร้อม guard กัน input สองแหล่งชนกัน:

```js
function onPick(x, y, slop = 1.0) {          // pointer ไม่ส่ง slop → 1.0 พฤติกรรมเดิม
  if (held) return;                          // ★ hybrid guard: pinch ถือฟองอยู่แล้ว
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
  if (best) { held = best; /* ... โค้ดหยิบเดิม: pop, setState, sfx ... */ }
}
```

ต้องเลือก "ใกล้สุด" ไม่ใช่ "ตัวแรกที่โดน" — เมื่อ slop 1.6 รัศมีอาจซ้อนกันหลายฟอง
first-hit จะหยิบฟองผิดตัว

**Drag guard ใน `onRelease` (ชั้นป้องกันที่สองของ bug v119):** จุดหยิบต้องถูกจำไว้
(`b.grabX/grabY`) และการหย่อนลงหม้อนับเฉพาะเมื่อ "ลากจริง":

```js
// phantom pinch หยิบ+ปล่อยที่จุดเดิม — ถ้าฟองลอยซ้อน zone หม้อ = หย่อนเองทันที
const dragged = Math.hypot(x - (b.grabX ?? x), y - (b.grabY ?? y)) > Math.max(24, b.r * 0.6);
const overMouth = dragged && Math.hypot(x - c.cx, (y - c.cy) / 1.1) <= c.rx;
```

เด็กลากจริงเคลื่อนที่ไกลกว่านี้เสมอ — ไม่กระทบการเล่นปกติ (ยืนยันด้วย Playwright test)

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

  detectLoop(landmarker, videoEl, fxCanvas, handlers);

  return {
    pause()  { paused = true;
               // ถ้ากำลังลากฟองอยู่ ปล่อยก่อน — กันฟองค้างมือระหว่างรอบฟังเสียง
               if (isPinching) { isPinching = false;
                 handlers.onRelease && handlers.onRelease(lastX, lastY); } },
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

1. สูตร `(1 - index.x) * canvasW` ใน Step 3ข ใช้ได้เมื่อ **ไม่แสดง** ภาพกล้อง
   (camVideo ซ่อน ใช้แค่ tracking) — แต่ถ้าเปิด `#camVideo` เป็น AR overlay ด้วย
   `object-fit: cover` พิกัดนิ้วบนจอจะเพี้ยนตามส่วนที่ถูก crop ต้อง map ผ่าน
   สูตร cover เดียวกับที่ browser scale video:
   ```js
   // map normalized video coord → screen px เมื่อ camVideo แสดงแบบ cover
   const scale = Math.max(canvasW / vidW, canvasH / vidH);
   const dw = vidW * scale, dh = vidH * scale;
   const x = (1 - nx) * dw - (dw - canvasW) / 2;
   const y = ny * dh - (dh - canvasH) / 2;
   ```
2. `#camVideo` ต้องใส่ CSS `transform: scaleX(-1)` (mirror แบบกระจก) ให้ภาพตรงกับ
   พิกัดที่ flip แล้ว — ไม่งั้นเด็กขยับมือขวา ตัวชี้ไปซ้าย

---

## Step 7 — อัปเดต PWA + ทดสอบกับเด็กจริง

- รัน `/sw-sync` เพิ่ม `public/models/` เข้า APP_SHELL (model ต้องแคช offline)
- รัน `/ar-perf-check` ก่อน deploy บน Android จริง

**Checklist ทดสอบพฤติกรรมเด็กก่อน deploy:**
- [ ] 2 คนยื่นมือหน้ากล้องพร้อมกัน → ตัวชี้ต้องไม่กระโดดสลับมือ (sticky lock ทำงาน)
- [ ] จีบหลวม ๆ ค้างไว้แล้วลาก → ฟองต้องไม่หลุดกลางทาง (hysteresis ทำงาน)
- [ ] มือสั่นขณะถือฟอง → ฟองต้องไม่สั่นตาม (smoothing ทำงาน)
- [ ] จีบเยื้องข้างฟองเล็กน้อย → ต้องยังหยิบได้ และหยิบตัวที่ใกล้สุด (magnet grab)
- [ ] ยืนใกล้กล้อง (เด็กเล็ก) และไกลกล้อง (PC webcam) → pinch ต้องยังทำงานทั้งคู่
      (hand-size normalization)
- [ ] ลากฟองแล้วเอามือออกนอกเฟรม → ฟองลอยกลับที่เดิม ไม่ค้างกลางจอ
- [ ] จิ้มจอขณะ AR เปิดอยู่ → touch ต้องหยิบฟองได้ปกติ และถ้า pinch ถือฟองอยู่
      การจิ้มต้องไม่แย่งหยิบฟองตัวที่สอง (hybrid guard)
- [ ] หมุนจอแนวตั้ง↔แนวนอนกลางเกม → จีบนิ้วแล้วตำแหน่งยังตรง
- [ ] สลับแอปอื่นแล้วกลับมา → **กล้องกลับมาเอง เล่น AR ต่อได้** ไม่ใช่ภาพค้าง
      (visibilitychange + watchdog ทำงาน) — ถ้ากู้ไม่ได้ต้องมีเสียงแจ้ง + touch ใช้ได้
- [ ] เปิดเกมแบบ offline → เกมเล่นได้ปกติด้วย touch, ไม่ crash, ไม่ค้างจอโหลด AR
- [ ] ระหว่างรอบอ่าน/ฟังเสียง/รางวัล → inference หยุดจริง (CPU ลด, ไม่มี onPick หลุดมา)
- [ ] เล่นต่อเนื่อง 10 นาทีบนมือถือจริง → เครื่องอุ่นได้แต่ต้องไม่ร้อนจน throttle/fps ตก
      (ถ้ายังร้อน: เช็คว่า pause ตาม state ทำงานจริง แล้วค่อยพิจารณาลด inference
      เหลือเฟรมเว้นเฟรม — แลกกับ pinch confirmation ช้าลงเป็น ~250ms)
- [ ] ปล่อยฟองโดยไม่ลาก (จีบ+ปล่อยจุดเดิม) บนฟองที่ลอยใกล้หม้อ → ต้องไม่หย่อนลงหม้อ
