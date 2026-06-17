// game.js — game loop, state machine (2 โหมด), collision, ด่านอ่านออกเสียง
//
// State machine (สเปก 3.1):
//   SELECT → IDLE → DRAGGING → DROPPED
//     TWO_PART  : หย่อนในหม้อ = ผสมได้เลย → READING
//     FILL_FINAL: ตรวจตัวสะกด → ตรง=blend→READING | ผิด=เด้งกลับ
//   READING → LISTENING → EVALUATING → REWARD | RETRY | REVEAL

import { createRecognizer, matchWord } from './input/speech.js';

const TWO_PART = 'TWO_PART';

export function createGame({ scene, audio, app, dom, onExit }) {
  const fx = scene.fx;
  const recog = createRecognizer();

  let matra = null;
  let words = [];
  let roundIndex = 0;
  let currentWord = null;
  let perfectCount = 0; // อ่านถูกตั้งแต่ครั้งแรก (ใช้คิดดาว)
  let readAttempts = 0;

  let state = 'IDLE';
  let bubbles = [];
  let held = null;
  let particles = [];
  const particlePool = [];
  let blend = null; // {text, t0}
  let running = false;
  let rafId = 0;

  // ---------- Bubble ----------
  function makeBubble(letter) {
    return {
      letter,
      x: 0, y: 0, homeX: 0, homeY: 0,
      r: 0, phase: Math.random() * Math.PI * 2,
      dead: false, held: false, pop: 0,
    };
  }

  function layoutBubbles() {
    const W = scene.W, H = scene.H;
    const r = Math.max(30, Math.min(W, H) * 0.07);
    const n = bubbles.length;
    const margin = r * 1.4;
    const usableW = W - margin * 2;
    bubbles.forEach((b, i) => {
      b.r = r;
      // จัดเป็นแถวบน ๆ กระจายเท่า ๆ กัน
      const t = n === 1 ? 0.5 : i / (n - 1);
      b.homeX = margin + usableW * t;
      b.homeY = H * (0.2 + 0.12 * Math.sin(i * 1.7));
      if (b.x === 0 && b.y === 0) {
        b.x = b.homeX;
        b.y = b.homeY;
      }
    });
  }

  // ---------- Particles (object pool) ----------
  function spawnExplosion(cx, cy) {
    for (let i = 0; i < 26; i++) {
      const p = particlePool.pop() || {};
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      p.x = cx; p.y = cy;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 2;
      p.life = 1;
      p.r = 3 + Math.random() * 5;
      p.hue = 120 + Math.random() * 80;
      particles.push(p);
    }
  }
  function spawnStars(cx, cy) {
    for (let i = 0; i < 18; i++) {
      const p = particlePool.pop() || {};
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 5;
      p.x = cx; p.y = cy;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 3;
      p.life = 1;
      p.r = 4 + Math.random() * 6;
      p.hue = 45 + Math.random() * 15;
      p.star = true;
      particles.push(p);
    }
  }

  // ---------- Round flow ----------
  function startMatra(m) {
    matra = m;
    words = m.words.slice();
    // สุ่มลำดับคำ
    for (let i = words.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [words[i], words[j]] = [words[j], words[i]];
    }
    roundIndex = 0;
    perfectCount = 0;
    dom.hudName.textContent = m.name;
    show(dom.hud, true);
    startRound();
    if (!running) {
      running = true;
      loop();
    }
  }

  function startRound() {
    if (roundIndex >= words.length) return finishMatra();
    currentWord = words[roundIndex];
    readAttempts = 0;
    blend = null;
    held = null;
    spawnBubbles();
    setState('IDLE');
    updateHud();
    hideVoicebar();
    scene.witch.play('idle');
  }

  function spawnBubbles() {
    let letters;
    if (matra.mode === TWO_PART) {
      letters = matra.bubbles.slice();
    } else {
      letters = shuffle([currentWord.final, ...currentWord.distractors]);
    }
    bubbles = letters.map(makeBubble);
    layoutBubbles();
  }

  function updateHud() {
    dom.hudProgress.textContent = `คำที่ ${roundIndex + 1} / ${words.length}`;
  }

  // ---------- Drop logic (สเปก 3.2) ----------
  function dropInCauldron(bubble) {
    if (matra.mode !== TWO_PART) {
      if (bubble.letter !== currentWord.final) {
        // ผิด → เด้งกลับนุ่มนวล ไม่เข้าสู่รอบอ่าน
        bubble.pop = 1;
        setState('IDLE');
        audio.sfx('wrong_soft');
        audio.voice('wrong', { onText: witchSay });
        return;
      }
    } else {
      // TWO_PART: ฟอง = พยัญชนะต้น → คำ = พยัญชนะ + สระ
      currentWord = matra.words.find((w) => w.lead === bubble.letter) || currentWord;
    }
    bubble.dead = true;
    held = null;
    setState('DROPPED');
    audio.sfx('boom');
    spawnExplosion(scene.cauldron.cx, scene.cauldron.cy - scene.cauldron.ry * 0.2);
    blend = { text: currentWord.display, t0: performance.now() };
    scene.witch.play('cast');
    setTimeout(() => startReadingRound(), 950);
  }

  // ---------- Reading round ----------
  function startReadingRound() {
    setState('READING');
    blend = null;
    dom.wordBig.textContent = currentWord.display;
    renderSpellHint();
    showVoicebar();
    dom.micBtn.disabled = !recog.supported;
    dom.micBtn.textContent = recog.supported ? '🎤 พูดคำนี้' : '🎤 (อุปกรณ์ไม่รองรับ)';
    dom.micState.textContent = '';
    audio.voice('read', { onText: witchSay });
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
      }
    }
  }

  function reward() {
    setState('REWARD');
    if (readAttempts === 0) perfectCount++;
    scene.witch.play('cheer');
    audio.sfx('star');
    spawnStars(scene.W * 0.5, scene.H * 0.4);
    audio.voice('correct', { onText: witchSay });
    setTimeout(nextRound, 1500);
  }

  function revealSpelling() {
    setState('REVEAL');
    audio.voice('reveal', { onText: witchSay });
    setTimeout(() => {
      audio.playSpellReveal(currentWord, () => {
        setTimeout(nextRound, 700);
      });
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
    const prev = app.progress[matra.id] || 0;
    app.progress[matra.id] = Math.max(prev, stars);
    running = false;
    cancelAnimationFrame(rafId);
    onExit && onExit({ matraId: matra.id, stars });
  }

  // ---------- Input handlers (จาก pointer.js) ----------
  function onPick(x, y) {
    if (state !== 'IDLE' && state !== 'DRAGGING') return;
    // หาฟองบนสุดที่โดน
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b.dead) continue;
      if (Math.hypot(x - b.x, y - b.y) <= b.r) {
        held = b;
        b.held = true;
        b.pop = 0.6;
        setState('DRAGGING');
        audio.sfx('pick');
        return;
      }
    }
  }
  function onMove(x, y) {
    if (held) {
      held.x = x;
      held.y = y;
    }
  }
  function onRelease(x, y) {
    if (!held) return;
    const b = held;
    b.held = false;
    const c = scene.cauldron;
    const overMouth =
      Math.hypot(x - c.cx, (y - (c.cy - c.ry * 0.2)) / 0.6) <= c.rx;
    if (overMouth) {
      dropInCauldron(b);
    } else {
      setState('IDLE');
    }
    if (held === b) held = null;
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
        // ลอยกลับเข้า home + bob
        const bob = Math.sin(now * 0.002 + b.phase) * 8;
        b.x += (b.homeX - b.x) * 0.08;
        b.y += (b.homeY + bob - b.y) * 0.08;
      }
      if (b.pop > 0) b.pop = Math.max(0, b.pop - 0.05);
    });
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22;
      p.life -= 0.02;
      if (p.life <= 0) {
        particles.splice(i, 1);
        particlePool.push(p);
      }
    }
  }

  function render() {
    scene.clearFx();
    const promptWord = matra && matra.mode !== TWO_PART ? currentWord : null;
    // ระหว่าง blend/reading ไม่ต้องโชว์ prompt
    scene.drawCauldron(state === 'IDLE' || state === 'DRAGGING' ? promptWord : null);

    bubbles.forEach((b) => !b.dead && drawBubble(b));
    particles.forEach(drawParticle);
    if (blend) drawBlend();
  }

  function drawBubble(b) {
    const scale = 1 + b.pop * 0.25;
    const r = b.r * scale;
    fx.save();
    // ฟองวาว
    const g = fx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.3, r * 0.1, b.x, b.y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(150,220,255,0.55)');
    g.addColorStop(1, 'rgba(80,140,220,0.25)');
    fx.fillStyle = g;
    fx.beginPath();
    fx.arc(b.x, b.y, r, 0, Math.PI * 2);
    fx.fill();
    fx.strokeStyle = 'rgba(255,255,255,0.7)';
    fx.lineWidth = 2;
    fx.stroke();
    // ตัวอักษร
    fx.fillStyle = '#15233a';
    fx.font = `700 ${r}px 'Sarabun','Segoe UI',sans-serif`;
    fx.textAlign = 'center';
    fx.textBaseline = 'middle';
    fx.fillText(b.letter, b.x, b.y + r * 0.04);
    fx.restore();
  }

  function drawParticle(p) {
    fx.save();
    fx.globalAlpha = Math.max(0, p.life);
    fx.fillStyle = `hsl(${p.hue},90%,60%)`;
    if (p.star) {
      drawStar(fx, p.x, p.y, p.r, p.r * 0.5, 5);
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
  function showVoicebar() {
    show(dom.voicebar, true);
  }
  function hideVoicebar() {
    show(dom.voicebar, false);
  }

  function setState(s) {
    state = s;
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
    relayout() {
      layoutBubbles();
    },
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
function show(el, on) {
  el.classList.toggle('hidden', !on);
}
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
