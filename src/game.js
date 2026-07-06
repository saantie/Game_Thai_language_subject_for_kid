// game.js — game loop, state machine (2 โหมด), collision, ด่านอ่านออกเสียง
//
// State machine (สเปก 3.1):
//   SELECT → IDLE → DRAGGING → DROPPED
//     TWO_PART  : ฟองคงอยู่ข้ามรอบ, ฟองที่อ่านถูกแล้วหายไป
//     FILL_FINAL: ตรวจตัวสะกด → ตรง=blend→READING | ผิด=เด้งกลับ
//   READING → LISTENING → EVALUATING → REWARD | RETRY | REVEAL

import { createRecognizer, matchWord } from './input/speech.js';
import { saveTotalScore } from './storage.js';
import { createParticleSystem } from './particles.js';

const TWO_PART = 'TWO_PART';

// preload ภาพฟองสบู่ 5 แบบ (module-level — โหลดครั้งเดียวตลอด session)
const BUBBLE_IMGS = Array.from({ length: 5 }, (_, i) => {
  const img = new Image();
  img.src = `public/assets/images/Bubble${i + 1}.png`;
  return img;
});

export function createGame({ scene, audio, app, dom, onExit }) {
  const fx = scene.fx;
  const particleFx = createParticleSystem(fx);
  const recog = createRecognizer();

  let matra = null;
  let words = [];
  let roundIndex = 0;
  let currentWord = null;
  let perfectCount = 0;
  let readAttempts = 0;
  let micMissCount = 0; // จำนวนครั้งที่ไมค์ตัดจบโดยไม่ได้ยิน (ต่อรอบพูด) — auto เปิดใหม่
                        // ให้ไม่เกิน MIC_AUTO_RETRY_MAX ครั้ง กัน loop ไม่รู้จบถ้ามือถือ
                        // permission หลุด/mic เสียจริง
  let afterReveal = false;
  let score = 0;
  let totalScoreAtStart = 0; // snapshot app.totalScore ก่อนเริ่มรอบ — ใช้ roll คะแนนสะสมบนหน้าสรุปดาว

  let state = 'IDLE';
  let bubbles = [];
  let held = null;
  let blend = null;       // { text, t0 }
  let running = false;
  let rafId = 0;

  // ---------- Bubble ----------
  function makeBubble(letter) {
    return {
      letter,
      x: 0, y: 0, homeX: 0, homeY: 0,
      vx: 0, vy: 0, bouncing: false,
      r: 0, phase: Math.random() * Math.PI * 2,
      dead: false, held: false, pop: 0,
      imgIdx:   Math.floor(Math.random() * 5),       // สุ่มภาพฟอง 1-5
      rot:      Math.random() * Math.PI * 2,          // มุมเริ่มต้นสุ่ม
      rotSpeed: (Math.random() - 0.5) * 0.014,        // หมุนซ้าย/ขวาสุ่ม ~0.4°/frame
    };
  }

  // grid layout สำหรับ n มาก (44 ตัว) / spread layout สำหรับ n น้อย (FILL_FINAL)
  function layoutBubbles() {
    const W = scene.W, H = scene.H;
    const n = bubbles.length;
    if (n === 0) return;

    // กันฟองซ้อน HUD: ไม่ให้ homeY ต่ำกว่า 90px จาก top
    const hudClear = Math.max(90, H * 0.13);
    if (n <= 8) {
      // spread layout: เรียงแถวเดียวกระจายแนวนอน
      const r = Math.max(44, Math.min(W, H) * 0.115);
      const margin = r * 1.4;
      const usableW = W - margin * 2;
      // cache font string ที่นี่ (ทำครั้งเดียวต่อ layout) แทนสร้าง template ใหม่
      // ทุกเฟรม×ทุกฟองใน drawBubble() — r เท่ากันทั้งชุดในโหมด spread
      const bubbleFont = `800 ${Math.max(16, r * 0.92)}px 'Sarabun','Segoe UI',sans-serif`;
      bubbles.forEach((b, i) => {
        b.r = r;
        b._font = bubbleFont;
        const t = n === 1 ? 0.5 : i / (n - 1);
        b.homeX = margin + usableW * t;
        // เลื่อนลงจาก H*0.2 → H*0.36 เพื่อกัน HUD และกระจายกลางจอ
        b.homeY = H * (0.36 + 0.10 * Math.sin(i * 1.7));
        b.homeY = Math.max(hudClear + r, b.homeY);
        if (b.x === 0 && b.y === 0) { b.x = b.homeX; b.y = b.homeY; }
      });
    } else {
      // grid layout: หาขนาดเหมาะสมอัตโนมัติ
      const areaH = H * 0.52;  // ลดความสูง area กัน overlap กับหม้อ
      const cols = Math.round(Math.sqrt(n * (W / areaH)));
      const rows = Math.ceil(n / cols);
      const cellW = W / cols;
      const cellH = areaH / rows;
      const r = Math.max(24, Math.min(Math.min(cellW, cellH) * 0.44, 54));
      const bubbleFont = `800 ${Math.max(16, r * 0.92)}px 'Sarabun','Segoe UI',sans-serif`;

      bubbles.forEach((b, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        b.r = r;
        b._font = bubbleFont;
        b.homeX = cellW * (col + 0.5);
        b.homeY = cellH * (row + 0.5) + hudClear; // เริ่มต่ำกว่า HUD
        if (b.x === 0 && b.y === 0) { b.x = b.homeX; b.y = b.homeY; }
      });
    }
  }

  // ---------- Particles (object pool ย้ายไป src/particles.js ให้ใช้ร่วมกับ
  // มินิเกมไพ่จับคู่ได้ — เหลือแค่ effect เฉพาะของเกมหยิบฟองไว้ที่นี่) ----------

  // ประกายดาวระเบิดรอบการ์ดอ่านคำตอนอ่านถูก (ข้อ 7) — กระจายจุดกำเนิดรอบ
  // #voicebar แทนทั่วจอ (เดิมกระจายทั่วจอ ดูไม่เชื่อมโยงกับการ์ดที่กำลังโชว์)
  // 4 จุด × 16 อนุภาค = 64 (เดิม 6×32=192) + ไม่มี glow ต่ออนุภาค
  function spawnRewardStars() {
    const r = dom.voicebar.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const pad = 24; // เว้นออกจากขอบการ์ดเล็กน้อย ดูเป็น "ข้าง" การ์ด ไม่ทับตัวหนังสือ
    const points = [
      [r.left - pad, r.top + r.height * 0.3],
      [cx, r.top - pad],
      [r.right + pad, r.top + r.height * 0.3],
      [cx, r.bottom - r.height * 0.1],
    ];
    points.forEach(([x, y]) => particleFx.spawnCelebrationBurst(x, y));
  }

  function scoreToEvilWishStage(s) {
    if (s >= 650) return 5;
    if (s >= 550) return 4;
    if (s >= 450) return 3;
    if (s >= 250) return 2;
    if (s >= 150) return 1;
    return 0;
  }

  // ---------- Round flow ----------
  function startMatra(m) {
    matra = m;
    roundIndex = 0;
    perfectCount = 0;
    score = 0;
    totalScoreAtStart = app.totalScore;
    updateScore();
    scene.initCharacter(m.character);
    dom.hudName.textContent = m.name;
    show(dom.hud, true);

    if (m.mode === TWO_PART) {
      // เลือก sessionSize ตัวสุ่ม (ไม่ต้องลากครบ 44 ในรอบเดียว)
      const allLetters = m.bubbles.slice();
      const size = Math.min(m.sessionSize || allLetters.length, allLetters.length);
      const sessionLetters = shuffle(allLetters).slice(0, size);
      bubbles = sessionLetters.map(makeBubble);
      words = sessionLetters.map((ch) => m.words.find((w) => w.lead === ch)).filter(Boolean);
      layoutBubbles();
    } else {
      words = shuffle(m.words.slice());
    }

    startRound();
    if (!running) { running = true; loop(); }
  }

  function startRound() {
    if (roundIndex >= words.length) return finishMatra();
    currentWord = words[roundIndex];
    readAttempts = 0;
    afterReveal = false;
    blend = null;
    held = null;

    // อัปเดต stage เจ้าหญิง (1–7 ระหว่างเล่น, 8 ตอนจบ)
    const princessStage = Math.max(1, Math.min(7,
      words.length > 0 ? Math.ceil((roundIndex / words.length) * 7) + 1 : 1
    ));
    scene.setPrincessStage(princessStage);

    // FILL_FINAL: สร้างฟองใหม่ทุกรอบ (target + distractors)
    if (matra.mode !== TWO_PART) {
      bubbles = shuffle([currentWord.final, ...currentWord.distractors]).map(makeBubble);
      layoutBubbles();
    }
    // TWO_PART: ไม่ต้อง spawn ใหม่ — ฟองคงอยู่ ตัวที่อ่านถูกแล้ว dead=true

    setState('IDLE');
    updateHud();
    updateWordPill();
    hideVoicebar();
    scene.witch.play('idle');
    scene.setCauldronFrame(1); // IDLE: หม้อน้ำฟ้า ฟองสงบ
  }

  function updateHud() {
    dom.hudProgress.textContent = `คำที่ ${roundIndex + 1} / ${words.length}`;
  }

  const scorePillEl  = document.getElementById('scorePill');
  const scoreIconEl  = document.getElementById('scoreIcon');

  function updateScore(points) {
    if (points > 0) {
      const from = score - points;
      _rollScore(dom.hudScore, from, score);

      // คะแนนสะสม (ข้ามทุกมาตราตลอดการเล่น) — อัปเดตสดคู่กับคะแนนรอบนี้ + persist ทันที
      const totalFrom = app.totalScore;
      app.totalScore = totalFrom + points;
      saveTotalScore(app.totalScore);
      if (dom.totalBadgeValue) _rollScore(dom.totalBadgeValue, totalFrom, app.totalScore);

      _burstScoreIcon();
      _spawnScoreSparks();
      if (scorePillEl) {
        scorePillEl.classList.remove('bump');
        void scorePillEl.offsetWidth;
        scorePillEl.classList.add('bump');
      }
      if (matra && matra.character === 'evil_wish') {
        scene.setEvilWishStage(scoreToEvilWishStage(score));
      }
    } else {
      dom.hudScore.textContent = score;
    }
  }

  function _rollScore(el, from, to) {
    const dur = 520;
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / dur);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      el.textContent = Math.round(from + (to - from) * ease);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = to;
        // settle: slide ขึ้นมาเหมือน slot machine
        el.classList.remove('settle');
        void el.offsetWidth;
        el.classList.add('settle');
      }
    };
    requestAnimationFrame(tick);
  }

  // นับคะแนนแบบ "หลักหน่วยวิ่งก่อน แล้วค่อยหลักถัดไป" (odometer-style cascade) —
  // ต่างจาก _rollScore ที่ทุกหลักขยับพร้อมกัน ใช้เฉพาะหน้าสรุปดาว (ป้ายเล็กใน
  // HUD/บนการ์ดยังใช้ _rollScore เดิม) — คืน duration รวมให้ผู้เรียก sync เสียงได้
  function _rollScoreDigits(el, from, to) {
    const toStr = String(Math.max(0, Math.round(to)));
    const fromStr = String(Math.max(0, Math.round(from))).padStart(toStr.length, '0');
    const digitCount = toStr.length;
    const DIGIT_DUR = 260; // ระยะเวลาที่แต่ละหลักวิ่ง
    const STAGGER = 90;    // หน่วงต่อหลักถัดไป (หลักหน่วย=0ms, หลักสิบ=+90ms, ...)
    const totalDur = (digitCount - 1) * STAGGER + DIGIT_DUR;
    const start = performance.now();

    const tick = () => {
      const now = performance.now();
      let out = '';
      for (let i = 0; i < digitCount; i++) {
        const posFromRight = digitCount - 1 - i; // 0 = หลักหน่วย (ขวาสุด) วิ่งก่อน
        const digitFrom = +fromStr[i];
        const digitTo = +toStr[i];
        let t = (now - start - posFromRight * STAGGER) / DIGIT_DUR;
        t = Math.max(0, Math.min(1, t));
        const ease = 1 - Math.pow(1 - t, 3);
        out += Math.round(digitFrom + (digitTo - digitFrom) * ease);
      }
      el.textContent = out;
      if (now - start < totalDur) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = toStr;
        el.classList.remove('settle');
        void el.offsetWidth;
        el.classList.add('settle');
      }
    };
    requestAnimationFrame(tick);
    return totalDur;
  }

  function _burstScoreIcon() {
    if (!scoreIconEl) return;
    scoreIconEl.classList.remove('burst');
    void scoreIconEl.offsetWidth;
    scoreIconEl.classList.add('burst');
    // กลับ animation ปกติหลัง burst จบ
    scoreIconEl.addEventListener('animationend', () => {
      scoreIconEl.classList.remove('burst');
    }, { once: true });
  }

  function _spawnScoreSparks() {
    if (!scorePillEl) return;
    const rect = scorePillEl.getBoundingClientRect();
    const cx = rect.left + rect.width  * 0.5;
    const cy = rect.top  + rect.height * 0.5;
    const icons = ['⭐','✨','🌟','💫','⚡'];
    const count = 7;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = 'score-spark';
      el.textContent = icons[Math.floor(Math.random() * icons.length)];
      const angle = (Math.PI * 2 * i / count) - Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      const dist  = 45 + Math.random() * 35;
      el.style.left = cx + 'px';
      el.style.top  = cy + 'px';
      el.style.setProperty('--dx',  (Math.cos(angle) * dist) + 'px');
      el.style.setProperty('--dy',  (Math.sin(angle) * dist - 10) + 'px');
      el.style.setProperty('--dr',  ((Math.random() - 0.5) * 120) + 'deg');
      el.style.setProperty('--dur', (0.55 + Math.random() * 0.3) + 's');
      el.style.animationDelay = (Math.random() * 0.12) + 's';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1100);
    }
  }

  // WORD pill: แสดงการประกอบคำตาม mockup (เช่น "ก + า = กา")
  function updateWordPill() {
    if (!matra || !currentWord) { dom.hudWord.textContent = '—'; return; }
    const solved =
      state === 'DROPPED' || state === 'READING' || state === 'LISTENING' ||
      state === 'EVALUATING' || state === 'REWARD' || state === 'REVEAL';
    if (matra.mode === TWO_PART) {
      const sara = matra.sara || 'า';
      if (solved) {
        dom.hudWord.textContent = `${currentWord.lead} + ${sara} = ${currentWord.display}`;
      } else if (held) {
        const previewWord = matra.words.find((w) => w.lead === held.letter);
        const previewDisplay = previewWord ? previewWord.display : held.letter + sara;
        dom.hudWord.textContent = `${held.letter} + ${sara} = ${previewDisplay}`;
      } else {
        dom.hudWord.textContent = `? + ${sara}`;
      }
    } else {
      const finalCh = solved ? currentWord.final : '▢';
      const display = solved ? currentWord.display : `${currentWord.lead}▢`;
      dom.hudWord.textContent = `${currentWord.lead} + ${finalCh} = ${display}`;
    }
  }

  // ---------- Drop logic (สเปก 3.2) ----------
  function dropInCauldron(bubble) {
    if (matra.mode !== TWO_PART) {
      if (bubble.letter !== currentWord.final) {
        bubble.pop = 1;
        bubble.bouncing = true; // เปิด spring physics — เด้งกลับอย่างนุ่มนวล
        setState('IDLE');
        audio.sfx('wrong_soft');
        audio.voice('wrong', { onText: witchSay });
        return;
      }
    } else {
      currentWord = matra.words.find((w) => w.lead === bubble.letter) || currentWord;
    }
    bubble.dead = true;
    held = null;
    setState('DROPPED');
    updateWordPill();
    audio.sfx('boom');
    particleFx.spawnExplosion(scene.cauldron.cx, scene.cauldron.cy - scene.cauldron.ry * 0.2);
    blend = { text: currentWord.display, t0: performance.now() };
    // animation: BOOM flash → brew → reading
    scene.setCauldronFrame(5, 'flash'); // ลำแสงฟ้า — ปฏิกิริยาเวทมนตร์
    setTimeout(() => scene.setCauldronFrame(2), 380);  // น้ำเขียว รูน
    setTimeout(() => startReadingRound(), 950);
  }

  // ---------- Reading round ----------
  function startReadingRound() {
    setState('READING');
    blend = null;
    micMissCount = 0; // คำใหม่ — เริ่มนับรอบไมค์ตัดใหม่
    scene.setCauldronFrame(3); // ควันเขียว + ดาว — คำผสมเสร็จ รอฟัง
    dom.wordBig.textContent = currentWord.display;
    dom.wordBig.classList.remove('reveal'); // เอา class ออกตอนยังซ่อนอยู่ (ยังไม่ animate)
    if (dom.vbPoints) dom.vbPoints.classList.remove('show'); // ล้างป้ายคะแนนรอบก่อน
    renderSpellHint();
    showVoicebar(); // โชว์การ์ดก่อน — display เปลี่ยนจาก none เป็นจริงแล้ว
    // reflow บังคับ restart animation ต้องทำ "หลัง" โชว์การ์ดแล้วเท่านั้น — ทำตอน
    // ancestor ยัง display:none อยู่ offsetWidth จะอ่านค่าไม่จริง ทำให้ animation
    // restart ไม่ติด เฟรมแรกที่วาดจึงโชว์คำแบบ "จบ animation แล้ว" แวบหนึ่งก่อนจะ
    // เด้งกลับมาเล่น animation จริง (บั๊ก "ภาพแว๊บ" ที่เจอ)
    void dom.wordBig.offsetWidth;
    dom.wordBig.classList.add('reveal');
    dom.micBtn.disabled = !recog.supported;
    dom.micState.textContent = recog.supported ? 'รอฟังเสียงสักครู่...' : 'กดปุ่มด้านล่างเพื่อยืนยัน';

    // เปิดไมค์อัตโนมัติหลังแม่มดพูดจบ
    audio.voice('read', {
      onText: witchSay,
      onEnd: () => {
        if (state === 'READING' && recog.supported) listen();
      },
    });
  }

  const MIC_AUTO_RETRY_MAX = 2; // เปิดไมค์ใหม่อัตโนมัติ (พร้อมเสียง "เอาใหม่ค่ะ") ได้
                                // สูงสุดกี่ครั้งต่อคำ ก่อนต้องให้เด็กกดปุ่มเอง

  function listen() {
    if (!running || state !== 'READING' || !recog.supported) return;
    setState('LISTENING'); // → arPause อัตโนมัติใน setState
    dom.micState.textContent = '🔴 กำลังฟัง...';
    dom.micBtn.classList.add('listening');
    audio.duck();
    // Web Speech API แบบมาตรฐาน (non-continuous, เรียก start() ครั้งเดียว) — เคยลอง
    // retry-loop กับ continuous:true มาแล้วทั้งคู่แย่กว่าเดิมตอนทดสอบเครื่องจริง
    // (ดูรายละเอียดใน speech.js) อย่าเพิ่มกลับมาโดยไม่ทดสอบมือถือจริงก่อน
    let got = false;
    recog.start(
      (alts) => {
        got = true;
        evaluate(matchWord(alts, currentWord.display), alts[0]);
      },
      () => {
        dom.micBtn.classList.remove('listening');
        audio.unduck();
        if (!got && state === 'LISTENING') {
          setState('READING');
          // ไมค์ตัดจบโดยไม่ทันได้ยิน (เด็กพูดไม่ทัน/เริ่มช้า) — แม่มดบอก "เอาใหม่ค่ะ"
          // แล้วเปิดไมค์ให้อัตโนมัติ ไม่ต้องให้เด็กกดปุ่มเอง จำกัดไว้ไม่เกิน
          // MIC_AUTO_RETRY_MAX ครั้งต่อคำ กัน loop ไม่รู้จบถ้า mic เสีย/permission หลุดจริง
          if (micMissCount < MIC_AUTO_RETRY_MAX) {
            micMissCount++;
            dom.micState.textContent = 'ไม่ได้ยินเสียง เอาใหม่นะจ๊ะ';
            audio.voice('mic_retry', {
              onText: witchSay,
              onEnd: () => {
                if (state === 'READING' && recog.supported) listen();
              },
            });
          } else {
            dom.micState.textContent = 'ไม่ได้ยินเสียง ลองกดพูดอีกครั้งนะ';
          }
        }
      }
    );
  }

  function evaluate(correct, heard) {
    if (!running) return;
    if (state === 'EVALUATING' || state === 'REWARD') return;
    setState('EVALUATING');
    dom.micBtn.classList.remove('listening');
    if (heard) dom.micState.textContent = `ได้ยิน: "${heard}"`;

    if (afterReveal) {
      // รอบ echo หลังเฉลย — ชมแต่ไม่ให้คะแนน
      scene.witch.play('cheer');
      audio.sfx('star');
      audio.voice('echo_praise', { onText: witchSay });
      setTimeout(() => rewardFlyAnim(() => setTimeout(nextRound, 250)), 750);
      return;
    }

    if (correct) {
      reward();
    } else {
      readAttempts++;
      if (readAttempts >= 2) {
        revealSpelling();
      } else {
        setState('READING');
        micMissCount = 0; // ตอบผิดรอบใหม่ — เริ่มนับรอบไมค์ตัดใหม่เช่นกัน
        dom.micState.textContent += ' — ลองอ่านอีกครั้งนะจ๊ะ';
        // เปิดไมค์อัตโนมัติรอบ retry — ต้องรอแม่มดพูดจบจริง (onEnd) ห้ามใช้ timer
        // คงที่: TTS พูดยาวกว่า timer แล้วไมค์จะได้ยินเสียงแม่มดเอง → ประเมินผิด
        // → แม่มดพูดซ้ำ → วนลูปพูดรัว/ไมค์เด้งรัว
        audio.voice('retry', {
          onText: witchSay,
          onEnd: () => setTimeout(() => {
            if (state === 'READING' && recog.supported) listen();
          }, 250),
        });
      }
    }
  }

  function spawnFlyStars(cx, cy) {
    for (let i = 0; i < 3; i++) {
      const p = particleFx.acquire();
      const a = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random() * 2.5;
      p.x = cx + (Math.random() - 0.5) * 18;
      p.y = cy + (Math.random() - 0.5) * 18;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 1.2;
      p.life = 0.55 + Math.random() * 0.35;
      p.r = 6 + Math.random() * 9;
      p.hue = 40 + Math.random() * 22;
      p.star = true;
      p.fillStyle = `hsl(${p.hue},90%,60%)`;   // cache สีไว้ตอน spawn (ดู spawnExplosion)
      p.shadowStyle = `hsl(${p.hue},100%,70%)`;
      p.decay = 0.038;
      particleFx.add(p);
    }
  }

  function rewardFlyAnim(cb, onArrive) {
    const vb = dom.voicebar;
    const starEl = dom.scoreIcon;
    const vbRect  = vb.getBoundingClientRect();
    const stRect  = starEl.getBoundingClientRect();
    const dx = (stRect.left + stRect.width  / 2) - (vbRect.left + vbRect.width  / 2);
    const dy = (stRect.top  + stRect.height / 2) - (vbRect.top  + vbRect.height / 2);

    // พิกัดบน fxCanvas สำหรับ trail particles
    const fxRect = scene.fxCanvas.getBoundingClientRect();
    const startX = (vbRect.left + vbRect.width  / 2) - fxRect.left;
    const startY = (vbRect.top  + vbRect.height / 2) - fxRect.top;
    const endX   = (stRect.left + stRect.width  / 2) - fxRect.left;
    const endY   = (stRect.top  + stRect.height / 2) - fxRect.top;

    vb.style.setProperty('--vb-fly-x', `${dx}px`);
    vb.style.setProperty('--vb-fly-y', `${dy}px`);
    vb.classList.add('fly-to-star');

    // trail: ปล่อยดาวตามเส้นทางทุก 28ms ตลอด 680ms
    const FLY_DUR = 680;
    const t0 = performance.now();
    const trailId = setInterval(() => {
      const t = Math.min(1, (performance.now() - t0) / FLY_DUR);
      const ease = t * t; // ease-in: เร่งเข้าหาป้าย
      spawnFlyStars(startX + (endX - startX) * ease, startY + (endY - startY) * ease);
      if (t >= 1) clearInterval(trailId);
    }, 28);

    setTimeout(() => {
      clearInterval(trailId);
      vb.classList.remove('fly-to-star');
      hideVoicebar();
      onArrive && onArrive(); // ตัวเลขวิ่ง + ดาวบูม เมื่อการ์ดถึงป้ายคะแนน
      cb && cb();
    }, FLY_DUR);
  }

  function reward() {
    setState('REWARD');
    if (readAttempts === 0) perfectCount++;
    const points = readAttempts === 0 ? 100 : 50;
    score += points;
    // updateScore จะถูกเรียกตอนการ์ดถึงป้ายคะแนน (onArrive) ไม่ใช่ตอนนี้
    scene.setCauldronFrame(4, 'reward'); // ควันม่วง — ฉลองอ่านถูก
    scene.witch.play('cheer');
    audio.playCorrectChime();             // ข้อ 7: เสียง Magic Chime.mp3 จริง — ให้ดังก่อน
    setTimeout(spawnRewardStars, 180); // แล้วดาวรอบการ์ดค่อยระเบิดตามจังหวะเสียง (ไม่พร้อมกัน)
    audio.voice('correct', { onText: witchSay });
    // โชว์คะแนนที่ได้ (+100/+50) ทับมุมการ์ด ก่อนการ์ดจะหุบลอยไปป้ายคะแนน (750ms
    // ด้านล่าง) — เห็นชัดว่าตอบถูกครั้งนี้ได้กี่แต้ม ไม่ใช่รู้แค่ตอนตัวเลขที่ป้ายขยับ
    if (dom.vbPoints) {
      dom.vbPoints.textContent = `+${points}`;
      dom.vbPoints.classList.remove('show');
      void dom.vbPoints.offsetWidth;
      dom.vbPoints.classList.add('show');
    }
    setTimeout(() => rewardFlyAnim(
      () => setTimeout(nextRound, 250),
      () => { updateScore(points); } // ตัด synth 'star' (เสียงตุ๊ดๆ) ออก — มี Magic Chime แล้วพอ
    ), 750);
  }

  function revealSpelling() {
    setState('REVEAL');
    scene.witch.play('idle');
    audio.voice('reveal', { onText: witchSay });
    setTimeout(() => {
      if (!running) return;
      audio.playSpellReveal(currentWord, () => setTimeout(() => { if (running) startEchoRound(); }, 700));
    }, 1400);
  }

  function startEchoRound() {
    afterReveal = true;
    setState('READING');
    dom.wordBig.textContent = currentWord.display;
    dom.wordBig.classList.remove('reveal');
    void dom.wordBig.offsetWidth;
    dom.wordBig.classList.add('reveal');
    renderSpellHint();
    showVoicebar();
    audio.voice('echo_prompt', {
      onText: witchSay,
      onEnd: () => { if (state === 'READING' && recog.supported) listen(); },
    });
  }

  function nextRound() {
    roundIndex++;
    startRound();
  }

  function finishMatra() {
    const total = words.length;
    const ratio = perfectCount / total;
    const stars = ratio >= 1 ? 3 : ratio >= 0.5 ? 2 : 1;
    app.progress[matra.id] = Math.max(app.progress[matra.id] || 0, stars);

    running = false;
    cancelAnimationFrame(rafId);
    hideVoicebar();

    // รอให้ animation เจ้าหญิง/แม่มดใจร้ายเสร็จก่อน แล้วค่อยแสดง result
    const showResult = () => {
      const msg = stars === 3 ? 'ยอดเยี่ยม! ครบทุกตัว!' : stars === 2 ? 'เก่งมากจ้า!' : 'ดีนะ ฝึกอีกครั้งนะ!';
      renderResultStars(dom.resultStars, stars, 3);
      dom.resultMsg.textContent = msg;
      if (dom.resultCharImg) dom.resultCharImg.src = scene.getCharacterSrc();
      show(dom.resultScreen, true);
      // ตัวเลขคะแนนสะสมวิ่งขึ้นจากยอดก่อนเริ่มรอบ → ยอดปัจจุบัน (โชว์ผลรวมที่เพิ่งได้ทั้งรอบ)
      // พร้อมเสียงไล่ระดับให้ดูตื่นเต้น (ข้อ 3) — หลักหน่วยวิ่งก่อนแล้วค่อยหลักถัดไป
      // (odometer-style) ต่างจาก roll ปกติที่ทุกหลักขยับพร้อมกัน
      if (dom.resultTotalValue) {
        const dur = _rollScoreDigits(dom.resultTotalValue, totalScoreAtStart, app.totalScore);
        audio.playCountUpSound(dur);
      }

      dom.resultBtn.onclick = () => {
        const card = dom.resultCard, badge = dom.totalBadge;
        const finish = () => {
          show(dom.resultScreen, false);
          onExit && onExit({ matraId: matra.id, stars });
        };
        if (!card || !badge) { finish(); return; } // fallback กันพัง ถ้าไม่มี element

        // หน้าสรุปดาวหุบ+ลอยไปหาป้ายคะแนนสะสม → ป้ายกระพริบรับ → แล้วค่อยเปิดหน้าเลือกมาตรา
        const FLY_DUR = 650, BLINK_DUR = 450;
        const cardRect = card.getBoundingClientRect();
        const badgeRect = badge.getBoundingClientRect();
        const dx = (badgeRect.left + badgeRect.width / 2) - (cardRect.left + cardRect.width / 2);
        const dy = (badgeRect.top + badgeRect.height / 2) - (cardRect.top + cardRect.height / 2);
        card.style.setProperty('--rc-fly-x', `${dx}px`);
        card.style.setProperty('--rc-fly-y', `${dy}px`);
        card.classList.add('fly-to-total');
        setTimeout(() => {
          badge.classList.remove('blink');
          void badge.offsetWidth;
          badge.classList.add('blink');
          setTimeout(() => {
            badge.classList.remove('blink');
            // เอา fly-to-total ออก "หลัง" ซ่อนหน้าจอไปแล้วเท่านั้น — เอาออกก่อนหน้านี้
            // จะทำให้การ์ดสแนปกลับขนาด/ความทึบเต็มแวบหนึ่งก่อนจอมืด (bug ที่พบจริง)
            card.classList.remove('fly-to-total');
            finish();
          }, BLINK_DUR);
        }, FLY_DUR);
      };
    };

    if (matra.character === 'evil_wish') {
      scene.setEvilWishStage(5, showResult);
    } else {
      scene.setPrincessStage(8, showResult);
    }
  }

  let _cauldronHintTs = 0; // cooldown กัน spam

  // ---------- Input handlers ----------
  function onPick(x, y, slop = 1.0) {
    // hybrid guard: touch กับ pinch ทำงานพร้อมกัน — ถ้า input หนึ่งถือฟองอยู่แล้ว
    // อีก input ต้องไม่หยิบฟองตัวที่สองทับ (ฟองแรกจะค้าง held=true เป็น orphan)
    if (held) return;
    if (state !== 'IDLE' && state !== 'DRAGGING') return;
    // magnet grab: หาฟอง "ใกล้สุด" ในรัศมี b.r * slop (pinch ส่ง 1.6 — นิ้วเด็ก
    // จีบพลาดฟองบ่อย; pointer ไม่ส่ง = 1.0 พฤติกรรมเดิม) — ต้องใกล้สุดไม่ใช่
    // ตัวแรกที่โดน เพราะรัศมีขยายอาจซ้อนกันหลายฟอง
    let best = null;
    let bestD = Infinity;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b.dead) continue;
      const d = Math.hypot(x - b.x, y - b.y);
      if (d <= b.r * slop && d < bestD) { bestD = d; best = b; }
    }
    if (best) {
      const b = best;
      held = b;
      b.held = true;
      b.grabX = x; // จุดเริ่มหยิบ — onRelease ใช้เช็คว่า "ลากจริง" ก่อนรับลงหม้อ
      b.grabY = y;
      // แม่เหล็กดูดติดมือทันที — สแนปฟองมาที่จุดกำเลย ไม่รอขยับก่อนถึงจะตามมือ
      // (เดิมฟองค้างตำแหน่งเดิมจนกว่า onMove ขยับเกิน dead zone รู้สึกเหมือนไม่ติดมือ)
      b.x = x;
      b.y = y;
      b.pop = 0.6;
      b.bouncing = false;
      b.vx = 0;
      b.vy = 0;
      setState('DRAGGING');
      updateWordPill();
      audio.sfx('pick');
      return;
    }
    // ไม่ได้จับฟอง — เช็คว่าแตะหม้อหรือเปล่า
    const c = scene.cauldron;
    const dx = (x - c.cx) / (c.rx * 1.2);
    const dy = (y - (c.cy + c.ry * 0.5)) / (c.ry * 1.6);
    if (dx * dx + dy * dy <= 1) {
      const now = performance.now();
      if (now - _cauldronHintTs > 3000) {
        _cauldronHintTs = now;
        scene.cauldronWiggle();
        audio.voice('cauldron_hint', { onText: witchSay });
      }
    }
  }
  let _trailFrame = 0;
  function spawnDragTrail(x, y) {
    _trailFrame++;
    if (_trailFrame % 2 !== 0) return;
    for (let i = 0; i < 3; i++) {
      const p = particleFx.acquire();
      const a = Math.random() * Math.PI * 2;
      const sp = 0.4 + Math.random() * 2.2;
      p.x = x + (Math.random() - 0.5) * 22;
      p.y = y + (Math.random() - 0.5) * 22;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 1.8;
      p.life = 0.65 + Math.random() * 0.35;
      p.r = 4 + Math.random() * 8;
      p.hue = 38 + Math.random() * 22;
      p.star = true;
      p.fillStyle = `hsl(${p.hue},90%,60%)`;   // cache สีไว้ตอน spawn (ดู spawnExplosion)
      p.shadowStyle = `hsl(${p.hue},100%,70%)`;
      p.decay = 0.048;
      particleFx.add(p);
    }
  }

  // ข้อ 3: ฟองที่ถือชนฟองอื่น → เด้งออกทุกทิศทาง แล้วค่อยๆลอยกลับที่เดิม
  // (ใช้ spring-back physics เดิมใน update() ผ่าน b.bouncing เหมือนตอนหย่อนผิดช่อง)
  function checkHeldCollisions() {
    bubbles.forEach((ob) => {
      if (ob === held || ob.dead || ob.held) return;
      const dx = ob.x - held.x, dy = ob.y - held.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const minDist = held.r + ob.r;
      if (dist < minDist) {
        const nx = dx / dist, ny = dy / dist;
        const KNOCK = 3.4;
        ob.vx += nx * KNOCK;
        ob.vy += ny * KNOCK;
        ob.x += nx * (minDist - dist) * 0.5; // กันซ้อนทับค้างชั่วขณะ
        ob.y += ny * (minDist - dist) * 0.5;
        ob.bouncing = true;
      }
    });
  }

  function onMove(x, y) {
    if (held) {
      held.x = x; held.y = y;
      spawnDragTrail(x, y);
      checkHeldCollisions();
    }
  }

  // ---------- AR hand-frame (มือเปิด/กางมือ จากกล้อง — pointer.js ไม่มี concept นี้) ----------
  const FLICK_MIN_DY = 9;   // px/เฟรม ขั้นต่ำที่นับเป็น "เดาะขึ้น" — ยังไม่ผ่านทดสอบเครื่องจริง
  const FLICK_RADIUS = 70;  // px รัศมีรอบนิ้วชี้ที่ถือว่ากระทบฟอง
  const FLICK_GAIN   = 0.35;
  const FLICK_MAX    = 9;
  let _handPrev = null; // { x, y, ts } เฟรมมือก่อนหน้า สำหรับคำนวณความเร็วเดาะ

  function onHandFrame(frame) {
    if (!frame) { _handPrev = null; return; }
    const { x, y, open, spread, palmUp } = frame;

    // ข้อ 6: ประกายดาวลอยตามนิ้วชี้ตอนกางมือ (ใช้ trail particle เดิมของการลาก)
    if (spread) spawnDragTrail(x, y);

    // ข้อ 2: หงายมือ + กวาดขึ้นเร็วพอ (มือเปิด ไม่ได้ถือฟองอยู่) → เดาะฟองใกล้เคียงลอยขึ้น
    // เคลื่อนลง ("ตบลง") ไม่มีผลใดๆ ตามที่ตั้งใจ — เช็คเฉพาะ dy ติดลบ
    const now = performance.now();
    if (_handPrev && open && palmUp && !held) {
      const dt = now - _handPrev.ts;
      if (dt > 0 && dt < 220) {
        const dy = y - _handPrev.y; // ลบ = เคลื่อนขึ้นจอ
        if (dy < -FLICK_MIN_DY) {
          const power = Math.min(FLICK_MAX, -dy * FLICK_GAIN);
          bubbles.forEach((b) => {
            if (b.dead || b.held) return;
            if (Math.hypot(x - b.x, y - b.y) <= FLICK_RADIUS + b.r) {
              b.bouncing = true;
              b.vy -= power;
              b.vx += (Math.random() - 0.5) * power * 0.5;
            }
          });
        }
      }
    }
    _handPrev = { x, y, ts: now };
  }
  function onRelease(x, y) {
    if (!held) return;
    const b = held;
    b.held = false;
    const c = scene.cauldron;
    // zone กว้าง — ปล่อยฟองบริเวณหม้อทั้งตัวรับได้ ไม่ต้องเล็งปากหม้อพอดี
    // แต่ต้อง "ลากจริง" ด้วย — phantom pinch จาก AR หยิบ+ปล่อยที่จุดเดิมทันที
    // ถ้าฟองลอยซ้อน zone หม้ออยู่แล้วจะกลายเป็นหย่อนเอง เกมเล่นเองเป็นลูป (bug v119)
    const dragged = Math.hypot(x - (b.grabX ?? x), y - (b.grabY ?? y)) > Math.max(24, b.r * 0.6);
    const overMouth = dragged && Math.hypot(x - c.cx, (y - c.cy) / 1.1) <= c.rx;
    if (overMouth) {
      dropInCauldron(b);
    } else {
      setState('IDLE');
    }
    if (held === b) held = null;
    if (!overMouth) updateWordPill(); // ปล่อยนอกหม้อ → คืน pill เป็นโจทย์ตั้งต้น
  }

  // ---------- Loop / render ----------
  let _lastTick = 0;
  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    // IDLE + ไม่มี particles → throttle 30fps (ฟองแค่ bob เบาๆ ไม่ต้อง 60fps)
    const now = performance.now();
    const isQuiet = state === 'IDLE' && particleFx.count === 0 && !blend;
    if (isQuiet && now - _lastTick < 33) return;
    _lastTick = now;
    update();
    render();
  }

  function update() {
    const now = performance.now();
    bubbles.forEach((b) => {
      if (b.dead) return;
      if (!b.held) {
        const bob = Math.sin(now * 0.002 + b.phase) * Math.max(4, b.r * 0.22);
        if (b.bouncing) {
          // spring physics: เด้งกลับหลังตกผิดช่อง
          b.vx = (b.vx + (b.homeX - b.x) * 0.12) * 0.76;
          b.vy = (b.vy + (b.homeY + bob - b.y) * 0.12) * 0.76;
          b.x += b.vx;
          b.y += b.vy;
          if (Math.abs(b.vx) < 0.4 && Math.abs(b.vy) < 0.4) {
            b.bouncing = false;
            b.vx = 0;
            b.vy = 0;
          }
        } else {
          // lerp ปกติ (float เบา ๆ)
          b.x += (b.homeX - b.x) * 0.08;
          b.y += (b.homeY + bob - b.y) * 0.08;
        }
      }
      b.rot += b.rotSpeed; // หมุนต่อเนื่องทุกเฟรม
      if (b.pop > 0) b.pop = Math.max(0, b.pop - 0.05);
    });
    particleFx.update();
  }

  function render() {
    scene.clearFx();
    const promptWord = matra && matra.mode !== TWO_PART ? currentWord : null;
    scene.drawCauldron(state === 'IDLE' || state === 'DRAGGING' ? promptWord : null);
    bubbles.forEach((b) => !b.dead && drawBubble(b));
    particleFx.draw();
    if (blend) drawBlend();
  }

  function drawBubble(b) {
    const scale = 1 + b.pop * 0.25;
    const r = b.r * scale;
    const img = BUBBLE_IMGS[b.imgIdx];

    // วาดภาพฟองพร้อมหมุน
    fx.save();
    fx.translate(b.x, b.y);
    fx.rotate(b.rot);
    if (img.complete && img.naturalWidth > 0) {
      fx.drawImage(img, -r, -r, r * 2, r * 2);
    } else {
      // fallback วงกลมขณะภาพยังโหลด
      fx.beginPath();
      fx.arc(0, 0, r, 0, Math.PI * 2);
      fx.fillStyle = 'rgba(150,220,255,0.55)';
      fx.fill();
    }
    fx.restore();

    // ตัวอักษรทองกลางฟอง — วาดแยก 2 layer หลัง restore (ไม่หมุนตามภาพ)
    fx.save();
    fx.font = b._font; // cache ไว้ตอน layoutBubbles() — เลี่ยงสร้าง template string ทุกเฟรม×ทุกฟอง
    fx.textAlign = 'center';
    fx.textBaseline = 'middle';
    fx.shadowOffsetX = 0;
    fx.shadowOffsetY = 0;
    fx.shadowColor = 'rgba(255,200,60,0.9)';
    fx.shadowBlur = 8;
    fx.fillStyle = '#FFF0A0';
    fx.fillText(b.letter, b.x, b.y);
    fx.shadowBlur = 0;
    fx.restore();
  }

  function drawBlend() {
    const t = (performance.now() - blend.t0) / 900;
    const scale = 0.5 + Math.min(1, t) * 1.2;
    const alpha = t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.2);
    fx.save();
    fx.globalAlpha = alpha;
    fx.translate(scene.cauldron.cx, scene.H * 0.42);
    fx.scale(scale, scale);
    fx.fillStyle = '#fff';
    fx.shadowColor = '#7affc0';
    fx.shadowBlur = 30;
    fx.font = `800 64px 'Sarabun','Segoe UI',sans-serif`;
    fx.textAlign = 'center';
    fx.textBaseline = 'middle';
    fx.fillText(blend.text, 0, 0);
    fx.restore();
  }

  // ---------- UI helpers ----------
  function renderSpellHint() {
    dom.hint.textContent = currentWord.spell.join(' – ');
    // แสดงเสมอ (display ควบคุมด้วย CSS .vb-hint { display: block })
  }
  function witchSay(text) {
    scene.witch.play('talk');
    dom.toast.textContent = text;
    dom.toast.classList.add('show');
    clearTimeout(witchSay._t);
    witchSay._t = setTimeout(() => {
      dom.toast.classList.remove('show');
      scene.witch.revertTalk();
    }, 3500);
  }
  function showVoicebar() {
    show(dom.voicebar, true);
    scene.witch.play('read');
  }
  function hideVoicebar() { show(dom.voicebar, false); }
  function setState(s) {
    state = s;
    // AR: inference จำเป็นเฉพาะตอนใช้มือ (IDLE/DRAGGING) — ช่วงอ่าน/ฟัง/รางวัล
    // pause เพื่อลดความร้อนมือถือ และคืน CPU ให้ Speech Recognition ตอน LISTENING
    if (s === 'IDLE' || s === 'DRAGGING') {
      if (app.arResume) app.arResume();
    } else if (app.arPause) {
      app.arPause();
    }
  }

  // ---------- wire UI buttons ----------
  dom.micBtn.onclick = listen;
  dom.okBtn.onclick = () => {
    if (state === 'READING' || state === 'LISTENING') {
      recog.stop();
      evaluate(true, null);
    }
  };
  dom.retryBtn.onclick = () => {
    if (state === 'READING' || state === 'LISTENING') {
      recog.stop();
      evaluate(false, null);
    }
  };

  return {
    startMatra,
    onPick,
    onMove,
    onRelease,
    onHandFrame,
    relayout() { layoutBubbles(); },
    stop() {
      running = false;
      setState('IDLE');
      cancelAnimationFrame(rafId);
      recog.stop();
      audio.stopSpeaking();
      scene.stopPrincessFx();
    },
  };
}

// ---------- utils ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function show(el, on) { el.classList.toggle('hidden', !on); }

// ดาวผลลัพธ์หน้าสรุป — วาดเป็น SVG (ไม่ใช่ emoji "⭐/☆") เพื่อคุมสีทอง gradient เอง
// และไม่มีเส้นขอบดำ (emoji บางฟอนต์/แพลตฟอร์มมีเส้นขอบมากับตัวกลิฟท์ แก้ด้วย CSS ไม่ได้)
const STAR_PATH = 'M12 1.5l3.09 6.26 6.91 1-5 4.87 1.18 6.88L12 17.27l-6.18 3.24L7 13.63l-5-4.87 6.91-1z';
function renderResultStars(container, filled, total) {
  container.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const isFilled = i < filled;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'result-star-svg' + (isFilled ? ' filled' : ' empty'));
    if (isFilled) {
      const gradId = `resultStarGrad${i}`;
      svg.innerHTML =
        `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0%" stop-color="#fff2b0"/>` +
        `<stop offset="45%" stop-color="#ffd84d"/>` +
        `<stop offset="100%" stop-color="#c9860c"/>` +
        `</linearGradient></defs>` +
        `<path fill="url(#${gradId})" d="${STAR_PATH}"/>`;
    } else {
      svg.innerHTML = `<path fill="rgba(255,255,255,0.18)" d="${STAR_PATH}"/>`;
    }
    container.appendChild(svg);
  }
}
