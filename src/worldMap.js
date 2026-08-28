// worldMap.js — "แผนที่มนตรา" แทนหน้าเลือกมาตรา (Phase 1)
//
// เดินฮีโร่ (เจ้าหญิง) บนแผนที่ป่าเวทมนตร์เลื่อนแนวตั้ง แตะ/ลากพื้นเพื่อเดิน
// คริสตอล 1 ลูก = 1 มาตรา เรียงตามลำดับการสอน (MATRA index 0 → 29)
// เดินไป/แตะคริสตอลที่ปลดล็อก → onPickMatra(id) → main.js เรียก startMatraById เดิม
//
// โครงเลียนแบบ src/mahjong.js — โมดูลมินิเกมแยก วาดบน #fxCanvas ที่ใช้ร่วมกับ
// game.js / mahjong.js  ***ต้องมีเจ้าของ canvas ตัวเดียวต่อครั้ง*** — main.js เรียก
// worldMap.stop() ทุกครั้งที่ออกจากหน้า map (ดู showScreen)
//
// Phase 1 ยังไม่มี: ลูกสมุน/ระบบตี, แอนิเมชันดูดดาว/กุญแจแตก, biome สี, parallax เต็ม

import { MATRA } from './data/matra.js';
import { isUnlocked, getStars } from './ui/levelSelect.js';
import { createParticleSystem } from './particles.js';

// asset ที่มีอยู่แล้วใน APP_SHELL — encode ช่องว่างเหมือนที่อื่นในโปรเจกต์
const CRYSTAL_IMG = new Image();
CRYSTAL_IMG.src = 'public/assets/images/glass%20ball.png';
const HERO_IMG = new Image();
HERO_IMG.src = 'public/assets/images/princess_1.png';

const REDUCED_MOTION =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- ปรับจูน ----
const NODE_R = 30;        // รัศมีคริสตอล (วาด + hit test)
const HERO_R = 26;        // ครึ่งความสูงฮีโร่โดยประมาณ (เงา/ระยะถึงโหนด)
const HERO_SPEED = 4;     // px ต่อเฟรม — ไม่สเกลด้วย dt (แนวเดียวกับ game.js)
const ARRIVE_EPS = 3;
const TAP_SLOP = 10;      // แตะ vs ลาก (เลียน game.js dragged check)
const CAM_LERP = 0.12;
const ENTER_DELAY = 140;  // หน่วงสั้น ๆ หลัง "เก็บ" ก่อนสลับไปมาตรา (ได้ยินเสียง ting)

const NODE_FONT = "600 13px 'Sarabun', sans-serif";
const STAR_FILL = '#ffd86b';
const STAR_EMPTY = 'rgba(255,255,255,0.22)';
const ROAD_DASH = [2, 12];   // cache — setLineDash รับ array; อย่าสร้างใหม่ทุกเฟรม
const NO_DASH = [];
const HAS_PATH2D = typeof Path2D === 'function';

// glass ball.png = 400x218 มีขอบโปร่งเยอะ ลูกแก้วจริง ~154x180 กลางภาพ
// วาดทั้งภาพ scale ให้ "ลูกแก้ว" สูง ≈ NODE_R*2 แล้ววางกึ่งกลางโหนด (ไม่บีบให้เพี้ยน)
const CR_SCALE = (NODE_R * 2) / 180;
const CR_DW = 400 * CR_SCALE;
const CR_DH = 218 * CR_SCALE;

export function createWorldMap({ scene, audio, app, dom, onPickMatra }) {
  const fx = scene.fx;
  const particleFx = createParticleSystem(fx); // pool แยกของตัวเอง (แบบ mahjong.js)

  let W = scene.W || 360;
  let H = scene.H || 640;

  let running = false;
  let rafId = 0;
  let lastTs = 0;

  let nodes = [];      // [{ matraId, name, idx, wx, wy, shake }]  พิกัด world
  let worldH = 0;

  const cam = { y: 0 };
  let camTarget = 0;
  let camLockIdx = -1; // >=0 = กล้องล็อกที่โหนดนี้จนกว่าจะแตะพื้นครั้งแรก

  const hero = { wx: 0, wy: 0, tx: 0, ty: 0, moving: false, facing: 1, bob: 0 };
  let enterLatch = false; // true = ตัดสินใจเข้าโหนดแล้ว รอ stop() (กันเข้าซ้ำ tap+เดินถึง)

  const unlocked = Object.create(null); // matraId -> bool
  const stars = Object.create(null);    // matraId -> 0..3
  let focusIdx = 0;

  // แตะ/ลาก state
  let pressed = false;
  let pressX = 0;
  let pressY = 0;
  let pressNodeIdx = -1;
  let moved = false;

  let bgGrad = null;   // cache — สร้างใหม่ตอน computeLayout (ขนาดจอเปลี่ยน)
  let decorDots = [];  // ดาวจาง ๆ พื้นหลัง — คำนวณครั้งเดียวตอน computeLayout (ไม่ alloc ใน loop)
  let roadPath = null; // Path2D ของเส้นทาง (world space) — สร้างครั้งเดียวตอน computeLayout

  // ---- cancel-safe timers (คัดลอกจาก mahjong.js — เคยมีบั๊ก timer ค้างยิง
  //      callback หลัง teardown ทำให้เข้ามาตราผิดจังหวะ) ห้ามใช้ setTimeout ตรง ๆ ----
  const pendingTimers = new Set();
  function schedule(fn, ms) {
    const id = setTimeout(() => { pendingTimers.delete(id); fn(); }, ms);
    pendingTimers.add(id);
    return id;
  }
  function clearPendingTimers() {
    pendingTimers.forEach((id) => clearTimeout(id));
    pendingTimers.clear();
  }

  function mapSay(text) {
    if (!dom.toast) return;
    dom.toast.textContent = text;
    dom.toast.classList.add('show');
    clearTimeout(mapSay._t);
    mapSay._t = setTimeout(() => dom.toast.classList.remove('show'), 3000);
  }

  // ---------- layout ----------
  function computeLayout() {
    W = scene.W;
    H = scene.H;
    const N = MATRA.length;
    const marginX = Math.max(40, W * 0.16);
    const amp = Math.max(28, (W - marginX * 2) / 2);
    const midX = W / 2;
    const pad = H * 0.55;
    const spacing = Math.max(190, H * 0.42);
    worldH = pad + spacing * (N - 1) + pad;

    nodes = MATRA.map((m, i) => ({
      matraId: m.id,
      name: m.name,
      idx: i,
      // เส้นทาง "ดู" คดเคี้ยวด้วย sine — แต่กล้องเลื่อนแนวตั้งอย่างเดียว (ตัด edge case)
      wx: midX + Math.sin(i * 0.62) * amp,
      // มาตราแรก (i=0) อยู่ "ล่างสุด" ของโลก — เดินขึ้นบนเมื่อคืบหน้า (ปีนเขา)
      wy: pad + (N - 1 - i) * spacing,
      shake: 0,
    }));
    bgGrad = null;

    // ดาวพื้นหลัง — สุ่มแบบ deterministic (ไม่ใช้ Math.random ใน loop) ใน band สูง 1 จอ
    const DOT_N = 46;
    decorDots.length = 0;
    for (let i = 0; i < DOT_N; i++) {
      // hash เลขลำดับ → กระจายทั่ว ๆ พอ ไม่ต้องสวยมาก
      const a = (i * 92821) % 10007;
      const b = (i * 53113) % 9973;
      decorDots.push({ x: (a / 10007) * W, y: (b / 9973) * H });
    }

    // เส้นทาง (world space) — สร้าง Path2D ครั้งเดียว render() แค่ translate แล้ว stroke
    if (HAS_PATH2D) {
      roadPath = new Path2D();
      roadPath.moveTo(nodes[0].wx, nodes[0].wy);
      for (let i = 1; i < nodes.length; i++) roadPath.lineTo(nodes[i].wx, nodes[i].wy);
    }
  }

  function refresh() {
    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i].matraId;
      unlocked[id] = isUnlocked(app, i);
      stars[id] = getStars(app, id);
    }
    focusIdx = computeFocusIdx();
  }

  // เป้าหมายถัดไป = คริสตอลปลดล็อกลูกแรกที่ยังไม่เคยผ่าน (0 ดาว)
  // ถ้าผ่านหมดแล้ว → ลูกที่ปลดล็อกไกลสุด (ปลดล็อกเป็น linear อยู่แล้ว)
  function computeFocusIdx() {
    let lastUnlocked = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (!isUnlocked(app, i)) break;
      lastUnlocked = i;
      if ((getStars(app, nodes[i].matraId) || 0) === 0) return i;
    }
    return lastUnlocked;
  }

  function clampCam(y) {
    return Math.max(0, Math.min(y, Math.max(0, worldH - H)));
  }

  function heroRestY(node) {
    // ยืนใต้คริสตอลนิดหน่อย — ไกลพอที่ arrival check จะไม่ยิงทันทีตอน enter()
    return node.wy + NODE_R + HERO_R + 10;
  }

  // ---------- lifecycle ----------
  // opts?: { focusMatraId }  — ถ้ากลับมาจากมาตรา ให้โฟกัสลูกนั้น
  function enter(opts) {
    opts = opts || {};
    computeLayout();
    refresh();

    let fi = focusIdx;
    if (opts.focusMatraId) {
      const k = nodes.findIndex((n) => n.matraId === opts.focusMatraId);
      if (k >= 0) fi = k;
    }
    focusIdx = fi;
    const node = nodes[fi];

    hero.wx = node.wx;
    hero.wy = heroRestY(node);
    hero.tx = hero.wx;
    hero.ty = hero.wy;
    hero.moving = false;
    hero.facing = 1;
    hero.bob = 0;

    cam.y = clampCam(node.wy - H / 2);
    camTarget = cam.y;
    camLockIdx = fi;

    enterLatch = false;
    pressed = false;
    moved = false;
    pressNodeIdx = -1;

    running = true;
    lastTs = 0;
    if (!rafId) rafId = requestAnimationFrame(loop);

    // เก็บคริสตอลสำเร็จ (มีดาวแล้ว) — ประกายเบา ๆ ที่ลูกนั้น
    if (opts.focusMatraId && (stars[opts.focusMatraId] || 0) > 0 && !REDUCED_MOTION) {
      const px = node.wx;
      const py = node.wy - cam.y;
      schedule(() => {
        if (running) particleFx.spawnCelebrationBurst(px, py, { hueMin: 188, hueRange: 34 });
      }, 120);
    }
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    clearPendingTimers();
    clearTimeout(mapSay._t); // toast-hide timer ที่ค้าง
    particleFx.clear();
    scene.clearFx(); // อย่าทิ้งเฟรมแผนที่ค้างให้ game/mahjong
    hero.moving = false;
    enterLatch = false;
    camLockIdx = -1;
    pressed = false;
    moved = false;
    pressNodeIdx = -1;
  }

  function relayout() {
    if (!running) return;
    const keep = nodes[focusIdx] ? nodes[focusIdx].matraId : null;
    computeLayout();
    refresh();
    if (keep) {
      const k = nodes.findIndex((n) => n.matraId === keep);
      if (k >= 0) focusIdx = k;
    }
    const node = nodes[focusIdx];
    if (node) {
      // snap ฮีโร่+กล้องกลับโหนด focus (ยอมรับการเด้งเล็กน้อยตอนหมุนจอ)
      hero.wx = node.wx;
      hero.wy = heroRestY(node);
      hero.tx = hero.wx;
      hero.ty = hero.wy;
      hero.moving = false;
      cam.y = clampCam(node.wy - H / 2);
      camTarget = cam.y;
      camLockIdx = focusIdx;
      enterLatch = false;
    }
  }

  // ---------- input ----------
  function toWorld(x, y) {
    return { wx: x, wy: y + cam.y };
  }
  function nodeAt(wx, wy) {
    const r2 = (NODE_R + 8) * (NODE_R + 8);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const dx = wx - n.wx;
      const dy = wy - n.wy;
      if (dx * dx + dy * dy <= r2) return i;
    }
    return -1;
  }

  function onPick(x, y) {
    if (!running) return;
    pressed = true;
    moved = false;
    pressX = x;
    pressY = y;
    const w = toWorld(x, y);
    pressNodeIdx = nodeAt(w.wx, w.wy);
    // เริ่มเดินไปจุดที่แตะทันที (ถ้ากลายเป็น "แตะโหนด" onRelease จะจัดการเอง)
    hero.tx = w.wx;
    hero.ty = w.wy;
    hero.moving = true;
    camLockIdx = -1; // แตะพื้นครั้งแรก → กล้องเลิกล็อกโหนด ตามฮีโร่แทน
  }

  function onMove(x, y) {
    if (!running || !pressed) return;
    if (Math.hypot(x - pressX, y - pressY) > TAP_SLOP) moved = true;
    const w = toWorld(x, y);
    hero.tx = w.wx;
    hero.ty = w.wy;
    hero.moving = true;
  }

  function onRelease() {
    if (!running || !pressed) return;
    pressed = false;
    // แตะนิ่งบนคริสตอล → เข้าลูกนั้นเลย (ไม่ต้องเดินไปถึง)
    if (!moved && pressNodeIdx >= 0) tryEnterNode(pressNodeIdx, true);
    pressNodeIdx = -1;
  }

  function tryEnterNode(i, viaTap) {
    const n = nodes[i];
    if (!n) return;
    if (!unlocked[n.matraId]) {
      if (viaTap) {
        audio.sfx('tile_blocked');
        mapSay('ยังเข้าไม่ได้จ้ะ — ต้องผ่านลูกก่อนหน้าก่อนนะ');
        n.shake = 1;
      }
      return;
    }
    if (enterLatch) return;
    enterLatch = true;
    hero.moving = false;
    hero.tx = hero.wx;
    hero.ty = hero.wy;
    audio.sfx('ting');
    schedule(() => onPickMatra(n.matraId), ENTER_DELAY);
  }

  // ---------- loop ----------
  function loop(ts) {
    if (!running) { rafId = 0; return; }
    rafId = requestAnimationFrame(loop);
    const now = ts || performance.now();
    const quiet =
      !hero.moving &&
      particleFx.count === 0 &&
      Math.abs(camTarget - cam.y) < 0.5 &&
      !anyShake();
    // ยังคง ~30fps ตอนนิ่ง เพื่อให้วงกระเพื่อมโหนด focus เดินต่อ (แนวเดียวกับ game.js)
    if (quiet && now - lastTs < 33) return;
    lastTs = now;
    update();
    render(now);
  }

  function anyShake() {
    for (let i = 0; i < nodes.length; i++) if (nodes[i].shake > 0) return true;
    return false;
  }

  // stroke เส้นทาง — Path2D cache ถ้ารองรับ, ไม่งั้น lineTo loop (path ถูก build ใน render ก่อนเรียก)
  function strokeRoad() {
    if (HAS_PATH2D) fx.stroke(roadPath);
    else fx.stroke();
  }

  function update() {
    // ---- เดินฮีโร่ ----
    if (hero.moving) {
      const dx = hero.tx - hero.wx;
      const dy = hero.ty - hero.wy;
      const d = Math.hypot(dx, dy);
      if (d <= ARRIVE_EPS) {
        hero.wx = hero.tx;
        hero.wy = hero.ty;
        hero.moving = false;
      } else {
        const step = Math.min(d, HERO_SPEED);
        hero.wx += (dx / d) * step;
        hero.wy += (dy / d) * step;
        if (Math.abs(dx) > 0.8) hero.facing = dx < 0 ? -1 : 1;
        hero.bob += 0.28;
      }
      hero.wx = Math.max(22, Math.min(W - 22, hero.wx));
      hero.wy = Math.max(18, Math.min(worldH - 18, hero.wy));
    }

    // ---- กล้อง ----
    if (camLockIdx >= 0 && nodes[camLockIdx]) {
      camTarget = clampCam(nodes[camLockIdx].wy - H / 2);
    } else {
      camTarget = clampCam(hero.wy - H / 2);
    }
    cam.y += (camTarget - cam.y) * (REDUCED_MOTION ? 1 : CAM_LERP);
    if (Math.abs(camTarget - cam.y) < 0.3) cam.y = camTarget;

    // ---- เดินถึงคริสตอลที่ปลดล็อก → เก็บ ----
    if (!enterLatch && !pressed) {
      const hit = nearestUnlockedUnderHero();
      if (hit >= 0) tryEnterNode(hit, false);
    }

    // ---- shake decay ----
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].shake > 0) {
        nodes[i].shake -= 0.06;
        if (nodes[i].shake < 0) nodes[i].shake = 0;
      }
    }

    particleFx.update();
  }

  function nearestUnlockedUnderHero() {
    const R = NODE_R + HERO_R * 0.5;
    const r2 = R * R;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!unlocked[n.matraId]) continue;
      const dx = hero.wx - n.wx;
      const dy = hero.wy - n.wy;
      if (dx * dx + dy * dy <= r2) return i;
    }
    return -1;
  }

  // ---------- render ----------
  function render(now) {
    const cy = cam.y;
    scene.clearFx();

    // 1) พื้นหลัง — gradient เดียว (cache)
    if (!bgGrad) {
      bgGrad = fx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#241457');
      bgGrad.addColorStop(0.55, '#1b0e3f');
      bgGrad.addColorStop(1, '#150a30');
    }
    fx.fillStyle = bgGrad;
    fx.fillRect(0, 0, W, H);

    if (!REDUCED_MOTION) {
      // ดาวจาง ๆ เลื่อน parallax ช้ากว่ากล้อง (wrap ในความสูง 1 จอ)
      fx.fillStyle = 'rgba(150,130,220,0.30)';
      const off = (cy * 0.4) % H;
      for (let i = 0; i < decorDots.length; i++) {
        const d = decorDots[i];
        let y = d.y - off;
        if (y < 0) y += H;
        fx.fillRect(d.x, y, 1.6, 1.6);
      }
    }

    // 2) เส้นทาง (world space) — ใช้ Path2D cache (fallback lineTo loop ถ้าไม่รองรับ)
    fx.save();
    fx.translate(0, -cy);
    fx.lineCap = 'round';
    fx.lineJoin = 'round';
    if (!HAS_PATH2D) {
      fx.beginPath();
      fx.moveTo(nodes[0].wx, nodes[0].wy);
      for (let i = 1; i < nodes.length; i++) fx.lineTo(nodes[i].wx, nodes[i].wy);
    }
    // 3 ชั้น: ฐานเข้มกว้าง → ไส้อุ่น → เส้นประกลาง
    fx.strokeStyle = 'rgba(18,7,42,0.85)';
    fx.lineWidth = 26;
    strokeRoad();
    fx.strokeStyle = 'rgba(255,214,130,0.28)';
    fx.lineWidth = 10;
    strokeRoad();
    fx.setLineDash(ROAD_DASH);
    fx.strokeStyle = 'rgba(255,236,184,0.55)';
    fx.lineWidth = 2;
    strokeRoad();
    fx.setLineDash(NO_DASH);
    fx.restore();

    // 3) คริสตอล (cull นอกจอ)
    fx.textAlign = 'center';
    fx.textBaseline = 'alphabetic';
    fx.font = NODE_FONT; // set ครั้งเดียว — drawNode ไม่ต้อง set ซ้ำทุกใบ
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const sy = n.wy - cy;
      if (sy < -80 || sy > H + 80) continue;
      let sx = n.wx;
      if (n.shake > 0) sx += Math.sin(now * 0.05) * 5 * n.shake;
      drawNode(n, sx, sy, i, now);
    }

    // 4) ฮีโร่
    drawHero(cy);

    // 5) particle
    particleFx.draw();
  }

  function drawNode(n, sx, sy, i, now) {
    const locked = !unlocked[n.matraId];

    // วงกระเพื่อมที่ลูกปัจจุบัน
    if (i === focusIdx && !locked) {
      const t = (now % 1400) / 1400;
      fx.beginPath();
      fx.arc(sx, sy, NODE_R + 5 + t * 9, 0, Math.PI * 2);
      fx.strokeStyle = 'rgba(130,230,255,' + (0.55 * (1 - t)).toFixed(3) + ')';
      fx.lineWidth = 2.5;
      fx.stroke();
    }

    // แสงเรือง
    fx.beginPath();
    fx.arc(sx, sy, NODE_R + 3, 0, Math.PI * 2);
    fx.fillStyle = locked ? 'rgba(58,42,94,0.45)' : 'rgba(120,220,255,0.16)';
    fx.fill();

    // ตัวคริสตอล (คงสัดส่วนภาพ วางกึ่งกลางโหนด)
    if (CRYSTAL_IMG.complete && CRYSTAL_IMG.naturalWidth) {
      if (locked) fx.globalAlpha = 0.42;
      fx.drawImage(CRYSTAL_IMG, sx - CR_DW / 2, sy - CR_DH / 2, CR_DW, CR_DH);
      fx.globalAlpha = 1;
    } else {
      fx.beginPath();
      fx.arc(sx, sy, NODE_R - 4, 0, Math.PI * 2);
      fx.fillStyle = locked ? '#3a2a5e' : '#6cd6f5';
      fx.fill();
    }

    if (locked) {
      // แม่กุญแจ
      fx.fillStyle = 'rgba(16,8,34,0.5)';
      fx.beginPath();
      fx.arc(sx, sy, NODE_R - 2, 0, Math.PI * 2);
      fx.fill();
      fx.strokeStyle = '#c3b4e8';
      fx.lineWidth = 2.6;
      fx.beginPath();
      fx.arc(sx, sy - 3, 5.5, Math.PI, 0);
      fx.stroke();
      fx.fillStyle = '#c3b4e8';
      fx.fillRect(sx - 7.5, sy - 3, 15, 11);
    } else {
      // ดาว 0–3
      const sc = stars[n.matraId] || 0;
      const py = sy + NODE_R + 11;
      for (let s = 0; s < 3; s++) drawPip(sx - 14 + s * 14, py, s < sc);
    }

    // ชื่อมาตรา (fx.font set แล้วใน render() ก่อนวน loop)
    fx.fillStyle = locked ? 'rgba(203,193,232,0.62)' : '#ece3fb';
    fx.fillText(n.name, sx, sy + NODE_R + (locked ? 17 : 27));
  }

  function drawPip(x, y, filled) {
    fx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 5 : 2.2;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) fx.moveTo(px, py);
      else fx.lineTo(px, py);
    }
    fx.closePath();
    fx.fillStyle = filled ? STAR_FILL : STAR_EMPTY;
    fx.fill();
  }

  function drawHero(cy) {
    const sx = hero.wx;
    const sy = hero.wy - cy;
    const bob = hero.moving && !REDUCED_MOTION ? Math.sin(hero.bob) * 3 : 0;

    // เงา
    fx.beginPath();
    fx.ellipse(sx, sy + HERO_R - 3, HERO_R * 0.72, HERO_R * 0.26, 0, 0, Math.PI * 2);
    fx.fillStyle = 'rgba(0,0,0,0.28)';
    fx.fill();

    const hh = HERO_R * 2.4;
    const hw = hh * 0.86; // สัดส่วน princess_1.png (272x318) — ไม่บีบให้เพี้ยน
    if (HERO_IMG.complete && HERO_IMG.naturalWidth) {
      fx.save();
      fx.translate(sx, sy + bob);
      fx.scale(hero.facing, 1);
      fx.drawImage(HERO_IMG, -hw / 2, -hh + HERO_R * 0.8, hw, hh);
      fx.restore();
    } else {
      fx.beginPath();
      fx.arc(sx, sy - HERO_R * 0.3 + bob, HERO_R * 0.7, 0, Math.PI * 2);
      fx.fillStyle = '#ffb3d4';
      fx.fill();
    }
  }

  return {
    enter,
    onPick,
    onMove,
    onRelease,
    relayout,
    refresh,
    stop,
  };
}
