// scene.js — render ฉากป่า (bgCanvas วาดครั้งเดียว) + หม้อ + แม่มด (DOM/CSS)
// แยกชั้น static ออกจาก dynamic ตามสถาปัตยกรรมในสเปก (หัวข้อ 0, 5)

export function initScene(root) {
  const bgCanvas = root.querySelector('#bgCanvas');
  const fxCanvas = root.querySelector('#fxCanvas');
  const witchEl = root.querySelector('.witch');
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
    const W = scene.W,
      H = scene.H;
    scene.cauldron.cx = W * 0.5;
    scene.cauldron.cy = H * 0.78;
    scene.cauldron.rx = Math.min(W * 0.22, 190);
    scene.cauldron.ry = scene.cauldron.rx * 0.62;
    scene.cauldron.rim = scene.cauldron.ry * 0.45;
  }

  function drawForest() {
    const W = scene.W,
      H = scene.H;
    // ท้องฟ้ากลางคืน
    const sky = bg.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1b1140');
    sky.addColorStop(0.55, '#2a1a55');
    sky.addColorStop(1, '#0f1a2e');
    bg.fillStyle = sky;
    bg.fillRect(0, 0, W, H);

    // พระจันทร์
    bg.save();
    bg.globalAlpha = 0.9;
    bg.fillStyle = '#f7e9b0';
    bg.beginPath();
    bg.arc(W * 0.8, H * 0.18, Math.min(W, H) * 0.07, 0, Math.PI * 2);
    bg.fill();
    bg.globalAlpha = 0.18;
    bg.beginPath();
    bg.arc(W * 0.8, H * 0.18, Math.min(W, H) * 0.1, 0, Math.PI * 2);
    bg.fill();
    bg.restore();

    // ดาวเล็ก ๆ
    bg.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 40; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 12543.123) % 1;
      const px = Math.abs(x) * W;
      const py = Math.abs(y) * H * 0.5;
      bg.globalAlpha = 0.3 + Math.abs(Math.sin(i)) * 0.5;
      bg.fillRect(px, py, 2, 2);
    }
    bg.globalAlpha = 1;

    // ต้นไม้ silhouette
    drawTrees(W, H);

    // พื้นป่า
    const ground = bg.createLinearGradient(0, H * 0.72, 0, H);
    ground.addColorStop(0, '#13251a');
    ground.addColorStop(1, '#0a160f');
    bg.fillStyle = ground;
    bg.fillRect(0, H * 0.72, W, H * 0.28);

    // หรี่โซน gameplay กันลายป่ารบกวนตัวอักษร
    bg.fillStyle = 'rgba(20,8,40,0.28)';
    bg.fillRect(0, H * 0.45, W, H * 0.55);
  }

  function drawTrees(W, H) {
    bg.fillStyle = '#0d1f17';
    const positions = [0.08, 0.22, 0.92, 0.78, 0.5];
    positions.forEach((p, i) => {
      const x = W * p;
      const w = Math.min(W, H) * (0.05 + (i % 2) * 0.02);
      const top = H * (0.2 + (i % 3) * 0.05);
      // ลำต้น
      bg.fillRect(x - w * 0.12, top, w * 0.24, H - top);
      // พุ่มไม้สามเหลี่ยมซ้อน
      for (let k = 0; k < 3; k++) {
        const yy = top + k * H * 0.06;
        const ww = w * (1.4 - k * 0.25);
        bg.beginPath();
        bg.moveTo(x, yy - H * 0.06);
        bg.lineTo(x - ww, yy + H * 0.05);
        bg.lineTo(x + ww, yy + H * 0.05);
        bg.closePath();
        bg.fill();
      }
    });
  }

  // วาดหม้อบน fxCanvas (เรียกทุกเฟรมจาก game) — รับ ctx เพื่อวาด glow ตามจังหวะ
  scene.drawCauldron = function (promptWord) {
    const c = scene.cauldron;
    const ctx = fx;
    ctx.save();
    // เงาใต้หม้อ
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(c.cx, c.cy + c.ry * 0.9, c.rx * 1.05, c.ry * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // ตัวหม้อ
    const body = ctx.createLinearGradient(c.cx - c.rx, c.cy, c.cx + c.rx, c.cy);
    body.addColorStop(0, '#1b1b22');
    body.addColorStop(0.5, '#3a3a48');
    body.addColorStop(1, '#15151b');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(c.cx - c.rx, c.cy - c.ry * 0.2);
    ctx.quadraticCurveTo(c.cx - c.rx * 1.1, c.cy + c.ry * 1.3, c.cx, c.cy + c.ry * 1.5);
    ctx.quadraticCurveTo(c.cx + c.rx * 1.1, c.cy + c.ry * 1.3, c.cx + c.rx, c.cy - c.ry * 0.2);
    ctx.closePath();
    ctx.fill();

    // ปากหม้อ
    ctx.fillStyle = '#0c0c12';
    ctx.beginPath();
    ctx.ellipse(c.cx, c.cy - c.ry * 0.2, c.rx, c.ry * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // ของเหลวเรืองแสง
    const glow = 0.55 + 0.45 * Math.sin(performance.now() * 0.004);
    const liq = ctx.createRadialGradient(
      c.cx, c.cy - c.ry * 0.2, 2,
      c.cx, c.cy - c.ry * 0.2, c.rx
    );
    liq.addColorStop(0, `rgba(120,255,180,${0.55 + glow * 0.3})`);
    liq.addColorStop(0.6, 'rgba(60,200,140,0.5)');
    liq.addColorStop(1, 'rgba(20,80,60,0.2)');
    ctx.fillStyle = liq;
    ctx.beginPath();
    ctx.ellipse(c.cx, c.cy - c.ry * 0.2, c.rx * 0.86, c.ry * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // ขอบหม้อ
    ctx.strokeStyle = '#5a5a6e';
    ctx.lineWidth = Math.max(3, c.rx * 0.04);
    ctx.beginPath();
    ctx.ellipse(c.cx, c.cy - c.ry * 0.2, c.rx, c.ry * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // โจทย์ในหม้อ (โหมด FILL_FINAL): lead + ช่องว่างเรืองแสง
    if (promptWord && promptWord.final) {
      drawPrompt(promptWord);
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
    drawForest();
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
