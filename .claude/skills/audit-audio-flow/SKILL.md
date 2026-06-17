---
description: ตรวจความสมดุล duck/unduck, speak/cancel, recog.start/stop ทุก code path — ป้องกัน BGM ค้าง muted
---

# /audit-audio-flow

ตรวจว่าทุก audio state call มี pair ครบทุก exit path
เป้าหมาย: ไม่มีกรณีที่ BGM ค้าง muted, ไม่มี TTS queue ล้น, ไม่มี microphone ค้าง active

## ไฟล์ที่ตรวจ
`src/audio.js`, `src/game.js`, `src/main.js`, `src/input/speech.js`

---

## หมวด A — Duck / Unduck balance

สร้าง call graph ของทุก `audio.duck()` และ `audio.unduck()`:

1. หา **ทุก call site** ของ `duck()` ใน codebase
2. สำหรับแต่ละ call site ตรวจทุก execution path ที่ออกจาก scope นั้น:
   - normal completion → มี `unduck()` ไหม
   - early return / throw → มี `unduck()` ไหม
   - timeout / callback path → `unduck()` ถูกเรียกแน่นอนไหม แม้ callback ไม่ถูกเรียก (เช่น SpeechSynthesis `onerror` ไม่ fire บน iOS)
   - user กด back button กลาง LISTENING state → `game.stop()` เรียก `unduck()` ไหม

**Pattern ที่ต้องระวังเป็นพิเศษ:**
```
duck() → speak() → { onend: unduck() }
                     onerror: unduck() ← ต้องมี
                     user navigates away ← stop() ต้องมี unduck()
```

---

## หมวด B — SpeechSynthesis speak/cancel balance

1. หาทุกที่ที่เรียก `speechSynthesis.speak()` หรือ `audio.speak()` / `audio.voice()`
2. ตรวจว่า:
   - มี `speechSynthesis.cancel()` ก่อน `.speak()` ใหม่ทุกครั้ง (ป้องกัน utterance queue สะสม)
   - มี path ที่ cancel ถ้า game หยุด (`game.stop()`) — โดยเฉพาะระหว่าง `playSpellReveal` ที่มี setTimeout chain
   - `onend` และ `onerror` ครอบคลุม: ถ้า `onerror` fire แล้ว `onEnd` callback ยัง chain ต่อได้ไหม (infinite loop risk)

3. ตรวจ **setTimeout chain** ใน `playSpellReveal`:
   ```
   setTimeout(next) → speak → onEnd → setTimeout(next) → ...
   ```
   ถ้า `game.stop()` ถูกเรียกกลางกระบวนการ — chain นี้หยุดได้ไหม (ต้องมี `running` flag หรือ cancel token)

---

## หมวด C — Speech Recognition start/stop balance

1. หาทุก `recog.start()` call ใน `speech.js` และ `game.js`
2. ตรวจทุก exit path มี `recog.stop()`:
   - ผู้ใช้กดปุ่ม OK / ลองใหม่ กลาง LISTENING → stop ก่อน evaluate ไหม
   - ผู้ใช้กด back button กลาง LISTENING → `game.stop()` เรียก `recog.stop()` ไหม
   - `onend` fire เองโดยไม่มี result (timeout บางเบราว์เซอร์) → state กลับเป็น READING ไหม หรือค้าง LISTENING
   - เรียก `recog.start()` ซ้ำขณะที่ยังฟังอยู่ → `InvalidStateError` crash ไหม (ต้องเช็ค `this.listening` flag ก่อน)

---

## หมวด D — iOS / Android edge cases

1. **iOS SpeechSynthesis resume after background:**
   ถ้าผู้ใช้ lock screen แล้วกลับมา `speechSynthesis` จะ stall — มี watchdog timeout ไหม
2. **AudioContext suspended:**
   ถ้า `ctx.state === 'suspended'` แล้วเรียก `duck()` / `unduck()` — `gain.linearRampToValueAtTime` จะ queue ไว้แล้ว fire พร้อมกันตอน resume — ผลลัพธ์เป็นอย่างไร
3. **Web Speech Recognition บน Chrome Android:**
   timeout สั้นกว่า desktop — `onend` fire โดยไม่มี `onresult` ได้บ่อย — state machine จัดการไหม

---

## รูปแบบรายงาน

```
🔊 Audio Flow Audit
─────────────────────────────────────────────
A. Duck/Unduck
   ✅ playVoice()     — duck → speak → onend:unduck ✓, onerror:unduck ✓
   ❌ startListening() — duck ที่บรรทัด 183 ไม่มี unduck ถ้า recog.onerror fire แบบ silent

B. Speak/Cancel
   ✅ speak()         — cancel() ก่อน speak() ทุกครั้ง
   ⚠️ playSpellReveal — setTimeout chain ไม่มี abort path ถ้า game.stop() เรียกกลางสาย

C. Recog Start/Stop
   ✅ okBtn handler   — recog.stop() ก่อน evaluate()
   ❌ game.stop()     — ไม่เรียก recog.stop() → mic อาจ active ค้างหลังออกจากด่านอ่าน

D. Edge Cases
   ⚠️ iOS stall       — ไม่มี watchdog timeout สำหรับ speechSynthesis ที่ stall หลัง background

สรุป: ❌ 2 จุดต้องแก้, ⚠️ 2 จุดควรแก้
─────────────────────────────────────────────
```

## หลังรายงาน
- ❌ ต้องแก้ก่อน deploy บน mobile
- ⚠️ ควรแก้ก่อน รองรับ iOS
- ถามว่าต้องการแก้ไขทันทีหรือไม่ แก้ได้เฉพาะ `audio.js`, `game.js`, `input/speech.js` เท่านั้น
