---
description: คู่มือ + กฎการแก้ไข Web Speech API (input/speech.js) และ flow การฟังเสียงอ่านใน game.js — บทเรียนจาก bug จริงที่เคยพัง 2 รอบ (retry-loop, continuous mode) ก่อนจะกลับมาเสถียร + ฟีเจอร์ mic auto-retry
---

# /speech-recognition-guide

คู่มือนี้ครอบคลุม `src/input/speech.js` (Web Speech Recognition wrapper) และ flow
การฟังเสียงอ่านใน `src/game.js` (`listen()`/`evaluate()`) — เขียนขึ้นหลังจากเจอบั๊ก
จริงและแก้ผิดทางมาแล้ว 2 รอบ ก่อนจะเจอจุดที่เสถียร (v136) แล้วต่อยอดฟีเจอร์ mic
auto-retry (v137)

---

## กฎเหล็ก: อย่าแตะกลไก SpeechRecognition โดยไม่ทดสอบมือถือจริง

**ประวัติที่เกิดขึ้นจริง** (เรียงตามเวลา):

1. **v133** — ปัญหา "ไมค์บอกไม่ได้ยินบ่อย + อ่านถูกแต่ตัดสินผิด" แก้ด้วยการเพิ่ม
   retry-loop ใน `game.js`'s `listen()`: ถ้า recognizer จบ session โดยไม่ได้ยิน
   ภายใน 5 วิแรก ให้ `setTimeout(attempt, 150)` สร้าง `SpeechRecognition` ใหม่วนไป
2. **บั๊กที่เกิดจากข้อ 1** — ผู้ใช้รายงาน "ไมค์ฟังคำอ่านไม่ครบ" วิเคราะห์แล้วพบว่า
   retry-loop สร้าง instance ใหม่ทุก ~150ms ซึ่งแต่ละ instance เป็นคนละ audio stream
   กัน เสียงพูดต่อเนื่องของเด็ก (ยาวกว่า 150ms แน่นอน) จึงถูกตัดคร่อมระหว่าง session
3. **v135** — แก้ข้อ 2 ด้วย `recog.continuous = true` (session เดียวฟังต่อเนื่อง
   ไม่ restart) + `interimResults:true` — **พิสูจน์ด้วย mock SpeechRecognition ว่า
   กลไกถูกต้อง** (1 instance ตลอด, จับ speech ที่มาช้าได้) แต่...
4. **ผู้ใช้ทดสอบมือถือจริงแล้วแย่กว่าเดิม** — ไมค์จับเสียงอ่านไม่ได้เลย แย่กว่า
   retry-loop เดิมเสียอีก
5. **v136** — กลับไปใช้ `createRecognizer()` แบบมาตรฐานที่สุดเป๊ะๆ ตาม
   commit `169585f` (ก่อน v133): `interimResults:false`, ไม่มี `continuous`,
   เรียก `recog.start()` ครั้งเดียวไม่มี retry-loop — ใช้ได้ดี ยืนยันจากผู้ใช้แล้ว
6. **v137** — เพิ่มฟีเจอร์ mic auto-retry (ดูหัวข้อถัดไป) **โดยไม่แตะกลไก
   recognizer เลย** — แก้ที่ชั้น UX/game.js เท่านั้น

**บทเรียน:** mock-based unit test พิสูจน์ได้แค่ "โค้ดของเราทำงานตามที่ออกแบบไว้"
ไม่ได้พิสูจน์ "เบราว์เซอร์จริงบนมือถือ (โดยเฉพาะ Android Chrome) จะตอบสนองต่อ
`continuous`/`interimResults` ยังไง" — พฤติกรรมจริงต่างจาก mock ได้มาก

**กฎที่ต้องทำตาม:**
- ✅ **ปลอดภัย แก้ได้อิสระ**: `matchWord()` ใน speech.js (normalize/fuzzy logic
  เทียบข้อความหลังได้ transcript มาแล้ว — ไม่เกี่ยวกับกลไก recognizer เลย),
  UX layer ใน game.js ที่ไม่แตะ `recog.start()`'s options (เช่น auto-retry ข้อ
  ถัดไป, ข้อความ mic state, เสียงพากย์)
- ❌ **ห้ามแตะโดยไม่ทดสอบมือถือจริงก่อน**: `recog.continuous`, `recog.interimResults`,
  การ restart/สร้าง `SpeechRecognition` instance ใหม่ระหว่างฟัง, การเปลี่ยน
  `recog.start()`'s call pattern ใน `speech.js`
- ถ้าจำเป็นต้องทดลองกลไกใหม่: บอกผู้ใช้ตรงๆ ว่า "อันนี้ยังไม่ผ่านทดสอบมือถือจริง
  ต้องลองก่อนถึงจะรู้ผล" อย่านำเสนอ mock test ว่าเป็นการยืนยันว่าใช้งานได้จริง
- ถ้าผู้ใช้รายงานว่าแก้แล้วแย่ลง: revert กลับจุดที่ยืนยันแล้วว่าดีทันที (เช็ค
  git log หา commit ที่ตรงกับคำอธิบาย "ใช้ได้ดี" ของผู้ใช้) อย่าพยายามปรับจูนต่อ
  บนกลไกที่ยังพิสูจน์ไม่ได้

**Baseline ปัจจุบันที่ยืนยันแล้วว่าใช้ได้ดี** (v136, `src/input/speech.js`):
```js
start(onResult, onEnd) {
  if (!supported) { onEnd && onEnd(); return; }
  const recog = new SR();
  this._recog = recog;
  recog.lang = 'th-TH';
  recog.interimResults = false;
  recog.maxAlternatives = 5;
  this.listening = true;
  recog.onresult = (e) => {
    const alts = [];
    for (let i = 0; i < e.results[0].length; i++) alts.push(e.results[0][i].transcript);
    onResult && onResult(alts);
  };
  let fired = false;
  const finish = () => {
    if (fired) return;
    fired = true;
    this.listening = false;
    onEnd && onEnd();
  };
  recog.onerror = () => finish();
  recog.onend = () => finish();
  try { recog.start(); } catch (e) { this.listening = false; onEnd && onEnd(); }
},
```
ไม่มี retry-loop, ไม่มี continuous, ไม่มี interim fallback — เรียบง่ายที่สุดเท่าที่
จะเป็นไปได้ นี่คือจุดอ้างอิงที่ต้องกลับมาถ้าทดลองอะไรแล้วพัง

---

## matchWord() — ปลอดภัยที่จะปรับปรุงต่อ

`matchWord(alternatives, target)` เทียบ transcript ที่ได้จาก STT กับคำเป้าหมาย
โดย normalize เสียงพ้อง (ใ/ไ, ณ/น, ญ/ย, ฬ/ล, ศ/ษ/ส, ฒ/ฑ/ธ/ท, ฎ/ด) ก่อนเช็ค
substring แล้วค่อย fallback เป็น fuzzy match ด้วย Levenshtein distance (ทนได้
~35% ของความยาวคำ, คำสั้น 1-2 ตัวอักษรยังเข้มงวดเพราะ threshold คำนวณจากสัดส่วน
ความยาว) — logic นี้ทำงาน**หลังจาก**ได้ transcript มาแล้ว ไม่เกี่ยวกับกลไก
recognizer จึงปรับปรุงเพิ่มได้โดยไม่เสี่ยงทำให้ recognizer พัง (ต่างจากกฎเหล็ก
ด้านบน) เช่น เพิ่มกฎเสียงพ้องอื่นๆ หรือปรับ threshold fuzzy หากพบว่ายังเข้มงวด/
หลวมเกินไปจากการทดสอบจริง

ทดสอบ `matchWord()` ได้ตรงๆ ด้วย Node (ไม่ต้องพึ่ง browser):
```bash
node --input-type=module -e "
globalThis.window = {};
const { matchWord } = await import('./src/input/speech.js');
console.log(matchWord(['ลิง'], 'ลิง'));
"
```

---

## Mic auto-retry (v137) — ไมค์ตัดโดยพูดไม่ทัน ให้บอกแล้วเปิดใหม่เอง

ก่อนหน้านี้ถ้าไมค์จบ session โดยไม่ได้ยินอะไรเลย (เด็กพูดไม่ทัน/เริ่มช้า) เกม
จะโชว์ข้อความ "ไม่ได้ยินเสียง ลองกดพูดอีกครั้งนะ" แล้วรอให้เด็กกดปุ่มไมค์เอง —
ตอนนี้เกมพูด **"เอาใหม่ค่ะ"** (สุ่มจาก `VOICE.mic_retry`) แล้ว**เปิดไมค์ให้เอง
อัตโนมัติ** ไม่ต้องกดปุ่ม

**กลไก** (ทั้งหมดอยู่ใน `game.js`, ไม่แตะ `speech.js`):
- `micMissCount` (ตัวแปร state ต่อรอบพูด) นับจำนวนครั้งที่ auto-retry ไปแล้ว
- `MIC_AUTO_RETRY_MAX = 2` — auto พูด+เปิดไมค์ใหม่ได้สูงสุด 2 ครั้งต่อคำ ก่อนจะ
  fallback ไปโชว์ข้อความให้กดปุ่มเอง (**กัน infinite loop** ถ้า mic permission
  หลุด/mic เสียจริงระหว่างเล่น — ไม่งั้นเกมจะพูด "เอาใหม่ค่ะ" วนไม่รู้จบ)
- Reset `micMissCount = 0` ที่ 2 จุด: `startReadingRound()` (คำใหม่) และ
  `evaluate()`'s wrong-answer retry branch (ตอบผิดรอบใหม่) — แต่ละ "โอกาสพูดใหม่
  จริงๆ" ควรได้ budget auto-retry เต็มอีกครั้ง ไม่สะสมข้ามคำ/ข้ามรอบ
- `evaluate()` **ไม่ถูกเรียก**ในเส้นทางนี้ — ไมค์ไม่ได้ยินไม่นับเป็น "ตอบผิด"
  (`readAttempts` ไม่เพิ่ม) ต่างจากตอบผิดจริงที่ต้องเดาะ 2 ครั้งก่อนเฉลย

**ทดสอบด้วย mock** (ปลอดภัย เพราะทดสอบ UX/counting logic ใน game.js ไม่ใช่
กลไก recognizer): จำลอง `window.webkitSpeechRecognition` ที่ยิง `onerror`
ทันทีทุกครั้ง (ไม่เคย `onresult`) นับจำนวนครั้งที่ `.start()` ถูกเรียก — ควรได้
1 (ครั้งแรก) + สูงสุด `MIC_AUTO_RETRY_MAX` (auto-retry) = ไม่เกิน 3 ครั้งรวม
แล้วหยุด (ไม่เพิ่มต่อแม้รอนานแค่ไหน) ตัวอย่าง harness อยู่ใน scratchpad ของ
session ที่เขียนฟีเจอร์นี้ (ค้นด้วยชื่อ `mic-auto-retry-test.mjs` ถ้ายังอยู่ใน
scratchpad, หรือเขียนใหม่ตามแพทเทิร์นนี้)

**⚠️ ทดสอบ mock นี้ยืนยันแค่ "counting/state logic ถูกต้อง"** ไม่ได้ยืนยันว่า
เสียงพากย์ "เอาใหม่ค่ะ" ฟังดูเป็นธรรมชาติ/จังหวะเหมาะสมบนมือถือจริง — ควรฟัง
จริงอย่างน้อยหนึ่งรอบก่อน deploy

---

## Checklist ก่อนแก้ไขส่วนนี้เพิ่มเติม

- [ ] ถ้าจะเปลี่ยน `recog.continuous`/`interimResults`/restart pattern →
      หยุด อ่านหัวข้อ "กฎเหล็ก" ด้านบนก่อน แล้วถามผู้ใช้ว่าจำเป็นจริงไหม
- [ ] ถ้าจะปรับ `matchWord()` → ทดสอบด้วย Node script ตรงๆ ได้เลย (ไม่ต้องเปิด
      browser) เพิ่ม test case ให้ครอบคลุมทั้งกรณีที่ควรผ่านและไม่ควรผ่าน
- [ ] ถ้าจะแก้ auto-retry/UX flow → ตรวจว่า `micMissCount` reset ครบทุกจุดที่
      เป็น "โอกาสพูดใหม่จริงๆ" (ไม่ใช่แค่ตอน mic miss)
- [ ] ทุกครั้งที่แก้กลไก recognizer (ไม่ใช่แค่ matchWord/UX) → บอกผู้ใช้ชัดเจน
      ว่ายังไม่ผ่านทดสอบมือถือจริง รอ feedback ก่อนถือว่าเสร็จ
