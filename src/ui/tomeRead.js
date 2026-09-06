// ui/tomeRead.js — overlay อ่านคำจากคัมภีร์มนตราพิเศษ (บนแผนที่ RPG)
//
// เก็บคัมภีร์ → ต้องอ่านสะกดคำ 1 คำ → ระเบิดสมุนทุกตัวในจอ
// จบทางเดียว = เรียก onDone() แล้วปิด overlay (อ่านถูก / ไม่ได้ยิน 2 ครั้ง / ผิด 2 ครั้ง → เฉลย)
//
// ***กลไกไมค์ mirror game.js listen()/evaluate() เป๊ะ — ห้ามแตะ speech.js***
// (ดูสกิล speech-recognition-guide: continuous/interimResults/restart เคยพังมาแล้ว 2 รอบ)
// ★ ไมค์บนแผนที่เป็นของใหม่ — ยังไม่ผ่านทดสอบมือถือจริง

import { createRecognizer, matchWord } from '../input/speech.js';

const MIC_MISS_MAX = 2; // ไม่ได้ยินเสียง → เปิดไมค์ใหม่อัตโนมัติได้กี่ครั้งต่อคำ ก่อนต้องกดปุ่มเอง
const WRONG_MAX = 2;     // อ่านผิดกี่ครั้งก่อนเฉลยแล้วปล่อยผ่าน (เกมเด็ก 4-7 ขวบ ไม่ลงโทษ)

export function createTomeRead({ container, audio }) {
  const recog = createRecognizer();
  let isOpen = false;
  let word = null;
  let onDone = null;
  let micMiss = 0;
  let wrong = 0;
  let listening = false;

  container.innerHTML = `
    <div class="tome-card">
      <div class="tome-title">&#128218; คัมภีร์มนตราพิเศษ</div>
      <div class="tome-word" id="tomeWord"></div>
      <div class="tome-spell" id="tomeSpell"></div>
      <div class="tome-state" id="tomeState"></div>
      <button class="tome-mic" id="tomeMic" type="button">&#127908; พูด</button>
      <button class="tome-done" id="tomeDone" type="button" hidden>อ่านแล้ว &#128165;</button>
    </div>`;
  const $word = container.querySelector('#tomeWord');
  const $spell = container.querySelector('#tomeSpell');
  const $state = container.querySelector('#tomeState');
  const $mic = container.querySelector('#tomeMic');
  const $done = container.querySelector('#tomeDone');

  $mic.addEventListener('click', () => { if (isOpen && !listening) startListen(); });
  // ปุ่ม "อ่านแล้ว" — iOS (ไม่มี STT) หรือ escape ตอนไมค์เสีย: เล่นเสียงสะกดก่อนแล้วปิด (ยังได้ระเบิด)
  $done.addEventListener('click', () => {
    if (!isOpen || $done.disabled) return;
    $done.disabled = true;
    audio.playSpellReveal(word, () => setTimeout(finish, 350));
  });

  function setState(t) { $state.textContent = t; }
  // ไมค์ล้มเหลวจนหมด budget → โชว์ปุ่ม "อ่านแล้ว" เป็นทางออก กันเกมค้าง readingTome ถ้าไมค์เสีย/permission หลุด
  function offerEscape() { if (recog.supported) $done.hidden = false; }

  function startListen() {
    if (!isOpen || !recog.supported || listening) return;
    listening = true;
    setState('🔴 กำลังฟัง...');
    $mic.classList.add('on');
    audio.duck(); // หรี่ BGM ตลอดช่วงฟัง — สำคัญต่อความแม่นของ STT (ต้อง unduck ทุกทางออก)
    let got = false;
    recog.start(
      (alts) => { got = true; evaluate(matchWord(alts, word.display), alts[0]); },
      () => {
        listening = false;
        $mic.classList.remove('on');
        audio.unduck();
        if (!got && isOpen) {
          // ไมค์ตัดจบโดยไม่ได้ยิน — เปิดใหม่อัตโนมัติ ≤ MIC_MISS_MAX ครั้ง (กัน loop ถ้าไมค์เสียจริง)
          if (micMiss < MIC_MISS_MAX) {
            micMiss++;
            setState('ไม่ได้ยินเสียง เอาใหม่นะ');
            audio.speak('ไม่ได้ยินเสียง เอาใหม่นะ', { onEnd: () => { if (isOpen) startListen(); } });
          } else {
            setState('กดปุ่มพูดลองใหม่ หรือกด "อ่านแล้ว"');
            offerEscape();
          }
        }
      }
    );
  }

  function evaluate(correct, heard) {
    if (!isOpen) return;
    if (heard) setState('ได้ยิน: "' + heard + '"');
    if (correct) {
      audio.sfx('star');
      setState('เก่งมาก! 💥');
      setTimeout(finish, 650);
      return;
    }
    wrong++;
    if (wrong >= WRONG_MAX) {
      setState('ฟังคำอ่านนะ...');
      // เล่นเสียงสะกดจนจบก่อนค่อยปิด — ห้ามใช้ timer คงที่ (เสียงยาวกว่า timer แล้วระเบิดคร่อมเสียง)
      audio.playSpellReveal(word, () => setTimeout(finish, 450));
    } else {
      micMiss = 0; // รอบอ่านใหม่จริง — reset budget ไมค์ตัด (ไม่สะสมข้ามรอบ)
      setState((heard ? 'ได้ยิน: "' + heard + '" — ' : '') + 'ลองอ่านอีกที');
      // ต้องรอแม่มดพูดจบจริง (onEnd) ห้าม start ไมค์ระหว่างเสียงเล่น ไม่งั้นไมค์ได้ยินเสียงเอง → ประเมินผิดวนลูป
      audio.speak('ลองอ่านอีกที', { onEnd: () => setTimeout(() => { if (isOpen) startListen(); }, 200) });
    }
  }

  function finish() {
    if (!isOpen) return;
    isOpen = false;
    listening = false;
    try { recog.stop(); } catch (e) {}
    audio.unduck(); // กัน BGM ค้าง muted ถ้าปิดตอนกำลัง duck อยู่
    container.classList.add('hidden');
    const cb = onDone;
    onDone = null; word = null;
    cb && cb();
  }

  return {
    // open(word, onDone) — word = object จาก matra.words[] (มี .display, .spell[])
    open(w, done) {
      word = w; onDone = done;
      micMiss = 0; wrong = 0; listening = false; isOpen = true;
      $word.textContent = w.display;
      $spell.textContent = w.spell.join(' – ');
      $mic.hidden = !recog.supported;
      $done.hidden = recog.supported; // มี STT → ซ่อนไว้ก่อน โผล่เป็น escape ตอนไมค์เสีย (offerEscape)
      $done.disabled = false;
      setState(recog.supported ? 'ฟังคำ แล้วอ่านตาม' : 'อ่านคำนี้ แล้วกดปุ่ม');
      container.classList.remove('hidden');
      // เล่นเสียงสะกด+คำเต็มก่อน แล้วค่อยเปิดไมค์
      audio.playSpellReveal(w, () => { if (isOpen && recog.supported) startListen(); });
    },
    // ปิดจากภายนอก (เช่นออกจากหน้าแผนที่ระหว่างอ่าน) — ยังเรียก onDone เพื่อไม่ให้เกมค้าง readingTome
    forceClose: finish,
  };
}
