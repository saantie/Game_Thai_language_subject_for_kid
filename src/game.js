// game.js — game loop, state machine (2 โหมด), collision, ด่านอ่านออกเสียง
//
// State machine (สเปก 3.1):
//   SELECT → IDLE → DRAGGING → DROPPED
//     TWO_PART  : ฟองคงอยู่ข้ามรอบ, ฟองที่อ่านถูกแล้วหายไป
//     FILL_FINAL: ตรวจตัวสะกด → ตรง=blend→READING | ผิด=เด้งกลับ
//   READING → LISTENING → EVALUATING → REWARD | RETRY | REVEAL

import { createRecognizer, matchWord } from './input/speech.js';

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
  let score = 0;

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
      const r = Math.max(28, Math.min(W, H) * 0.07);
      const margin = r * 1.4;
      const usableW = W - margin * 2;
      bubbles.forEach((b, i) => {
        b.r = r;
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
      const r = Math.max(14, Math.min(Math.min(cellW, cellH) * 0.40, 36));

      bubbles.forEach((b, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        b.r = r;
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
      particles.push(p);
    }
  }

  // ---------- Round flow ----------
  function startMatra(m) {
    matra = m;
    roundIndex = 0;
    perfectCount = 0;
    score = 0;
    updateScore();
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
    blend = null;
    held = null;

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

  function updateScore(gained) {
    dom.hudScore.textContent = score;
    if (gained && dom.hudScore.parentElement) {
      const pill = dom.hudScore.parentElement;
      pill.classList.remove('bump');
      void pill.offsetWidth; // restart animation
      pill.classList.add('bump');
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
        dom.hudWord.textContent = `${held.letter} + ${sara} = ${held.letter}${sara}`;
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
    scene.witch.play('cast');
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
    if (state !== 'READING' || !recog.supported) return;
    setState('LISTENING');
    dom.micState.textContent = '🔴 กำลังฟัง...';
    dom.micBtn.classList.add('listening');
    audio.duck();
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
          dom.micState.textContent = 'ไม่ได้ยินเสียง ลองกดพูดอีกครั้งนะ';
          setState('READING');
        }
      }
    );
  }

  function evaluate(correct, heard) {
    if (state === 'EVALUATING' || state === 'REWARD') return;
    setState('EVALUATING');
    dom.micBtn.classList.remove('listening');
    if (heard) dom.micState.textContent = `ได้ยิน: "${heard}"`;
    if (correct) {
      reward();
    } else {
      readAttempts++;
      if (readAttempts >= 2) {
        revealSpelling();
      } else {
        setState('READING');
        audio.voice('retry', { onText: witchSay });
        dom.micState.textContent += ' — ลองอ่านอีกครั้งนะจ๊ะ';
        // เปิดไมค์อัตโนมัติรอบ retry
        setTimeout(() => {
          if (state === 'READING' && recog.supported) listen();
        }, 1800);
      }
    }
  }

  function reward() {
    setState('REWARD');
    if (readAttempts === 0) perfectCount++;
    score += readAttempts === 0 ? 100 : 50; // อ่านถูกครั้งแรก = เต็ม, มี retry = ครึ่ง
    updateScore(true);
    scene.setCauldronFrame(4, 'reward'); // ควันม่วง — ฉลองอ่านถูก
    scene.witch.play('cheer');
    audio.sfx('star');
    spawnStars(scene.W * 0.5, scene.H * 0.38);
    audio.voice('correct', { onText: witchSay });
    setTimeout(nextRound, 1600);
  }

  function revealSpelling() {
    setState('REVEAL');
    scene.witch.play('idle');
    audio.voice('reveal', { onText: witchSay });
    setTimeout(() => {
      audio.playSpellReveal(currentWord, () => setTimeout(nextRound, 700));
    }, 1400);
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

    // แสดง result screen พร้อมดาว
    const starStr = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
    const msg = stars === 3 ? 'ยอดเยี่ยม! ครบทุกตัว!' : stars === 2 ? 'เก่งมากจ้า!' : 'ดีนะ ฝึกอีกครั้งนะ!';
    dom.resultStars.textContent = starStr;
    dom.resultMsg.textContent = msg;
    show(dom.resultScreen, true);
    dom.resultBtn.onclick = () => {
      show(dom.resultScreen, false);
      onExit && onExit({ matraId: matra.id, stars });
    };
  }

  // ---------- Input handlers ----------
  function onPick(x, y) {
    if (state !== 'IDLE' && state !== 'DRAGGING') return;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b.dead) continue;
      if (Math.hypot(x - b.x, y - b.y) <= b.r) {
        held = b;
        b.held = true;
        b.pop = 0.6;
        b.bouncing = false;
        b.vx = 0;
        b.vy = 0;
        setState('DRAGGING');
        updateWordPill();
        audio.sfx('pick');
        return;
      }
    }
  }
  function onMove(x, y) {
    if (held) { held.x = x; held.y = y; }
  }
  function onRelease(x, y) {
    if (!held) return;
    const b = held;
    b.held = false;
    const c = scene.cauldron;
    // zone กว้าง — ปล่อยฟองบริเวณหม้อทั้งตัวรับได้ ไม่ต้องเล็งปากหม้อพอดี
    const overMouth = Math.hypot(x - c.cx, (y - c.cy) / 1.1) <= c.rx;
    if (overMouth) {
      dropInCauldron(b);
    } else {
      setState('IDLE');
    }
    if (held === b) held = null;
    if (!overMouth) updateWordPill(); // ปล่อยนอกหม้อ → คืน pill เป็นโจทย์ตั้งต้น
  }

  // ---------- Loop / render ----------
  function loop() {
    if (!running) return;
    update();
    render();
    rafId = requestAnimationFrame(loop);
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
      p.life -= 0.018;
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

    // ตัวอักษรตั้งตรง (ไม่หมุนตามภาพ) — วาดแยกหลัง restore
    const fontSize = Math.max(12, b.r * 0.95);
    fx.save();
    fx.shadowColor = 'rgba(0,0,0,0.45)';
    fx.shadowBlur = 4;
    fx.fillStyle = '#1a2a4a';
    fx.font = `800 ${fontSize}px 'Sarabun','Segoe UI',sans-serif`;
    fx.textAlign = 'center';
    fx.textBaseline = 'middle';
    fx.fillText(b.letter, b.x, b.y + fontSize * 0.06);
    fx.restore();
  }

  function drawParticle(p) {
    fx.save();
    fx.globalAlpha = Math.max(0, p.life);
    fx.fillStyle = `hsl(${p.hue},90%,60%)`;
    if (p.star) {
      // ขอบเรืองให้เห็นชัด
      fx.shadowColor = `hsl(${p.hue},100%,70%)`;
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
    dom.hint.style.display = app.settings.showSpellHint ? 'block' : 'none';
  }
  function witchSay(text) {
    dom.toast.textContent = text;
    dom.toast.classList.add('show');
    clearTimeout(witchSay._t);
    witchSay._t = setTimeout(() => dom.toast.classList.remove('show'), 3500);
  }
  function showVoicebar() { show(dom.voicebar, true); }
  function hideVoicebar() { show(dom.voicebar, false); }
  function setState(s) { state = s; }

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
    relayout() { layoutBubbles(); },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
      recog.stop();
      audio.stopSpeaking();
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
