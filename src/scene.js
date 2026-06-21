// scene.js — render ฉากป่า (bgCanvas วาดครั้งเดียว) + หม้อ + แม่มด (DOM/CSS)
// แยกชั้น static ออกจาก dynamic ตามสถาปัตยกรรมในสเปก (หัวข้อ 0, 5)

export function initScene(root) {
  const bgCanvas = root.querySelector('#bgCanvas');
  const fxCanvas = root.querySelector('#fxCanvas');
  const witchEl  = root.querySelector('.witch');
  const cauldronImgEl = document.getElementById('cauldronImg');
  const princessEl    = document.getElementById('princessImg');
  let _princessStage  = 0;
  const bg = bgCanvas.getContext('2d');
  const fx = fxCanvas.getContext('2d');

  const scene = {
    fx,
    fxCanvas,
    W: 0,
    H: 0,
    dpr: 1,
    cauldron: { cx: 0, cy: 0, rx: 0, ry: 0, rim: 0 },
    _resizeCbs: [],
  };

  function applyCanvasSize(canvas, c) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = root.clientWidth;
    const H = root.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W, H, dpr };
  }

  function layoutCauldron() {
    const W = scene.W, H = scene.H;
    // คำนวณจาก CSS โดยตรง: clamp(160px, 48vw, 400px), bottom: 2%, max-height: 60vh
    const imgW = Math.max(160, Math.min(W * 0.48, 400));
    const naturalH = imgW * 1.15;               // สัดส่วนประมาณ frame 1 (หม้อ)
    const cappedH  = Math.min(naturalH, H * 0.60);
    const imgBottom = H * 0.98;
    const imgTop    = imgBottom - cappedH;

    scene.cauldron.cx  = W * 0.5;
    scene.cauldron.cy  = imgTop + cappedH * 0.42; // ปากหม้ออยู่ ~42% จาก top ของรูป
    scene.cauldron.rx  = imgW * 0.62;             // กว้าง ≈ ปากหม้อ + ข้างๆ
    scene.cauldron.ry  = scene.cauldron.rx * 0.60; // สูง — รับฟองที่ปล่อยบนหม้อทั้งตัว
    scene.cauldron.rim = scene.cauldron.ry * 0.35;
  }

  // preload frames 2-5 ล่วงหน้า กัน flicker ตอนสลับ (frame 1 โหลดจาก HTML แล้ว)
  [2,3,4,5].forEach((n) => { const img = new Image(); img.src = `public/assets/images/cauldron${n}.png`; });

  function drawScene() {
    const W = scene.W,
      H = scene.H;
    // ท้องฟ้าเวทมนตร์ม่วง-ลาเวนเดอร์ (สดใสตาม mockup)
    const sky = bg.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#b39ae0');
    sky.addColorStop(0.4, '#8d6fd1');
    sky.addColorStop(0.75, '#6347b0');
    sky.addColorStop(1, '#3d2470');
    bg.fillStyle = sky;
    bg.fillRect(0, 0, W, H);

    // แสงออร่าฟุ้งกลางฉาก
    const aura = bg.createRadialGradient(
      W * 0.5, H * 0.42, Math.min(W, H) * 0.05,
      W * 0.5, H * 0.42, Math.min(W, H) * 0.7
    );
    aura.addColorStop(0, 'rgba(200,170,255,0.35)');
    aura.addColorStop(1, 'rgba(200,170,255,0)');
    bg.fillStyle = aura;
    bg.fillRect(0, 0, W, H);

    // พระจันทร์เรืองแสง
    bg.save();
    bg.globalAlpha = 0.5;
    bg.fillStyle = '#fff6d8';
    bg.beginPath();
    bg.arc(W * 0.82, H * 0.16, Math.min(W, H) * 0.11, 0, Math.PI * 2);
    bg.fill();
    bg.globalAlpha = 0.95;
    bg.fillStyle = '#fdeeb8';
    bg.beginPath();
    bg.arc(W * 0.82, H * 0.16, Math.min(W, H) * 0.07, 0, Math.PI * 2);
    bg.fill();
    bg.restore();

    // ประกายดาว (ดาว 4 แฉก + จุดเล็ก) กระจายครึ่งบน
    for (let i = 0; i < 46; i++) {
      const rx = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
      const ry = Math.abs((Math.sin(i * 78.233) * 12543.123) % 1);
      const px = rx * W;
      const py = ry * H * 0.62;
      const tw = 0.4 + Math.abs(Math.sin(i * 2.3)) * 0.6;
      bg.globalAlpha = tw;
      bg.fillStyle = '#fff';
      if (i % 3 === 0) {
        const s = 3 + (i % 4);
        drawSparkle(bg, px, py, s);
      } else {
        bg.fillRect(px, py, 2, 2);
      }
    }
    bg.globalAlpha = 1;

    // หมอกม่วงด้านล่าง (ให้หม้ออยู่บนพื้นนุ่ม ๆ)
    const mist = bg.createLinearGradient(0, H * 0.7, 0, H);
    mist.addColorStop(0, 'rgba(60,30,110,0)');
    mist.addColorStop(1, 'rgba(40,18,80,0.55)');
    bg.fillStyle = mist;
    bg.fillRect(0, H * 0.7, W, H * 0.3);

    // vignette ขอบมืดเล็กน้อย โฟกัสกลางจอ
    const vig = bg.createRadialGradient(
      W * 0.5, H * 0.5, Math.min(W, H) * 0.35,
      W * 0.5, H * 0.5, Math.max(W, H) * 0.75
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(20,8,45,0.45)');
    bg.fillStyle = vig;
    bg.fillRect(0, 0, W, H);
  }

  // ดาว 4 แฉกเล็ก ๆ (ประกายเวทมนตร์)
  function drawSparkle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx, cy, cx + r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + r);
    ctx.quadraticCurveTo(cx, cy, cx - r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy - r);
    ctx.closePath();
    ctx.fill();
  }

  // เขย่าหม้อ + ลบ class อัตโนมัติหลัง animation จบ
  scene.cauldronWiggle = function () {
    if (!cauldronImgEl) return;
    cauldronImgEl.classList.remove('wiggle');
    void cauldronImgEl.offsetWidth;
    cauldronImgEl.classList.add('wiggle');
    cauldronImgEl.addEventListener('animationend', () => {
      cauldronImgEl.classList.remove('wiggle');
    }, { once: true });
  };

  // drawCauldron: ตัวหม้อใช้ DOM img แล้ว — วาดเฉพาะโจทย์ FILL_FINAL บน fxCanvas
  scene.drawCauldron = function (promptWord) {
    if (promptWord && promptWord.final) {
      drawPrompt(promptWord);
    }
  };

  // สลับ frame ตาม game state  (1=IDLE 2=BREW 3=READING 4=REWARD 5=BOOM)
  scene.setCauldronFrame = function (n, animate) {
    if (!cauldronImgEl) return;
    cauldronImgEl.src = `public/assets/images/cauldron${n}.png`;
    cauldronImgEl.classList.remove('flash', 'reward');
    if (animate === 'flash') {
      void cauldronImgEl.offsetWidth; // reflow
      cauldronImgEl.classList.add('flash');
    } else if (animate === 'reward') {
      void cauldronImgEl.offsetWidth;
      cauldronImgEl.classList.add('reward');
    }
  };

  function drawPrompt(word) {
    const c = scene.cauldron;
    const ctx = fx;
    const y = c.cy - c.ry * 0.25;
    const fontSize = Math.max(26, c.rx * 0.32);
    ctx.save();
    ctx.font = `700 ${fontSize}px 'Sarabun','Segoe UI',sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const leadW = ctx.measureText(word.lead).width;
    const slotW = fontSize * 0.75;
    const gap = fontSize * 0.12;
    const totalW = leadW + gap + slotW;
    const startX = c.cx - totalW / 2;

    // เงาตัวอักษรให้อ่านง่าย
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#fff';
    ctx.fillText(word.lead, startX, y);

    // ช่องว่างกระพริบ
    const pulse = 0.4 + 0.4 * Math.sin(performance.now() * 0.006);
    const bx = startX + leadW + gap;
    const by = y - slotW / 2;
    ctx.shadowBlur = 0;
    ctx.globalAlpha = pulse + 0.3;
    ctx.strokeStyle = '#9affc8';
    ctx.lineWidth = 3;
    roundRect(ctx, bx, by, slotW, slotW, 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------- แม่มด (DOM emoji + CSS) ----------
  let witchResetTimer = null;
  scene.witch = {
    play(state) {
      witchEl.className = 'witch ' + state;
      clearTimeout(witchResetTimer);
      if (state === 'cheer' || state === 'cast') {
        witchResetTimer = setTimeout(() => {
          witchEl.className = 'witch idle';
        }, 900);
      }
    },
  };

  // แสงยิงลงมา + วาบพื้น + เสียง Magic Chime เมื่อเจ้าหญิงกลายร่าง
  function _spawnPrincessFx() {
    const rect = princessEl.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const botY = rect.bottom;
    const topY = rect.top;

    // เล่นเสียง Magic Chime
    const chime = new Audio('public/assets/audio/Magic%20Chime.mp3');
    chime.volume = 0.85;
    chime.play().catch(() => {});

    // แสงยิงจากด้านบนลงมาถึงตัวเจ้าหญิง
    const beamW = Math.round(rect.width * 0.55);
    const beam  = document.createElement('div');
    beam.className = 'px-beam';
    Object.assign(beam.style, {
      left:       `${cx - beamW / 2}px`,
      top:        '0',
      width:      `${beamW}px`,
      height:     `${topY + rect.height * 0.75}px`,
      background: `linear-gradient(to bottom,
        rgba(255,240,160,0) 0%,
        rgba(255,220,80,0.55) 35%,
        rgba(255,255,200,0.9) 85%,
        rgba(255,255,255,1) 100%)`,
    });
    document.body.appendChild(beam);

    // วาบกระจายที่พื้นที่เจ้าหญิงยืน
    const flashW = rect.width * 2.8;
    const flashH = 36;
    const flash  = document.createElement('div');
    flash.className = 'px-flash';
    Object.assign(flash.style, {
      left:       `${cx - flashW / 2}px`,
      top:        `${botY - flashH / 2}px`,
      width:      `${flashW}px`,
      height:     `${flashH}px`,
      background: 'radial-gradient(ellipse, rgba(255,250,180,1) 0%, rgba(255,210,60,0.7) 45%, transparent 100%)',
    });
    document.body.appendChild(flash);

    // ประกายดาวกระจายจากพื้น
    const GLYPHS = ['✦','⭐','✧','★','✩','💫'];
    for (let s = 0; s < 9; s++) {
      const angle = (s / 9) * Math.PI * 2;
      const dist  = 55 + Math.random() * 70;
      const spark = document.createElement('div');
      spark.className = 'px-spark';
      spark.textContent = GLYPHS[s % GLYPHS.length];
      Object.assign(spark.style, {
        left:      `${cx - 10}px`,
        top:       `${botY - 18}px`,
        fontSize:  `${13 + Math.random() * 9}px`,
        color:     'gold',
        textShadow:'0 0 6px rgba(255,220,50,0.9)',
        '--sx':    `${Math.cos(angle) * dist}px`,
        '--sy':    `${Math.sin(angle) * dist * 0.35 - 15}px`,
      });
      document.body.appendChild(spark);
    }

    // ลบ element ทั้งหมดหลัง animation จบ
    setTimeout(() => {
      beam.remove();
      flash.remove();
      document.querySelectorAll('.px-spark').forEach((e) => e.remove());
    }, 1600);
  }

  // เปลี่ยน stage เจ้าหญิง 1–8 พร้อม flash เวทมนตร์ (swap src ตรงจุดสว่างสุด)
  scene.setPrincessStage = function (n) {
    if (!princessEl) return;
    const stage = Math.max(1, Math.min(8, n));
    if (stage === _princessStage) return;
    _princessStage = stage;
    if (stage === 1) {
      princessEl.src = 'public/assets/images/princess_1.png';
      return;
    }
    // แสงลงมา + เสียง + swap รูปตอน brightness peak
    _spawnPrincessFx();
    princessEl.classList.remove('transform');
    void princessEl.offsetWidth;
    princessEl.classList.add('transform');
    setTimeout(() => {
      princessEl.src = `public/assets/images/princess_${stage}.png`;
    }, 250);
    setTimeout(() => princessEl.classList.remove('transform'), 700);
  };

  scene.clearFx = function () {
    // fxCanvas โปร่งใส — เคลียร์ด้วย clearRect ไม่ใช่ fillRect
    fx.clearRect(0, 0, scene.W, scene.H);
  };

  scene.onResize = function (cb) {
    scene._resizeCbs.push(cb);
  };

  function resize() {
    const b = applyCanvasSize(bgCanvas, bg);
    applyCanvasSize(fxCanvas, fx);
    scene.W = b.W;
    scene.H = b.H;
    scene.dpr = b.dpr;
    layoutCauldron();
    drawScene();
    scene._resizeCbs.forEach((cb) => cb(scene.W, scene.H));
  }

  window.addEventListener('resize', resize);
  resize();
  return scene;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
