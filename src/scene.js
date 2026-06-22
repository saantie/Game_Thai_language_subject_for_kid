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

  // ลำดับเอฟเฟกต์กลายร่างเจ้าหญิง:
  //   1) หน่วงให้คะแนนวิ่งจบก่อน (~350ms)
  //   2) 3 ลำแสงยิงลงมา (700ms) พร้อมประกายดาวไหลลงตามลำแสง
  //   3) วาบพื้น (ขาว→ทอง) + Magic Chime พร้อมกัน
  //   4) swap รูปเจ้าหญิง → animation กลายร่าง + ประกายระยิบระยับ
  function _spawnPrincessFx(stage) {
    const BEAM_DELAY  = 180;                       // ลด 50%
    const BEAM_DUR    = 350;                       // ลด 50%
    const FLASH_T     = BEAM_DELAY + BEAM_DUR;     // 530ms
    const TRANSFORM_T = FLASH_T + 60;              // 590ms

    // ── ① 3 ลำแสง + Magic Chime ──────────────────────────────────────────
    setTimeout(() => {
      const rect  = princessEl.getBoundingClientRect();
      const cx    = rect.left + rect.width / 2;
      const beamH = rect.top + rect.height * 0.78;

      // เสียง Magic Chime เริ่มพร้อม beam
      const chime = new Audio('public/assets/audio/Magic%20Chime.mp3');
      chime.volume = 0.85;
      chime.play().catch(() => {});

      const BEAMS = [
        { dx: 0,   w: 88, blur: 7, a: 0.95 },
        { dx: -66, w: 52, blur: 8, a: 0.62 },
        { dx:  66, w: 52, blur: 8, a: 0.62 },
      ];
      const beamEls = [];
      BEAMS.forEach((b) => {
        const div = document.createElement('div');
        div.className = 'px-beam';
        Object.assign(div.style, {
          left:   `${cx + b.dx - b.w / 2}px`,
          top:    '0px',
          width:  `${b.w}px`,
          height: `${beamH}px`,
          filter: `blur(${b.blur}px)`,
          background:
            `linear-gradient(to right, transparent 0%, rgba(255,255,220,${b.a}) 50%, transparent 100%),` +
            `linear-gradient(to bottom, rgba(255,255,220,0) 0%, rgba(255,255,240,${b.a * 0.8}) 100%)`,
        });
        document.body.appendChild(div);
        beamEls.push(div);

        ['✦', '✧'].forEach((g, k) => {
          const sp = document.createElement('div');
          sp.className = 'px-beam-spark';
          sp.textContent = g;
          Object.assign(sp.style, {
            left:       `${cx + b.dx - 6}px`,
            top:        '0px',
            '--beam-h': `${beamH}px`,
            '--dur':    `${BEAM_DUR - 40}ms`,
            '--delay':  `${k * 65}ms`,
          });
          document.body.appendChild(sp);
          beamEls.push(sp);
        });
      });
      setTimeout(() => beamEls.forEach((e) => e.remove()), BEAM_DUR + 175);
    }, BEAM_DELAY);

    // ── ② วาบพื้น ──────────────────────────────────────────────────────────
    setTimeout(() => {
      const rect  = princessEl.getBoundingClientRect();
      const cx    = rect.left + rect.width / 2;
      const botY  = rect.bottom;

      const flashW = rect.width * 3.2;
      const flashH = 52;
      const flash  = document.createElement('div');
      flash.className = 'px-flash';
      Object.assign(flash.style, {
        left:       `${cx - flashW / 2}px`,
        top:        `${botY - flashH / 2}px`,
        width:      `${flashW}px`,
        height:     `${flashH}px`,
        background: 'radial-gradient(ellipse, rgba(255,255,255,1) 0%, rgba(255,215,50,0.9) 44%, transparent 78%)',
      });
      document.body.appendChild(flash);

      const GLYPHS = ['✦', '✧', '★', '✩', '✦', '✧', '★', '✩', '✦', '✧'];
      for (let s = 0; s < 10; s++) {
        const angle = (s / 10) * Math.PI * 2;
        const dist  = 52 + Math.random() * 82;
        const sp    = document.createElement('div');
        sp.className = 'px-ground-spark';
        sp.textContent = GLYPHS[s];
        Object.assign(sp.style, {
          left:     `${cx - 10}px`,
          top:      `${botY - 20}px`,
          fontSize: `${12 + Math.random() * 10}px`,
          '--sx':   `${Math.cos(angle) * dist}px`,
          '--sy':   `${Math.sin(angle) * dist * 0.28 - 22}px`,
        });
        document.body.appendChild(sp);
      }
      setTimeout(() => {
        flash.remove();
        document.querySelectorAll('.px-ground-spark').forEach((e) => e.remove());
      }, 550);
    }, FLASH_T);

    // ── ③ swap รูป + animation กลายร่าง + ประกายระยิบระยับ ───────────────
    setTimeout(() => {
      princessEl.src = `public/assets/images/princess_${stage}.png`;
    }, FLASH_T + 30);

    setTimeout(() => {
      const rect  = princessEl.getBoundingClientRect();
      const cx    = rect.left + rect.width / 2;
      const midY  = rect.top  + rect.height / 2;

      princessEl.classList.remove('transform');
      void princessEl.offsetWidth;
      princessEl.classList.add('transform');

      const TW = ['✦', '✧', '★', '✩', '✦', '✧', '★', '✩', '✦', '✧'];
      for (let i = 0; i < 10; i++) {
        const angle  = Math.random() * Math.PI * 2;
        const r      = 0.35 + Math.random() * 0.65;
        const spread = rect.width * 0.68;
        const tw     = document.createElement('div');
        tw.className = 'px-twinkle';
        tw.textContent = TW[i];
        Object.assign(tw.style, {
          left:      `${cx + Math.cos(angle) * spread * r - 8}px`,
          top:       `${midY + Math.sin(angle) * spread * r * 0.55 - 8}px`,
          fontSize:  `${10 + Math.random() * 9}px`,
          '--dur':   `${280 + Math.random() * 320}ms`,
          '--delay': `${Math.random() * 475}ms`,
        });
        document.body.appendChild(tw);
      }
      setTimeout(() => {
        princessEl.classList.remove('transform');
        document.querySelectorAll('.px-twinkle').forEach((e) => e.remove());
      }, 800);
    }, TRANSFORM_T);
  }

  // เปลี่ยน stage เจ้าหญิง 1–8 พร้อม flash เวทมนตร์
  scene.setPrincessStage = function (n) {
    if (!princessEl) return;
    const stage = Math.max(1, Math.min(8, n));
    if (stage === _princessStage) return;
    _princessStage = stage;
    if (stage === 1) {
      princessEl.src = 'public/assets/images/princess_1.png';
      return;
    }
    _spawnPrincessFx(stage);
  };

  scene.clearFx = function () {
    fx.clearRect(0, 0, scene.W, scene.H);
  };

  // เรียกตอนออกจากเกม/เริ่มมาตราใหม่ — ล้าง DOM elements ที่ค้างอยู่
  scene.stopPrincessFx = function () {
    document.querySelectorAll('.px-beam,.px-beam-spark,.px-flash,.px-ground-spark,.px-twinkle').forEach((e) => e.remove());
    if (princessEl) princessEl.classList.remove('transform');
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
