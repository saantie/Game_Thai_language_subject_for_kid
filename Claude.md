# Technical Implementation Spec (v2)
## "Witch's Cauldron" — มาตราตัวสะกด / เสียง / ฉาก-แม่มด / คู่มือผู้ใหญ่

เอกสารนี้เป็นรายละเอียดเชิงเทคนิคของ 4 ฟีเจอร์ใน Addendum v2 ครอบคลุม data model, state machine, ระบบเสียง (Howler.js), การ render เลเยอร์ฉาก และ performance — ให้พร้อมนำไป implement ต่อ

---

## 0. สถาปัตยกรรมเลเยอร์ (Rendering Stack)

ฉากป่า + ภาพกล้อง + เกม วาดคนละชั้นเพื่อ performance (ฉากนิ่งไม่ต้องวาดซ้ำทุกเฟรม):

```
z-index สูงสุด ─────────────────────────────
  [4] UI overlay (DOM)     : HUD, voicebar, ปุ่ม, หน้าเลือกมาตรา
  [3] #fxCanvas            : ฟอง + particle + คำผสม + ดาว (วาดทุกเฟรม)
  [2] <img class=witch>    : แม่มด (DOM + CSS sprite animation)
  [1] #camVideo (optional) : ภาพกล้อง AR (mirror)  — เปิดเฉพาะโหมดกล้อง
  [0] #bgCanvas / CSS bg   : ฉากป่า (วาดครั้งเดียว / static)
z-index ต่ำสุด ─────────────────────────────
```

เหตุผล: ใน loop เดิมทุกอย่างวาดบน canvas เดียว ทำให้ต้องเคลียร์และวาดฉากป่าใหม่ทุกเฟรม (เปลือง) แยกฉากป่าออกเป็น `#bgCanvas` ที่วาดครั้งเดียวตอนโหลด แล้ว `#fxCanvas` โปร่งใสซ้อนบน วาดเฉพาะของที่เคลื่อนไหว ลดงานวาดลงมาก

```js
// fxCanvas ต้องโปร่งใส — เคลียร์ด้วย clearRect ไม่ใช่ fillRect
fx.clearRect(0, 0, W, H);
```

---

## 1. Data Model — มาตราตัวสะกด

```js
// data/matra.js  — แก้ไข/เพิ่มคำได้โดยไม่แตะโค้ดเกม
export const MATRA = [
  {
    id: 'kaka', name: 'แม่ ก กา', mode: 'TWO_PART',   // พยัญชนะต้น + สระ
    sara: 'า',
    words: [
      { display:'กา', lead:'ก', sara:'า', spell:['กอ','อา','กา'] },
      { display:'มา', lead:'ม', sara:'า', spell:['มอ','อา','มา'] },
      // ... ตา ขา ปา ยา
    ],
    // โหมดนี้ "ฟอง = พยัญชนะต้น" ลากตัวไหนก็ได้ → ทุกคู่เป็นคำจริง
    bubbles: ['ก','ม','ต','ข','ป','ย'],
  },
  {
    id: 'kong', name: 'แม่ กง', mode: 'FILL_FINAL',    // ล็อกโจทย์ + เติมตัวสะกด
    finalSound: 'ง',
    words: [
      { display:'ลิง', lead:'ลิ', final:'ง', spell:['ลอ','อิ','งอ','ลิง'], distractors:['ม','น','ก'] },
      { display:'สิง', lead:'สิ', final:'ง', spell:['สอ','อิ','งอ','สิง'], distractors:['ด','บ','ย'] },
      // ...
    ],
  },
  // กม เกย เกอว กน กก กด กบ ...
];
```

**กฎสำคัญที่เกิดจากการเพิ่มมาตรา:** ในแม่ ก กา ทุกพยัญชนะ + า เป็นคำจริง จึง "หยิบตัวไหนก็ได้" ได้ แต่พอมีตัวสะกด (เช่น ลิ + ม = "ลิม" ไม่ใช่คำ) Speech Recognition จะ validate ไม่ได้ ดังนั้นโหมด `FILL_FINAL` ต้อง **มีคำเป้าหมายชัดเจน** และตรวจตัวสะกดตอนหย่อน (ผิด = เด้งกลับอย่างนุ่มนวล) ส่วนการอ่านออกเสียงยังเป็นด่านสุดท้ายเพื่อรับดาวเหมือนเดิม

---

## 2. หน้าเลือกมาตรา (Level Select)

สร้างจาก data โดยตรง ไม่ฮาร์ดโค้ด:

```js
function buildLevelSelect() {
  const grid = document.getElementById('levelGrid');
  grid.innerHTML = '';
  MATRA.forEach((m, i) => {
    const card = document.createElement('button');
    card.className = 'level-card';
    card.disabled = !isUnlocked(i);                 // ปลดล็อกตามความคืบหน้า
    card.innerHTML = `<span class="lv-name">${m.name}</span>
                      <span class="lv-stars">${getStars(m.id)}/3 ⭐</span>`;
    card.onclick = () => startMatra(m.id);
    grid.appendChild(card);
  });
}
// progress เก็บใน state กลางของแอป (อย่าใช้ localStorage ในต้นแบบ artifact;
// production ใช้ IndexedDB/Firebase ตาม Overview)
```

`startMatra(id)` โหลดชุดคำของมาตรานั้น, สุ่มลำดับคำ, สร้างฟองตาม `mode`, แล้วเข้าสู่ game loop

---

## 3. กลไกเกม + State Machine (รองรับ 2 โหมด)

### 3.1 State machine ปรับใหม่
```
SELECT → IDLE → DRAGGING → DROPPED
  ├─ TWO_PART  : หย่อนในหม้อ = ผสมได้เลย → READING
  └─ FILL_FINAL: หย่อนในหม้อ → ตรวจตัวสะกด
        ├─ ตรง  → blend → READING
        └─ ผิด  → bounce back + เสียงแม่มด "ลองใหม่นะจ๊ะ" (ไม่นับ attempt การอ่าน)
READING → LISTENING → EVALUATING
   ├─ ถูก       → REWARD (ดาว) → IDLE/คำถัดไป
   ├─ ผิดครั้ง1 → RETRY → READING
   └─ ผิดครั้ง2 → REVEAL (เฉลยเสียงสะกด) → IDLE/คำถัดไป
```

### 3.2 ตรรกะตอนหย่อนฟอง
```js
function dropInCauldron(bubble) {
  const word = currentWord;
  if (currentMatra.mode === 'FILL_FINAL') {
    if (bubble.letter !== word.final) {
      bounceBack(bubble);            // เด้งกลับลอยขึ้นบน
      audio.voice('retry');          // เสียงแม่มดให้กำลังใจ
      audio.sfx('wrong_soft');
      return;                        // ไม่เข้าสู่รอบอ่าน
    }
  }
  bubble.dead = true;
  audio.sfx('boom');
  spawnExplosion(cauldron.cx, cauldron.cy);
  blendWord = { word: word.display, t: now() };
  witch.play('cast');                // อนิเมชันแม่มดยกไม้กายสิทธิ์
  setTimeout(() => startReadingRound(true), 900);
}
```

### 3.3 โจทย์ในหม้อ (โหมด FILL_FINAL)
หม้อแสดง `lead` + ช่องว่างเรืองแสง เช่น `ลิ▢` เพื่อบอกว่าต้องเติมตัวสะกด:
```js
function drawCauldronPrompt(word) {
  fx.fillText(word.lead, slotX, slotY);
  // ช่องว่างกระพริบให้รู้ว่าต้องเติมตรงนี้
  const pulse = 0.5 + 0.5*Math.sin(now()*0.005);
  fx.globalAlpha = pulse;
  fx.strokeRect(blankX, blankY, slotW, slotH);
  fx.globalAlpha = 1;
}
```

### 3.4 ฟอง distractor
โหมด FILL_FINAL: ฟอง = ตัวสะกดถูก 1 ตัว + distractors จาก data (สุ่มตำแหน่ง):
```js
function spawnBubbles(word, matra) {
  const letters = matra.mode === 'FILL_FINAL'
    ? shuffle([word.final, ...word.distractors])
    : matra.bubbles;
  bubbles = letters.map(ch => new Bubble(ch));
}
```

### 3.5 Pinch ↔ Pointer (input layer)
input แยกเป็นโมดูลเดียว ส่งออก event เดียวกัน เกมไม่รู้ว่ามาจากนิ้วจริงหรือเมาส์:
```js
// input/pointer.js  (ต้นแบบ)  และ  input/handpinch.js (MediaPipe)
// ทั้งคู่ยิง onPick(x,y) / onMove(x,y) / onRelease(x,y) เหมือนกัน
emitter.on('pick',    (x,y) => tryGrab(x,y));
emitter.on('move',    (x,y) => moveHeld(x,y));
emitter.on('release', (x,y) => releaseHeld(x,y));
```
> สลับเป็น MediaPipe ภายหลังโดยเปลี่ยนเฉพาะตัว emit (pinch detection ตาม Overview เดิม: distance นิ้วโป้ง-ชี้ + normalize ด้วยขนาดมือเพื่อกัน scale variance ที่เคยเตือนไว้)

---

## 4. ระบบเสียง (Howler.js) — SFX / BGM / Voice

### 4.1 Audio sprite (รวมไฟล์ ลด HTTP request + ดีเลย์)
ใช้ audio sprite สำหรับ SFX/เสียงพากย์สั้น (สร้าง sprite ด้วย `audiosprite` CLI):
```js
import { Howl, Howler } from 'howler';

const sfx = new Howl({
  src: ['assets/audio/sfx.webm', 'assets/audio/sfx.mp3'], // 2 ฟอร์แมต fallback
  sprite: {
    pick:       [0,    300],
    boom:       [400,  800],
    bubble:     [1300, 600],
    star:       [2000, 500],
    wrong_soft: [2600, 400],
    chime:      [3100, 600],
  },
});

const bgm = new Howl({ src:['assets/audio/forest_bgm.mp3'], loop:true, volume:0.30 });
```

### 4.2 Voice pool (สุ่มเสียงแม่มดกันจำเจ)
เสียงพากย์ยาวกว่าให้แยกไฟล์ แล้ว map เป็น pool:
```js
const VOICE = {
  greet:   ['vo/greet_1.mp3','vo/greet_2.mp3'],
  read:    ['vo/read_1.mp3'],
  correct: ['vo/correct_1.mp3','vo/correct_2.mp3','vo/correct_3.mp3'], // "เก่งมากจ้า!" ฯลฯ
  retry:   ['vo/retry_1.mp3','vo/retry_2.mp3'],                        // "ลองใหม่นะจ๊ะคนเก่ง"
};
const voiceHowls = {}; // preload ที่ใช้บ่อย
function loadVoice(key){ voiceHowls[key] = VOICE[key].map(s => new Howl({src:[s]})); }

function playVoice(key, onEnd) {
  duck();                                   // หรี่ BGM
  const pool = voiceHowls[key];
  const h = pool[(Math.random()*pool.length)|0];
  h.once('end', () => { unduck(); onEnd && onEnd(); });
  h.play();
}
```

### 4.3 Ducking (หรี่ BGM ตอนแม่มดพูด / ตอนฟังไมค์)
สำคัญต่อความแม่นของ Speech Recognition — BGM ดังไประหว่างฟังจะรบกวน:
```js
let bgmTarget = 0.30;
function duck()   { bgm.fade(bgm.volume(), 0.06, 250); }
function unduck() { bgm.fade(bgm.volume(), bgmTarget, 400); }

// ต้อง duck ตลอดช่วง LISTENING ด้วย
function startListening(){ duck(); recog.start(); }
recog.onend = () => unduck();
```

### 4.4 Preload + จังหวะเฉลยสะกดคำ
```js
// เฉลย: เล่นทีละพยางค์ตาม word.spell แล้วต่อด้วยคำเต็ม
function playSpellReveal(word, done){
  audio.sfx('chime');
  let i = 0;
  (function next(){
    if (i >= word.spell.length) return done && done();
    playSyllable(word.spell[i++], next);   // ['ลอ','อิ','งอ','ลิง']
  })();
}
```
- preload ตอนเริ่มมาตรา: `sfx`, `bgm`, `correct`, `retry`, `read`
- เสียงเฉลยรายคำ (`spell`) โหลด lazy ตามคำที่กำลังเล่น
- ฟอร์แมต: ใส่ทั้ง `.webm`(Opus) และ `.mp3` ให้ Howler เลือกตามเบราว์เซอร์ (iOS = mp3)

### 4.5 Autoplay unlock (iOS/Android)
ผูกการ resume ไว้กับ user gesture แรก (ปุ่ม "เริ่มเล่น") ตาม Overview เดิม:
```js
startBtn.onclick = () => {
  if (Howler.ctx.state === 'suspended') Howler.ctx.resume();
  bgm.play();
  playVoice('greet');
};
```

---

## 5. ฉากป่า + แม่มด (Art Layer)

### 5.1 ฉากป่า: วาดครั้งเดียว / preload
```js
const bgImg = new Image();
bgImg.src = 'assets/images/forest_bg.webp';
bgImg.onload = () => drawForest();          // วาดลง #bgCanvas ครั้งเดียว
function drawForest(){
  // object-fit: cover ด้วยมือ เพื่อคุมพิกัดให้ตรงกับ fxCanvas
  const scale = Math.max(W/bgImg.width, H/bgImg.height);
  const dw = bgImg.width*scale, dh = bgImg.height*scale;
  bg.drawImage(bgImg, (W-dw)/2, (H-dh)/2, dw, dh);
  // หรี่/เบลอโซน gameplay กันลายป่ารบกวนตัวอักษร
  bg.fillStyle = 'rgba(20,8,40,0.25)';
  bg.fillRect(0, H*0.45, W, H*0.55);
}
window.addEventListener('resize', () => { resize(); drawForest(); });
```
> ทางเลือก: ถ้าฉากป่าเป็นภาพนิ่งล้วน ใช้ CSS `background-image` กับ `#bgCanvas` แทน เพื่อให้เบราว์เซอร์จัดการ scaling เอง — แต่การวาดบน canvas ทำให้คุมพิกัดให้ตรงกับ fxCanvas ได้ง่ายกว่า (สำคัญตอนซ้อนภาพกล้อง mirror)

### 5.2 แม่มด: sprite animation
สองทางเลือก —

**(ก) DOM + CSS sprite sheet** (ง่าย, แยกจาก game loop, ไม่กิน canvas):
```css
.witch { position:fixed; left:4%; bottom:10%; width:160px; height:220px;
         background:url('assets/images/witch_sheet.png') 0 0 / 400% 100%;
         image-rendering:auto; z-index:2; }
.witch.idle  { animation: witchIdle  1.2s steps(4) infinite; }
.witch.cheer { animation: witchCheer 0.6s steps(4) 2; }
@keyframes witchIdle  { to { background-position-x:-100%; } }   /* 4 เฟรม */
```
```js
const witchEl = document.querySelector('.witch');
const witch = {
  play(state){ witchEl.className = 'witch ' + state;
    if (state==='cheer'||state==='cast')          // กลับ idle หลังเล่นจบ
      setTimeout(()=>witchEl.className='witch idle', 700); }
};
```

**(ข) วาดบน canvas** (คุม z-order กับฟองได้ละเอียดกว่า แต่กินงานวาด):
```js
const frame = (now()/120|0) % witchFrames;       // step ตามเวลา
fx.drawImage(witchSheet, frame*fw,0, fw,fh,  wx,wy, fw,fh);
```
แนะนำ **(ก) DOM/CSS** สำหรับต้นแบบ — แยก concern ชัด ไม่เพิ่มภาระ game loop และ respekt `prefers-reduced-motion` ได้ง่าย

### 5.3 ทริกเกอร์อนิเมชันแม่มดผูกกับ state
```
DROPPED(ถูก)  → witch.play('cast')   // ยกไม้กายสิทธิ์
REWARD        → witch.play('cheer')  // ปรบมือ + เล่นพร้อมเสียง correct
RETRY/REVEAL  → witch.play('idle')
```

---

## 6. คู่มือผู้ใหญ่ + ทูลทิปสะกดคำ

### 6.1 Parent gate (กันเด็กกดเข้าหน้าผู้ใหญ่)
```js
// gate ง่าย ๆ ที่เด็กเล็กทำไม่ได้แต่ไม่กวนผู้ใหญ่ (ไม่ใช่ security จริง)
function openAdultPage(){
  const a = 3 + (Math.random()*6|0), b = 2 + (Math.random()*6|0);
  const ans = prompt(`สำหรับผู้ปกครอง: ${a} + ${b} = ?`);
  if (parseInt(ans,10) === a+b) showAdultPage();
}
```

### 6.2 ทูลทิปสะกดคำ (เปิด/ปิดได้)
ระหว่างรอบอ่าน แสดง `word.spell` ต่อด้วยขีดให้ผู้ใหญ่โค้ช:
```js
function renderSpellHint(word){
  hintEl.textContent = word.spell.join(' – ');   // "ลอ – อิ – งอ – ลิง"
  hintEl.style.display = adultSettings.showSpellHint ? 'block' : 'none';
}
```
ข้อมูล `spell` แก้ได้รายคำ รองรับวิธีแจกลูกที่ต่างกันระหว่างหลักสูตร (เช่น สพฐ.) — อนาคตเพิ่ม setting เลือกรูปแบบการสะกดได้

---

## 7. โครงสร้างไฟล์ที่อัปเดต

```
witch-ar-spelling/
├── index.html
├── src/
│   ├── main.js              # bootstrap, เลือกมาตรา, สลับ input layer
│   ├── game.js              # loop, state machine 2 โหมด, collision
│   ├── data/matra.js        # ★ ใหม่: ข้อมูลมาตรา+คำ+spell+distractor
│   ├── audio.js             # ★ ปรับ: Howler sprite, voice pool, ducking
│   ├── scene.js             # ★ ใหม่: render ฉากป่า (bgCanvas), แม่มด
│   ├── input/
│   │   ├── pointer.js       # ต้นแบบ (นิ้ว/เมาส์)
│   │   └── handpinch.js     # MediaPipe (สลับทีหลัง, interface เดียวกัน)
│   ├── ui/
│   │   ├── levelSelect.js   # ★ ใหม่: หน้าเลือกมาตรา
│   │   └── adultPage.js     # ★ ใหม่: คู่มือ + gate + ทูลทิป
│   └── styles.css
├── public/
│   ├── assets/images/       # forest_bg, witch_sheet, cauldron, explosion
│   ├── assets/audio/        # sfx.(webm|mp3), forest_bgm.mp3, vo/*.mp3
│   └── models/              # MediaPipe Hand Landmarker (WASM)
└── package.json
```

---

## 8. Performance checklist (ต่อจากกฎใน Overview เดิม)
- แยก `#bgCanvas` (ฉากนิ่ง วาดครั้งเดียว) ออกจาก `#fxCanvas` (ไดนามิก) — อย่าวาดฉากป่าทุกเฟรม
- ใช้ object pool สำหรับ particle/ฟอง (มีอยู่แล้วในต้นแบบ) — ไม่ new object ใน loop
- preload ภาพ+เสียงหลักก่อนเริ่มมาตรา, lazy-load เสียงเฉลยรายคำ
- audio sprite ลดดีเลย์เสียงสั้น (boom/star) บนมือถือ
- แม่มดใช้ CSS animation (compositor) ไม่กิน main thread/game loop
- `Howler.ctx.resume()` ใน user gesture แรกเท่านั้น
- ตั้ง `image-rendering` และขนาดภาพให้พอดี DPR เพื่อไม่ให้ texture ใหญ่เกินจำเป็นบนมือถือ

---

## 9. สิ่งที่ยังต้องเคาะ (technical decision)
1. โหมด `FILL_FINAL`: ยืนยันว่าหย่อนตัวสะกดผิด = เด้งกลับ (ไม่ปล่อยให้ผสมคำที่ไม่มีจริง เพราะ STT validate ไม่ได้)
2. iOS Safari ไม่มี Web Speech API → เลือก Cloud STT (มี backend + ส่งเสียงขึ้น cloud, มีนัย PDPA) หรือคงโหมดผู้ปกครองช่วยฟัง
3. รูปแบบ audio sprite vs ไฟล์แยก สำหรับเสียงพากย์ (sprite ดีเลย์ต่ำ แต่แก้ทีละชิ้นยากกว่า)
4. แม่มดแบบ DOM/CSS (แนะนำ) vs canvas — กระทบการซ้อน z-order กับฟอง
```
