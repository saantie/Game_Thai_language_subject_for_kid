// game.js — game loop, state machine (2 โหมด), collision, ด่านอ่านออกเสียง
//
// State machine (สเปก 3.1):
//   SELECT → IDLE → DRAGGING → DROPPED
//     TWO_PART  : ฟองคงอยู่ข้ามรอบ, ฟองที่อ่านถูกแล้วหายไป
//     FILL_FINAL: ตรวจตัวสะกด → ตรง=blend→READING | ผิด=เด้งกลับ
//   READING → LISTENING → EVALUATING → REWARD | RETRY | REVEAL

import { createRecognizer, matchWord } from './input/speech.js';
import { saveTotalScore } from './storage.js';

const TWO_PART = 'TWO_PART';

// preload ภาพฟองสบู่ 5 แบบ (module-level — โหลดครั้งเดียวตลอด session)
const BUBBLE_IMGS = Array.from({ length: 5 }, (_, i) => {
  const img = new Image();
  img.src = `public/assets/images/Bubble${i + 1}.png`;
  return img;
});

export function createGame({ scene, audio, app, dom, onExit }) {
  const fx = scene.fx;
  const recog = createRecognizer();

  let matra = null;
  let words = [];
  let roundIndex = 0;
  let currentWord = null;
  let perfectCount = 0;
  let readAttempts = 0;
  let afterReveal = false;
  let score = 0;
  let totalScoreAtStart = 0; // snapshot app.totalScore ก่อนเริ่มรอบ — ใช้ roll คะแนนสะสมบนหน้าสรุปดาว

  let state = 'IDLE';
  let bubbles = [];
  let held = null;
  let particles = [];
  const particlePool = [];
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

  // ---------- Particles (object pool) ----------
  function spawnExplosion(cx, cy) {
    for (let i = 0; i < 26; i++) {
      const p = particlePool.pop() || {};
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      p.x = cx; p.y = cy;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 2;
      p.life = 1; p.r = 3 + Math.random() * 5;
      p.hue = 120 + Math.random() * 80; p.star = false;
      p.fillStyle = `hsl(${p.hue},90%,60%)`; // cache สีไว้ตอน spawn — ไม่คำนวณ string ซ้ำทุกเฟรมใน drawParticle
      particles.push(p);
    }
  }

  function spawnStars(cx, cy) {
    for (let i = 0; i < 32; i++) {
      const p = particlePool.pop() || {};
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 7;
      p.x = cx; p.y = cy;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 4;
      p.life = 1;
      p.r = 10 + Math.random() * 14; // ⭐ ใหญ่ขึ้นเห็นชัด
      p.hue = 42 + Math.random() * 18;
      p.star = true;
      p.fillStyle = `hsl(${p.hue},90%,60%)`;   // cache สีไว้ตอน spawn (ดู spawnExplosion)
      p.shadowStyle = `hsl(${p.hue},100%,70%)`;
      particles.push(p);
    }
  }

  // ประกายดาวระเบิดเต็มจอตอนอ่านถูก (ข้อ 7) — กระจายจุดกำเนิดหลายจุดทั่วจอ
  // แทนการระเบิดจุดเดียวที่หม้อ ใช้ spawnStars เดิมซ้ำหลายจุด (ยังพูล particle เดิม)
  function spawnFullScreenStars() {
    const points = [
      [0.10, 0.22], [0.50, 0.14], [0.90, 0.22],
      [0.18, 0.62], [0.50, 0.52], [0.82, 0.62],
    ];
    points.forEach(([fx, fy]) => spawnStars(scene.W * fx, scene.H * fy));
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
    spawnExplosion(scene.cauldron.cx, scene.cauldron.cy - scene.cauldron.ry * 0.2);
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
    scene.setCauldronFrame(3); // ควันเขียว + ดาว — คำผสมเสร็จ รอฟัง
    dom.wordBig.textContent = currentWord.display;
    // trigger reveal animation ทุกรอบ (reflow บังคับ restart)
    dom.wordBig.classList.remove('reveal');
    void dom.wordBig.offsetWidth;
    dom.wordBig.classList.add('reveal');
    renderSpellHint();
    showVoicebar();
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

  function listen() {
    if (!running || state !== 'READING' || !recog.supported) return;
    setState('LISTENING'); // → arPause อัตโนมัติใน setState
    dom.micState.textContent = '🔴 กำลังฟัง...';
    dom.micBtn.classList.add('listening');
    audio.duck();
    let got = false;
    const listenStartTs = performance.now();
    const isFirstAttempt = readAttempts === 0;
    const MIN_LISTEN_MS = 5000; // ข้อ 4: รอบแรกให้เวลาฟังอย่างน้อย 5 วิ ก่อนสรุปว่าไม่ได้ยิน
    const attempt = () => {
      recog.start(
        (alts) => {
          got = true;
          evaluate(matchWord(alts, currentWord.display), alts[0]);
        },
        () => {
          // เบราว์เซอร์บางตัวตัดฟังเร็วถ้าเงียบ — รอบแรกยังไม่ครบ 5 วิ ให้ฟังต่อ
          if (!got && isFirstAttempt && state === 'LISTENING' &&
              performance.now() - listenStartTs < MIN_LISTEN_MS) {
            setTimeout(attempt, 150);
            return;
          }
          dom.micBtn.classList.remove('listening');
          audio.unduck();
          if (!got && state === 'LISTENING') {
            dom.micState.textContent = 'ไม่ได้ยินเสียง ลองกดพูดอีกครั้งนะ';
            setState('READING');
          }
        }
      );
    };
    attempt();
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
      const p = particlePool.pop() || {};
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
      particles.push(p);
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
    setTimeout(spawnFullScreenStars, 180); // แล้วดาวเต็มจอค่อยระเบิดตามจังหวะเสียง (ไม่พร้อมกัน)
    audio.voice('correct', { onText: witchSay });
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
      const starStr = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
      const msg = stars === 3 ? 'ยอดเยี่ยม! ครบทุกตัว!' : stars === 2 ? 'เก่งมากจ้า!' : 'ดีนะ ฝึกอีกครั้งนะ!';
      dom.resultStars.textContent = starStr;
      dom.resultMsg.textContent = msg;
      if (dom.resultCharImg) dom.resultCharImg.src = scene.getCharacterSrc();
      show(dom.resultScreen, true);
      // ตัวเลขคะแนนสะสมวิ่งขึ้นจากยอดก่อนเริ่มรอบ → ยอดปัจจุบัน (โชว์ผลรวมที่เพิ่งได้ทั้งรอบ)
      if (dom.resultTotalValue) _rollScore(dom.resultTotalValue, totalScoreAtStart, app.totalScore);

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
          card.classList.remove('fly-to-total');
          badge.classList.remove('blink');
          void badge.offsetWidth;
          badge.classList.add('blink');
          setTimeout(() => {
            badge.classList.remove('blink');
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
      b.throwVx = 0; // ความเร็วลาก (สำหรับข้อ 4: โยนลงหม้อด้วยแรงเหวี่ยง) เริ่มนิ่งตอนหยิบ
      b.throwVy = 0;
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
      const p = particlePool.pop() || {};
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
      particles.push(p);
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
      // ข้อ 4: เก็บความเร็วลาก (EMA) ไว้คำนวณแรงเหวี่ยงตอนปล่อย — ให้ "โยน" ฟองลงหม้อได้
      // แม้ปล่อยมือก่อนถึงปากหม้อจริง ถ้าทิศ+ความเร็วพุ่งเข้าโซนหม้อพอดี
      held.throwVx = (held.throwVx || 0) * 0.6 + (x - held.x) * 0.4;
      held.throwVy = (held.throwVy || 0) * 0.6 + (y - held.y) * 0.4;
      held.x = x; held.y = y;
      spawnDragTrail(x, y);
      checkHeldCollisions();
    }
  }

  // ---------- AR: กดปุ่มไมค์ด้วยนิ้วชี้ (ชี้ค้างไว้ = กด) ----------
  // onPick/onRelease ผูกกับฟองในเกมเท่านั้น — AR ไม่มีวิธี "แตะ" ปุ่ม DOM แบบ touch
  // ปกติ ต้องมีทางกดปุ่มไมค์ด้วยมือเปล่าด้วย (เช่นตอน "ไม่ได้ยินเสียง ลองกดพูดอีกครั้งนะ")
  const MIC_DWELL_MS = 550; // ชี้ค้างนานเท่านี้ก่อนกดจริง — กันกดพลาดตอนกวาดผ่าน
  let _micDwellStart = null;

  function clearMicDwell() {
    if (_micDwellStart == null) return;
    _micDwellStart = null;
    dom.micBtn.classList.remove('ar-dwelling');
  }

  function tryMicDwell(x, y) {
    const btn = dom.micBtn;
    if (btn.disabled || btn.classList.contains('listening') || btn.offsetParent === null) {
      clearMicDwell();
      return;
    }
    const r = btn.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (!over) { clearMicDwell(); return; }

    const now = performance.now();
    if (_micDwellStart == null) {
      _micDwellStart = now;
      btn.classList.remove('ar-dwelling');
      void btn.offsetWidth; // reflow บังคับ restart animation
      btn.classList.add('ar-dwelling'); // วงแหวนไล่ระดับให้เห็นว่ากำลังนับถอยหลัง
      return;
    }
    if (now - _micDwellStart >= MIC_DWELL_MS) {
      clearMicDwell();
      listen();
    }
  }

  // ---------- AR hand-frame (มือเปิด/กางมือ จากกล้อง — pointer.js ไม่มี concept นี้) ----------
  const FLICK_MIN_DY = 9;   // px/เฟรม ขั้นต่ำที่นับเป็น "เดาะขึ้น" — ยังไม่ผ่านทดสอบเครื่องจริง
  const FLICK_RADIUS = 70;  // px รัศมีรอบนิ้วชี้ที่ถือว่ากระทบฟอง
  const FLICK_GAIN   = 0.35;
  const FLICK_MAX    = 9;
  let _handPrev = null; // { x, y, ts } เฟรมมือก่อนหน้า สำหรับคำนวณความเร็วเดาะ

  function onHandFrame(frame) {
    if (!frame) { _handPrev = null; clearMicDwell(); return; }
    const { x, y, open, spread, palmUp } = frame;

    if (!held) tryMicDwell(x, y); // เว้นตอนกำลังลากฟองอยู่ กันกดพลาดขณะลาก

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
  const THROW_MIN_SPEED = 12; // px/เฟรม ขั้นต่ำที่นับเป็น "เหวี่ยงโยน" ไม่ใช่แค่ลากช้าๆ
  const THROW_DECAY = 0.85;   // อัตราหน่วงความเร็วต่อ step จำลอง (เหมือนแรงเสียดทาน)
  const THROW_STEPS = 14;     // จำนวน step ที่ยิงดูแนวถลาไปข้างหน้า

  // ข้อ 4: เช็คว่าฟองที่ถูกเหวี่ยงปล่อย (มีความเร็วสะสมจาก onMove) จะ "ลอยเข้า"
  // โซนหม้อไหม แม้ตำแหน่งปล่อยจริงจะไม่ทับโซนหม้อพอดี — จำลองแนวถลาแบบมีแรงเสียดทาน
  // (คล้าย spring/bounce physics ที่มีอยู่แล้ว) ไม่ใช่เส้นตรงไม่มีที่สิ้นสุด กันโยนพลาด
  // ไกลๆ แล้วนับผ่านเพราะบังเอิญเล็งทิศถูก
  function throwHitsCauldron(x, y, vx, vy, c) {
    if (Math.hypot(vx, vy) < THROW_MIN_SPEED) return false;
    let px = x, py = y, svx = vx, svy = vy;
    for (let s = 0; s < THROW_STEPS; s++) {
      px += svx; py += svy;
      svx *= THROW_DECAY; svy *= THROW_DECAY;
      if (Math.hypot(px - c.cx, (py - c.cy) / 1.1) <= c.rx) return true;
    }
    return false;
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
    let overMouth = dragged && Math.hypot(x - c.cx, (y - c.cy) / 1.1) <= c.rx;
    // ข้อ 4: ปล่อยไม่ตรงหม้อ แต่เหวี่ยงด้วยแรงพอ+ทิศพุ่งเข้าหม้อ → นับเป็นโยนลงสำเร็จ
    if (!overMouth && dragged) {
      overMouth = throwHitsCauldron(x, y, b.throwVx || 0, b.throwVy || 0, c);
    }
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
    const isQuiet = state === 'IDLE' && particles.length === 0 && !blend;
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
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.22;
      p.life -= p.decay || 0.018;
      if (p.life <= 0) { particles.splice(i, 1); particlePool.push(p); }
    }
  }

  function render() {
    scene.clearFx();
    const promptWord = matra && matra.mode !== TWO_PART ? currentWord : null;
    scene.drawCauldron(state === 'IDLE' || state === 'DRAGGING' ? promptWord : null);
    bubbles.forEach((b) => !b.dead && drawBubble(b));
    particles.forEach(drawParticle);
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

  function drawParticle(p) {
    fx.save();
    fx.globalAlpha = Math.max(0, p.life);
    fx.fillStyle = p.fillStyle; // cache ไว้ตอน spawn — เลี่ยงสร้าง string ใหม่ทุกเฟรม/ทุกอนุภาค
    if (p.star) {
      // ขอบเรืองให้เห็นชัด
      fx.shadowColor = p.shadowStyle;
      fx.shadowBlur = p.r * 0.8;
      drawStar(fx, p.x, p.y, p.r, p.r * 0.45, 5);
    } else {
      fx.beginPath();
      fx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      fx.fill();
    }
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
function drawStar(ctx, cx, cy, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / points - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
