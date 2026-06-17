// input/handpinch.js — สเก็ตช์ input layer ด้วย MediaPipe Hand Landmarker
// (สลับมาใช้แทน pointer.js ภายหลัง — interface เดียวกัน: onPick/onMove/onRelease)
//
// ยังไม่ผูกใช้งานในต้นแบบนี้ (ต้องโหลดโมเดล WASM + เปิดกล้อง)
// แนวคิด pinch detection ตาม Overview เดิม:
//   distance(นิ้วโป้ง, นิ้วชี้) normalize ด้วยขนาดมือ (กัน scale variance)
//   pinch < threshold = pick, ปล่อย = release
//
// export interface เดียวกับ pointer เพื่อให้ main.js สลับได้โดยไม่แตะ game.js

export function createHandPinchInput(/* videoEl, canvas, handlers */) {
  throw new Error(
    'handpinch.js ยังไม่ implement — ต้นแบบนี้ใช้ pointer.js. ' +
      'ดูสเปกหัวข้อ 3.5 สำหรับการต่อ MediaPipe'
  );
}
