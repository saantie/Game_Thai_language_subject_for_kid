---
description: migration guide เปลี่ยน Web Audio synthesis + TTS → Howler.js + ไฟล์เสียงจริง ตามสเปก §4
---

# /swap-audio

Migration checklist สำหรับเปลี่ยนระบบเสียงจาก prototype (Web Audio API + SpeechSynthesis)
ไปเป็น production (Howler.js + audio sprite + ไฟล์ `.webm`/`.mp3`) ตามสเปก §4

ใช้เมื่อ: ไฟล์เสียงจริงพร้อมแล้ว (`sfx.webm`, `sfx.mp3`, `forest_bgm.mp3`, `vo/*.mp3`)
**ห้ามรัน skill นี้ถ้าไฟล์ยังไม่ครบ** — migration ครึ่งทางทำให้เกมพังทั้งหมด

---

## ก่อนเริ่ม — ตรวจ prerequisite

1. อ่าน directory `public/assets/audio/` ว่ามีไฟล์ใดบ้าง
2. ตรวจสอบว่ามีครบตามสเปก §4.1–4.2:
   ```
   sfx.webm / sfx.mp3          ← audio sprite รวม SFX
   forest_bgm.mp3              ← BGM loop
   vo/greet_1.mp3, greet_2.mp3
   vo/read_1.mp3
   vo/correct_1-3.mp3
   vo/retry_1-2.mp3
   vo/reveal_1-2.mp3
   ```
3. ถ้าไฟล์ไม่ครบ — รายงานว่าขาดอะไร และหยุด (อย่า migrate แบบครึ่งทาง)

---

## Step 1 — ติดตั้ง Howler.js

เพิ่มใน `index.html` ก่อน `<script type="module" src="src/main.js">`:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js"></script>
```

หรือถ้าต้องการ offline-first (PWA) ดาวน์โหลด `howler.min.js` ไว้ใน `public/` และอัปเดต `sw.js` (รัน `/sw-sync` หลัง step นี้)

---

## Step 2 — อ่าน audio sprite timing

อ่านไฟล์ sprite spec (จากทีม sound design หรือ `audiosprite` CLI output)
ตัวอย่าง format ที่ต้องการ:
```js
sprite: {
  pick:       [0,    300],
  boom:       [400,  800],
  bubble:     [1300, 600],
  star:       [2000, 500],
  wrong_soft: [2600, 400],
  chime:      [3100, 600],
}
```
ถ้ายังไม่มี spec — หยุดและถามผู้ใช้ก่อน อย่าเดา timing

---

## Step 3 — เขียน `src/audio.js` ใหม่

เขียน implementation ใหม่ทับ `audio.js` เดิม โดย:

**คง interface เดิมทุกอย่าง** (game.js, scene.js ห้ามแก้):
```js
audio.unlock()
audio.sfx(name)        // ชื่อ key เดิม: 'pick','boom','bubble','star','wrong_soft','chime'
audio.voice(key, opts) // key: 'greet','read','correct','retry','reveal','wrong'
audio.speak(text, opts)
audio.playSpellReveal(word, done)
audio.duck()
audio.unduck()
audio.setBgmEnabled(on)
audio.stopSpeaking()
```

**Implementation ใหม่ตามสเปก §4:**
```js
// SFX sprite
const sfx = new Howl({
  src: ['assets/audio/sfx.webm', 'assets/audio/sfx.mp3'],
  sprite: { /* timing จาก Step 2 */ },
});

// BGM
const bgm = new Howl({
  src: ['assets/audio/forest_bgm.mp3'],
  loop: true,
  volume: 0.30,
});

// Voice pool (สุ่มกันจำเจ ตามสเปก §4.2)
const VOICE_FILES = {
  greet:   ['vo/greet_1.mp3', 'vo/greet_2.mp3'],
  correct: ['vo/correct_1.mp3', 'vo/correct_2.mp3', 'vo/correct_3.mp3'],
  // ...
};
```

**จุดที่พลาดบ่อย — ตรวจให้ครบ:**
- `duck()`: ใช้ `bgm.fade(bgm.volume(), 0.06, 250)` แทน `gainNode`
- `unduck()`: ใช้ `bgm.fade(bgm.volume(), bgmTarget, 400)`
- `unlock()`: `if (Howler.ctx.state === 'suspended') Howler.ctx.resume()` — **ต้องอยู่ใน user gesture**
- Voice `onEnd`: ใช้ `howl.once('end', callback)` ไม่ใช่ `.on('end')` (ป้องกัน listener สะสม)
- ถ้า voice ไฟล์ยาว > 10s ให้แยกเป็น `new Howl()` แต่ละไฟล์ (ไม่ใส่ใน sprite)

---

## Step 4 — Preload strategy (สเปก §4.4)

เพิ่ม preload ใน `main.js` ตอนเริ่มมาตรา:
```js
// preload เมื่อเลือกมาตรา ก่อนเข้าเกม
function startMatraById(id) {
  audio.preloadForMatra(id);   // โหลด sfx, bgm, correct, retry, read
  showScreen('game');
  game.startMatra(matra);
}
```

เสียงเฉลยสะกด (`spell`) ให้ lazy-load ตามคำที่กำลังเล่น ไม่ preload ทั้งหมด

---

## Step 5 — ตรวจหลัง migrate

รันในลำดับนี้:
1. `/audit-audio-flow` — ตรวจ duck/unduck balance ใน implementation ใหม่
2. `/sw-sync` — เพิ่มไฟล์เสียงใหม่เข้า APP_SHELL
3. ทดสอบ **iOS Safari** โดยเฉพาะ:
   - autoplay unlock ทำงานไหม (กด startBtn แล้วได้ยินเสียงไหม)
   - Web Speech Recognition fallback ทำงานไหม (ปุ่ม ✅ / 🔁 แสดงแทน mic)
4. ทดสอบ **Chrome Android** ด้วยตัดการเชื่อมต่อ (offline mode) — เสียงมาจาก cache ไหม

---

## สิ่งที่ห้ามทำระหว่าง migrate
- ห้ามแก้ `game.js`, `scene.js`, `ui/*.js` — interface ต้องเหมือนเดิม
- ห้าม mix implementation (บางฟังก์ชันยังเป็น Web Audio, บางฟังก์ชันเป็น Howler) — ทำให้ duck behavior ไม่ consistent
- ห้าม commit กลางทาง — migrate ให้เสร็จใน session เดียวแล้วรัน `/audit-audio-flow` ก่อน
