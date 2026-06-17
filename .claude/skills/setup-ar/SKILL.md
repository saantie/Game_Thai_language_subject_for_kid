---
description: step-by-step guide implement handpinch.js ด้วย MediaPipe Hand Landmarker — camera permission, pinch detection, hand-size normalization, สลับจาก pointer mode
---

# /setup-ar

Implement `src/input/handpinch.js` ให้ emit `onPick/onMove/onRelease` เหมือน `pointer.js`
ทำให้ `game.js` ไม่รู้ว่า input มาจากนิ้วจริงหรือเมาส์ (interface เดียวกันตามสเปก §3.5)

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

เขียนใน `handpinch.js` ส่วน camera init:

```js
async function initCamera(videoEl) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', '');   // iOS ต้องการ
    await videoEl.play();
    return stream;
  } catch (err) {
    // NotAllowedError = ผู้ใช้ปฏิเสธ → fallback pointer mode
    // NotFoundError   = ไม่มีกล้อง → fallback pointer mode
    return null;   // caller ตรวจ null แล้ว fallback
  }
}
```

**สำคัญ:** ถ้า `initCamera` คืน `null` ให้ fallback กลับ pointer mode อัตโนมัติ
อย่า throw error ให้ game crash — AR เป็น optional feature

---

## Step 2 — Load MediaPipe HandLandmarker

```js
import { FilesetResolver, HandLandmarker } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js';

async function loadHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks('./models/wasm/');
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: './models/hand_landmarker.task',
      delegate: 'GPU',              // fallback CPU อัตโนมัติถ้า GPU ไม่พร้อม
    },
    runningMode: 'VIDEO',           // ไม่ใช่ IMAGE — สำคัญมาก
    numHands: 1,                    // เด็กใช้มือเดียว ลด inference load
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}
```

**อย่าใช้ `runningMode: 'IMAGE'`** — inference จะช้าลง 3–5x เพราะไม่ใช้ temporal tracking

---

## Step 3 — Pinch detection + Hand-size normalization (สเปก §3.5)

นี่คือจุดที่สเปกเตือนไว้โดยเฉพาะ:

```js
// landmark index:  4 = นิ้วโป้งปลาย, 8 = นิ้วชี้ปลาย, 0 = ข้อมือ, 9 = กลางฝ่ามือ
function getPinchState(landmarks, canvasW, canvasH) {
  const thumb = landmarks[4];
  const index = landmarks[8];
  const wrist = landmarks[0];
  const mid   = landmarks[9];

  // raw distance นิ้วโป้ง-ชี้ (normalized 0–1 ใน MediaPipe space)
  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  const rawDist = Math.hypot(dx, dy);

  // hand size = ระยะข้อมือถึงกลางฝ่ามือ (normalize กัน scale variance จากระยะกล้อง)
  const handSize = Math.hypot(wrist.x - mid.x, wrist.y - mid.y);
  const normDist = handSize > 0.01 ? rawDist / handSize : rawDist;

  // พิกัดตำแหน่งนิ้วชี้ในหน่วย canvas px (mirror ด้านซ้าย-ขวาเพราะกล้อง selfie)
  const x = (1 - index.x) * canvasW;
  const y = index.y * canvasH;

  return {
    pinching: normDist < 0.35,   // threshold — ปรับได้ใน settings
    x, y,
  };
}
```

**ห้ามใช้ raw distance โดยไม่ normalize** — เด็กยืนใกล้กล้องกว่าผู้ใหญ่ threshold จะผิดเสมอ

---

## Step 4 — Inference loop (ต้องไม่บล็อก game loop)

```js
let lastVideoTime = -1;

function detectLoop(landmarker, videoEl, handlers, canvasW, canvasH) {
  if (!videoEl.paused && videoEl.currentTime !== lastVideoTime) {
    lastVideoTime = videoEl.currentTime;

    // detectForVideo ทำงานบน main thread แต่ใช้เวลา ~5–15ms/frame
    const result = landmarker.detectForVideo(videoEl, performance.now());

    if (result.landmarks.length > 0) {
      const { pinching, x, y } = getPinchState(result.landmarks[0], canvasW, canvasH);
      updatePinchState(pinching, x, y, handlers);
    } else {
      // ไม่เห็นมือ → release ถ้ากำลัง hold อยู่
      if (isPinching) {
        isPinching = false;
        handlers.onRelease && handlers.onRelease(lastX, lastY);
      }
    }
  }

  // ใช้ requestVideoFrameCallback แทน rAF ถ้า browser รองรับ
  // (sync กับ video frame จริง ลด redundant inference)
  if ('requestVideoFrameCallback' in videoEl) {
    videoEl.requestVideoFrameCallback(() => detectLoop(landmarker, videoEl, handlers, canvasW, canvasH));
  } else {
    requestAnimationFrame(() => detectLoop(landmarker, videoEl, handlers, canvasW, canvasH));
  }
}
```

---

## Step 5 — Pinch state machine → emit events

```js
let isPinching = false;
let lastX = 0, lastY = 0;

function updatePinchState(pinching, x, y, handlers) {
  if (pinching && !isPinching) {
    isPinching = true;
    handlers.onPick && handlers.onPick(x, y);
  } else if (pinching && isPinching) {
    if (Math.hypot(x - lastX, y - lastY) > 2) {   // dead zone กัน jitter
      handlers.onMove && handlers.onMove(x, y);
    }
  } else if (!pinching && isPinching) {
    isPinching = false;
    handlers.onRelease && handlers.onRelease(x, y);
  }
  lastX = x; lastY = y;
}
```

---

## Step 6 — export interface เดียวกับ pointer.js

```js
export async function createHandPinchInput(fxCanvas, handlers) {
  const videoEl = document.getElementById('camVideo');
  const stream = await initCamera(videoEl);
  if (!stream) return null;   // caller fallback to pointer

  const landmarker = await loadHandLandmarker();
  detectLoop(landmarker, videoEl, handlers, fxCanvas.clientWidth, fxCanvas.clientHeight);

  return {
    destroy() {
      stream.getTracks().forEach(t => t.stop());
      landmarker.close();
    },
  };
}
```

**ใน `main.js`** สลับ input layer:
```js
const inputMode = await createHandPinchInput(scene.fxCanvas, handlers);
if (!inputMode) createPointerInput(scene.fxCanvas, handlers);   // fallback
```

---

## Step 7 — อัปเดต PWA หลัง implement

- รัน `/sw-sync` เพิ่ม `public/models/` เข้า APP_SHELL (model ต้องแคช offline)
- รัน `/ar-perf-check` ก่อน deploy บน mobile จริง
