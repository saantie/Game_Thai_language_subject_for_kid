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
