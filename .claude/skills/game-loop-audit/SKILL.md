---
description: ตรวจ hot path ของ game loop — GC pressure, canvas layer ผิด, event listener รั่ว, gradient ไม่ cache
---

# /game-loop-audit

ตรวจ performance ของ game loop และ render pipeline
เป้าหมาย: รัน 60 fps บน mid-range Android โดยไม่มี GC jank

## ไฟล์ที่ตรวจ
`src/game.js`, `src/scene.js`, `src/audio.js`, `src/input/pointer.js`

## หมวดที่ตรวจ

### A. GC Pressure ใน Hot Path (update/render loop)
หา pattern เหล่านี้ **ภายใน** function `update()`, `render()`, `loop()`, `drawBubble()`, `drawParticle()`, `drawCauldron()`:
- `new Object()`, `{}`, `[]` — ควรใช้ object pool แทน
- template literal ที่ไม่ cache: `` `${fontSize}px 'Sarabun'` `` ถูกสร้างทุกเฟรม
- `.map()`, `.filter()`, `.slice()` ใน loop — สร้าง array ใหม่ทุกเฟรม
- `Math.random()` ใน render (ควรอยู่ใน init เท่านั้น)

### B. Canvas Gradient / Path ที่ไม่ Cache
- `createLinearGradient`, `createRadialGradient` ที่เรียกทุกเฟรมโดยไม่มี dirty flag
- `ctx.font = ...` ที่ set ค่าเดิมซ้ำทุกเฟรม (browser ทำ string compare ทุกครั้ง)
- `beginPath` + path ซับซ้อนที่ shape ไม่เปลี่ยน (ควรใช้ `Path2D` cache)

### C. Canvas Layer ผิด (สเปก §0)
- สิ่งที่ **ควรอยู่บน bgCanvas** (วาดครั้งเดียว) แต่กลับวาดบน fxCanvas ทุกเฟรม:
  - พื้นหลัง, ต้นไม้, พระจันทร์, ดาวคงที่
- สิ่งที่ **ควรอยู่บน fxCanvas** แต่วาดบน bgCanvas:
  - หม้อ, ฟอง, particle (ต้องลบทุกเฟรม)

### D. Event Listener รั่ว
- `addEventListener` ที่ไม่มี `removeEventListener` คู่ใน cleanup path
- โดยเฉพาะ: `window.addEventListener` ใน module-level scope ที่ไม่มี destroy()
- `recog.onresult`, `recog.onend` ที่ assign ใหม่โดยไม่ลบตัวเก่า (Speech API)

### E. Audio Timing
- `audio.duck()` เรียกโดยไม่มี `audio.unduck()` คู่ในทุก code path (BGM ค้าง muted)
- `speechSynthesis.speak()` ก่อน cancel ตัวก่อน — ถ้าขาด อาจ queue ล้น
- `Howler.ctx.resume()` (ถ้าเพิ่ม Howler ในอนาคต) ต้องอยู่ใน user gesture เท่านั้น

### F. Memory Pattern อื่น
- `setTimeout` / `setInterval` ที่ไม่มี `clearTimeout`/`clearInterval` ใน `stop()`
- Closure ที่ capture array ใหญ่ (เช่น `bubbles`, `particles`) โดยไม่จำเป็น

## รูปแบบรายงาน

```
📊 Game Loop Audit
──────────────────────────────────────────
✅ ไม่พบปัญหา       : GC pressure (ใช้ object pool ถูกต้อง)
⚠️  ควรแก้ (2 จุด)  :
   scene.js:145  createRadialGradient เรียกทุกเฟรม — cache ด้วย dirty flag
   game.js:87    `${r}px 'Sarabun'` ใน drawBubble() — cache font string
❌ ต้องแก้ทันที (1) :
   game.js:205   window.addEventListener('resize') ไม่มี removeEventListener ใน stop()
──────────────────────────────────────────
```

## ระดับความรุนแรง
- **❌ ต้องแก้ทันที**: memory leak, canvas layer ผิดที่กิน fps ชัดเจน, duck ไม่มี unduck
- **⚠️ ควรแก้**: gradient ไม่ cache, font string ซ้ำ, pattern ที่จะเป็นปัญหาเมื่อ word count เพิ่ม
- **ℹ️ สังเกต**: pattern ที่โอเคตอนนี้แต่ควรดูถ้า content เพิ่ม

## หลังรายงาน
ถามว่าต้องการแก้ไข ❌ หรือ ⚠️ อันไหนบ้าง
แก้ได้เฉพาะที่บอก ห้าม refactor ส่วนที่ไม่เกี่ยวกับ performance
