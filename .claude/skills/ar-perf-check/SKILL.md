---
description: ตรวจ AR implementation ไม่ block game loop — inference thread, camera resolution, model size, dead zone
---

# /ar-perf-check

ตรวจว่า MediaPipe implementation ไม่ทำให้ game loop ต่ำกว่า 45 fps บน mid-range Android
รัน **หลัง** `/setup-ar` implement เสร็จแล้ว ก่อน deploy บน device จริง

## ไฟล์ที่ตรวจ
`src/input/handpinch.js`, `src/main.js`, `src/game.js`

---

## หมวด A — Inference ไม่อยู่ใน rAF callback ของ game

**ปัญหาที่พบบ่อยที่สุด:** inference ถูก call ใน `requestAnimationFrame` เดียวกับ game render
ทำให้ทุก frame ใช้เวลา: render (5ms) + inference (15ms) = 20ms → fps ตก

ตรวจ:
- `landmarker.detectForVideo()` ถูกเรียกจาก loop ใด — `rAF` loop เดียวกับ `game.js` ไหม
- ถ้าใช่ → **❌ ต้องแยก**:
  - ใช้ `videoEl.requestVideoFrameCallback()` แทน (sync กับ video frame ~30fps ไม่ใช่ 60fps)
  - หรือแยก inference ไปใน `setTimeout(detect, 1000/30)` loop ต่างหาก

ตัวอย่าง pattern ที่ถูก:
```
game rAF loop  → render only (60fps target)
video callback → inference only (30fps max, sync กับ camera)
```

---

## หมวด B — Camera resolution

ตรวจ `getUserMedia` constraints ใน `handpinch.js`:
- `width: 640, height: 480` → ✅ เหมาะสม (~5–15ms inference)
- `width: 1280` หรือสูงกว่า → ❌ inference ช้า 4x บน low-end
- ไม่ระบุ constraints → ⚠️ browser เลือกเอง อาจได้ 4K บน iPhone Pro

ตรวจว่ามี `facingMode: 'user'` (กล้องหน้า) — ถ้าใช้กล้องหลัง landmark จะ mirror ผิด

---

## หมวด C — Model size (LITE vs FULL)

ตรวจ `createFromOptions` ใน `handpinch.js`:
- `hand_landmarker.task` — ตรวจขนาดไฟล์ใน `public/models/`
  - LITE model (~8MB): inference ~5–8ms บน mid-range — ✅ แนะนำสำหรับเกมเด็ก
  - FULL model (~25MB): inference ~12–20ms — ⚠️ ใช้ได้แต่ควร benchmark ก่อน
- `numHands: 1` → ✅ (ลด load 40% เทียบกับ 2 hands)
- `delegate: 'GPU'` → ✅ ต้องมี, fallback CPU อัตโนมัติ

---

## หมวด D — Dead zone และ jitter filter

ตรวจ `updatePinchState`:
- มี dead zone ป้องกัน `onMove` fire เมื่อนิ้วไม่ขยับไหม
  (landmark jitter ±2–5px เสมอแม้นิ้วนิ่ง → `onMove` spam → game.js `moveHeld()` ทุก frame)
- ขนาด dead zone ที่แนะนำ: `Math.hypot(dx, dy) > 4` px (canvas units)
- pinch threshold มี hysteresis ไหม:
  - pinch-in threshold: `normDist < 0.35`
  - pinch-out threshold: `normDist > 0.42` (hysteresis gap 0.07)
  - ถ้าใช้ threshold เดียวกัน → ฟองสั่นตอน borderline pinch

---

## หมวด E — Memory และ lifecycle

- `landmarker.close()` ถูกเรียกตอน `destroy()` ไหม — ถ้าไม่เรียก WASM memory รั่ว
- `stream.getTracks().forEach(t => t.stop())` ตอน destroy ไหม — ถ้าไม่ indicator กล้องค้างติด
- กล้องถูกปิดตอน user กด back button (ออกจากโหมด AR) ไหม
- `HandLandmarker` สร้างครั้งเดียวต่อ session ไหม — ถ้าสร้างใหม่ทุกครั้งที่เริ่มมาตรา จะ OOM บน low-end

---

## หมวด F — Graceful fallback

- ถ้า `getUserMedia` ถูกปฏิเสธ → game เล่นด้วย pointer mode ได้ไหม (ไม่ crash)
- ถ้า WASM load fail (offline + model ไม่ถูกแคช) → fallback pointer mode ไหม
- ตรวจว่า error เหล่านี้ไม่ throw ค้างขึ้นมาถึง game.js (ควรจับใน handpinch.js เอง)

---

## รูปแบบรายงาน

```
🎥 AR Performance Check
──────────────────────────────────────────
A. Inference thread
   ❌ detectForVideo() อยู่ใน rAF เดียวกับ game render → แยก loop

B. Camera resolution
   ✅ 640×480, facingMode: 'user'

C. Model size
   ✅ LITE model (8.3MB), numHands: 1, GPU delegate

D. Dead zone / Jitter
   ⚠️ dead zone = 2px (แนะนำ ≥4px), ไม่มี hysteresis บน pinch threshold

E. Memory lifecycle
   ✅ landmarker.close() และ stream.stop() อยู่ใน destroy()

F. Fallback
   ✅ getUserMedia fail → pointer mode
   ⚠️ WASM load fail ไม่มี try/catch → อาจ crash ถ้า offline + model ไม่ถูกแคช

สรุป: ❌ 1 จุดต้องแก้ก่อน deploy, ⚠️ 2 จุดควรแก้
──────────────────────────────────────────
```

## หลังรายงาน
- ❌ แก้ทันทีก่อน test บน device
- ⚠️ ปรับก่อน release บน mobile จริง
- แนะนำ: ทดสอบบน **mid-range Android จริง** (ไม่ใช่ emulator) เพื่อวัด fps จริง
  - เปิด Chrome DevTools → Performance → record 10 วินาทีขณะเล่น AR
  - fps ควร ≥45 ตลอด, ไม่มี frame > 33ms (กรณีเลวร้าย)
