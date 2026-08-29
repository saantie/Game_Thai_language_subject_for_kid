// worldMap.js — "แผนที่มนตรา" แทนหน้าเลือกมาตรา (Phase 1–3)
//
// เดินฮีโร่ (เจ้าหญิง) บนแผนที่ป่าเวทมนตร์เลื่อนแนวตั้ง (มาตราแรกล่างสุด เดินขึ้นบน)
// คริสตอล 1 ลูก = 1 มาตรา · แตะ/ลากพื้นให้เดิน · เดิน/แตะคริสตอลปลดล็อก → onPickMatra
//
// Phase 2: ลูกสมุนแม่มดลาดตระเวนเฝ้าคริสตอลเป้าหมาย — ไล่กัดเจ้าหญิงเมื่อเข้าใกล้
//          เจ้าหญิงมีแถบพลัง 5 หัวใจ · โดนกัด -1 · หมด = สลบแล้วฟื้นที่คริสตอลเดิม
//          เจ้าหญิงเหวี่ยงไม้ใส่เอง ตี 3 ครั้งลูกสมุนตาย (+แต้ม)
// Phase 3: biome สี 6 โซนตามกลุ่มสระ · โขดหิน/พุ่ม/ต้นไม้ วาด procedural · แม่มดปลายแผนที่
//          return beat ตอนกลับจากมาตรา (ดาวไหลเข้าคริสตอล → กุญแจลูกถัดไปแตก)
//
// โครงเลียนแบบ src/mahjong.js — วาดบน #fxCanvas ที่ใช้ร่วมกับ game.js/mahjong.js
// ***เจ้าของ canvas ต้องมีตัวเดียวต่อครั้ง*** — main.js เรียก worldMap.stop() ทุกครั้งที่ออก

import { MATRA } from './data/matra.js';
import { isUnlocked, getStars } from './ui/levelSelect.js';
import { createParticleSystem } from './particles.js';
import { saveTotalScore } from './storage.js';

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

// ---- Phase 2: ลูกสมุนเฝ้าคริสตอล + ระบบต่อสู้ ----
// ลูกสมุน "เข้าทีละตัว" — มีตัวเดียวที่ไล่/กัดได้ (active) ที่เหลือลาดตระเวนรอ
// ถูกตี → กระเด็นออก + สะดุด + reengageCd (เดินกลับเข้ามาใหม่ / เปิดทางให้ตัวอื่น)
const MAX_MINIONS = 5;
const PATROL_R = NODE_R + 56;   // รัศมีลาดตระเวนรอบคริสตอล
const MINION_STAGGER = 16;      // เฟรมสะดุดหลังโดนตี (กัดไม่ได้)
const MINION_REENGAGE = 26;     // เฟรมหลังสะดุด ที่ยังไม่กลับมาเป็น active (เดินกลับเข้ามาก่อน)
const MINION_PTS = 3;           // แต้มสะสมต่อการฆ่าลูกสมุน 1 ตัว
const BITE_R = 40;              // ระยะกัด
const BITE_DMG = 1;

const ATTACK_R = 56;            // ระยะที่เจ้าหญิงเหวี่ยงไม้ใส่ลูกสมุน (ใกล้ ๆ ระยะกัด)
const ATTACK_CD = 26;           // เฟรม cooldown ระหว่างเหวี่ยง
const KNOCK = 6.5;              // แรงกระเด็นตอนโดนตี — ทีละตัวแล้วถีบไกลได้
const SWING_T = 12;             // เฟรมโชว์รอยไม้เหวี่ยง

// ความยากตาม index มาตรา (0 = แม่ ก กา ง่ายสุด, 29 = แม่ กด ยากสุด)
function difficultyFor(idx, total) {
  const t = total > 1 ? idx / (total - 1) : 0;
  return {
    guards: idx < 4 ? 1 : idx < 16 ? 2 : 3,      // 1 → 2 → 3 ตัว
    hp: idx < 8 ? 2 : idx < 22 ? 3 : 4,          // ตี 2 → 3 → 4 ครั้ง
    speed: 1.7 + t * 1.5,                        // 1.7 → 3.2 (ฮีโร่ 4 เสมอ)
    aggroR: 96 + t * 80,                         // 96 → 176 (เริ่มไล่เมื่อเด็กเดินเข้าไป)
    biteCd: Math.round(112 - t * 46),            // 112 → 66 เฟรม
  };
}
const HERO_START_GAP = 96; // เจ้าหญิงเริ่มห่างวงลาดตระเวนเท่านี้ (ต้องเดินเข้าไปเอง)

// ---- แถบพลังเจ้าหญิง ----
const HERO_MAX_HP = 5;
const HERO_INVULN = 46;       // เฟรมอมตะหลังโดนกัด (กันโดนรัว)
const FAINT_T = 66;           // เฟรมช่วงสลบก่อนฟื้น

// ---- Phase 3: biome (กลุ่มสระใน matra.js header — const ในไฟล์ ไม่แตะ matra.js) ----
//   0     kaka (โหมโรง)
//   1–9   สระเดี่ยว คู่สั้น-ยาว
//   10–15 สระเดี่ยว (ต่อ)
//   16–18 สระประสม
//   19–21 สระเกิน
//   22–29 มาตราตัวสะกดจริง (ยากสุด — อยู่บนสุดของแผนที่)
const BIOME_STARTS = [0, 1, 10, 16, 19, 22];
const BIOME_GRAD = [
  ['#2c1c50', '#1a0e38'],
  ['#241457', '#160b34'],
  ['#1b2550', '#0f1733'],
  ['#2a1a52', '#160d34'],
  ['#381c48', '#20102e'],
  ['#3c1230', '#210a1c'],
];
const BIOME_BASE = '#140a2c'; // เติมช่องว่างบน/ล่างสุด

// พิกัดวงกลมของ decor/minion — hoist ออกนอก loop (อย่า alloc array ทุกเฟรม)
const BUSH_BLOBS = [[-8, 2], [8, 2], [0, -4], [-3, 4], [4, 5]];
const TREE_BLOBS = [[0, -22, 15], [-9, -12, 11], [9, -12, 11], [0, -34, 10]];

// hash เลขลำดับ → [0,1) แบบ deterministic (ไม่ใช้ Math.random ใน loop/layout)
function h01(n) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15; x = (x * 2246822519) >>> 0; x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

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

  const hero = {
    wx: 0, wy: 0, tx: 0, ty: 0, moving: false, facing: 1, bob: 0,
    attackCd: 0, swingT: 0,
    hp: HERO_MAX_HP, invuln: 0, hurtT: 0, fainting: 0,
  };
  let enterLatch = false; // true = ตัดสินใจเข้าโหนดแล้ว รอ stop() (กันเข้าซ้ำ tap+เดินถึง)

  // Phase 2 — ลูกสมุน (object pool แบบ mahjong/particles)
  let minions = [];
  const minionPool = [];
  let spawnCd = 80;
  let diff = difficultyFor(0, 30); // ความยากของคริสตอลเป้าหมายปัจจุบัน (อัปเดตใน updateMinions)
  // คริสตอลเป้าหมาย "ปิดผนึก" จนกว่าจะกำจัดลูกสมุนที่เฝ้าครบ (keyed by matraId, per session)
  const clearedGuards = Object.create(null); // matraId -> true = เคลียร์แล้ว เปิดเก็บได้
  const guardKills = Object.create(null);    // matraId -> จำนวนลูกสมุนที่ฆ่าในความพยายามนี้
  const guardSpawns = Object.create(null);   // matraId -> จำนวนลูกสมุนที่ปล่อยออกมาแล้ว

  // Phase 3
  let biomeBands = []; // { yLo, yHi, grad }  world-space (cache ต่อ resize)
  let decor = [];      // { wx, wy, type, s, flip }  0=หิน 1=พุ่ม 2=ต้นไม้
  let witchWY = 0;     // world y ของแม่มดปลายแผนที่ (เหนือมาตราสุดท้าย)
  let returnAnim = null; // { idx, from, to, shown, phase:'absorb'|'unlock'|'done', t, nextIdx }

  const unlocked = Object.create(null); // matraId -> bool
  const stars = Object.create(null);    // matraId -> 0..3
  let focusIdx = 0;

  // แตะ/ลาก state
  let pressed = false;
  let pressX = 0;
  let pressY = 0;
  let pressNodeIdx = -1;
  let moved = false;

  let decorDots = [];  // ประกายจาง ๆ พื้นหลัง — คำนวณครั้งเดียวตอน computeLayout (ไม่ alloc ใน loop)
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

    // ประกายพื้นหลัง — สุ่มแบบ deterministic (ไม่ใช้ Math.random ใน loop) ใน band สูง 1 จอ
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

    // biome bands (world space) — 1 แถบต่อกลุ่ม, gradient cache ในตัว band
    biomeBands.length = 0;
    for (let b = 0; b < BIOME_STARTS.length; b++) {
      const si = BIOME_STARTS[b];
      const ei = b + 1 < BIOME_STARTS.length ? BIOME_STARTS[b + 1] - 1 : N - 1;
      // nodes กลับหัว: si มี wy มาก (ล่าง), ei มี wy น้อย (บน)
      const yLo = nodes[ei].wy - spacing * 0.75;
      const yHi = nodes[si].wy + spacing * 0.75;
      const grad = fx.createLinearGradient(0, yLo, 0, yHi);
      grad.addColorStop(0, BIOME_GRAD[b][0]);
      grad.addColorStop(1, BIOME_GRAD[b][1]);
      biomeBands.push({ yLo, yHi, grad });
    }

    // แม่มดอยู่เหนือมาตราสุดท้าย (index N-1 = wy น้อยสุด)
    witchWY = nodes[N - 1].wy - spacing * 0.95;

    // ของประดับ — หิน/พุ่ม/ต้นไม้ กระจาย deterministic (เลี่ยงกลางเส้นทาง)
    decor.length = 0;
    const decorN = Math.max(8, Math.round(worldH / 240));
    for (let i = 0; i < decorN; i++) {
      const r1 = h01(i * 3 + 1);
      const r2 = h01(i * 3 + 2);
      const r3 = h01(i * 3 + 3);
      const side = r1 < 0.5 ? -1 : 1;
      // ออกห่างจากแกนกลาง (เส้นทาง) อย่างน้อย amp*0.55 แล้วสุ่มต่อไปทางขอบ
      let dx = side * (amp * 0.55 + r2 * (W * 0.42));
      const wx = Math.max(20, Math.min(W - 20, midX + dx));
      const wy = ((i + r3) / decorN) * worldH;
      const type = r3 < 0.42 ? 0 : r3 < 0.78 ? 1 : 2;
      decor.push({ wx, wy, type, s: 0.75 + r2 * 0.7, flip: r1 < 0.5 ? -1 : 1 });
    }
  }

  function refresh() {
    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i].matraId;
      unlocked[id] = isUnlocked(app, i);
      stars[id] = getStars(app, id);
    }
    const prevFocus = focusIdx;
    focusIdx = computeFocusIdx();
    if (focusIdx !== prevFocus) {
      // เป้าหมายเปลี่ยน (เช่น admin ล็อกอิน) — ลูกสมุนเฝ้าลูกเก่าไม่ต้องแล้ว
      minions.forEach((m) => minionPool.push(m));
      minions.length = 0;
      spawnCd = 40;
      resetGuardWave();
    }
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

  // เริ่มคลื่นลูกสมุนของคริสตอลเป้าหมายใหม่ (ถ้ายังไม่เคยเคลียร์)
  function resetGuardWave() {
    const fn = nodes[focusIdx];
    if (fn && !clearedGuards[fn.matraId]) {
      guardKills[fn.matraId] = 0;
      guardSpawns[fn.matraId] = 0;
      spawnCd = 60;
    }
  }

  // คริสตอลปิดผนึกอยู่ไหม (ต้องกำจัดลูกสมุนก่อนถึงเก็บได้)
  function nodeSealed(i) {
    if (REDUCED_MOTION) return false;      // โหมดสงบ — ไม่มีลูกสมุน เปิดตลอด
    if (i !== focusIdx) return false;      // มีลูกสมุนเฝ้าเฉพาะคริสตอลเป้าหมาย
    return !clearedGuards[nodes[i].matraId];
  }

  function clampCam(y) {
    return Math.max(0, Math.min(y, Math.max(0, worldH - H)));
  }

  function heroRestY(node) {
    // ยืนใต้คริสตอลนิดหน่อย — ไกลพอที่ arrival check จะไม่ยิงทันทีตอน enter()
    return node.wy + NODE_R + HERO_R + 10;
  }

  // ---------- lifecycle ----------
  // opts?: { focusMatraId, justCompleted:{matraId,stars} }
  function enter(opts) {
    opts = opts || {};
    const jc = opts.justCompleted;
    // snapshot ก่อน refresh — stars/unlocked ยังเป็นค่าจากครั้งก่อนที่อยู่บนแผนที่
    const oldStars = jc ? (stars[jc.matraId] || 0) : 0;
    const prevUnlocked = Object.assign(Object.create(null), unlocked);

    computeLayout();
    refresh();

    minions.forEach((m) => minionPool.push(m));
    minions.length = 0;
    spawnCd = 120;
    returnAnim = null;

    let fi = focusIdx;
    const focusId = opts.focusMatraId || (jc && jc.matraId);
    if (focusId) {
      const k = nodes.findIndex((n) => n.matraId === focusId);
      if (k >= 0) fi = k;
    }
    focusIdx = fi;
    resetGuardWave(); // เข้าแผนที่ทีไร = คลื่นลูกสมุนเต็มใหม่ (ถ้ายังไม่เคยเคลียร์)
    const node = nodes[fi];

    hero.wx = node.wx;
    // เริ่มห่างจากวงลาดตระเวนลงมา — เด็กต้องเดินเข้าไปสู้ลูกสมุนเอง
    hero.wy = nodeSealed(fi)
      ? Math.min(worldH - 20, node.wy + PATROL_R + HERO_START_GAP)
      : heroRestY(node);
    hero.tx = hero.wx;
    hero.ty = hero.wy;
    hero.moving = false;
    hero.facing = 1;
    hero.bob = 0;
    hero.attackCd = 0;
    hero.swingT = 0;
    hero.hp = HERO_MAX_HP; // เข้ามาตราแล้วกลับมา = พลังเต็ม
    hero.invuln = 0;
    hero.hurtT = 0;
    hero.fainting = 0;

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

    // ---- return beat: กลับจากมาตราที่เพิ่งเล่นจบ ----
    if (jc) {
      const newStars = stars[jc.matraId] || 0;
      const nextK = fi + 1; // มาตราถัดไป (array order)
      const nextNew =
        nextK < nodes.length &&
        !prevUnlocked[nodes[nextK].matraId] &&
        !!unlocked[nodes[nextK].matraId];
      if (REDUCED_MOTION) {
        // ไม่มีอนิเมชัน — refresh() อัปเดตดาว/ปลดล็อกให้แล้ว
      } else {
        returnAnim = {
          idx: fi,
          from: oldStars,
          to: newStars,
          shown: oldStars,
          phase: 'absorb',
          t: 0,
          nextIdx: nextNew ? nextK : -1,
        };
        audio.playCorrectChime();
      }
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
    hero.attackCd = 0;
    hero.swingT = 0;
    enterLatch = false;
    camLockIdx = -1;
    pressed = false;
    moved = false;
    pressNodeIdx = -1;
    minions.forEach((m) => minionPool.push(m));
    minions.length = 0;
    spawnCd = 80;
    returnAnim = null;
  }

  function relayout() {
    if (!running) return;
    const keep = nodes[focusIdx] ? nodes[focusIdx].matraId : null;
    minions.forEach((m) => minionPool.push(m));
    minions.length = 0;
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
    returnAnim = null; // แตะ = ข้าม return beat
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
    if (nodeSealed(i)) {
      if (viaTap) {
        audio.sfx('tile_blocked');
        const left = Math.max(0, diff.guards - (guardKills[n.matraId] || 0));
        mapSay('กำจัดลูกสมุนให้หมดก่อนนะ! เหลืออีก ' + left + ' ตัว');
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
      hero.fainting === 0 &&
      particleFx.count === 0 &&
      Math.abs(camTarget - cam.y) < 0.5 &&
      !returnAnim &&
      !anyShake() &&
      !minionsBusy();
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

  // ลูกสมุน "ยุ่ง" = อยู่ในจอ หรือกำลังสะดุด → ต้อง 60fps
  function minionsBusy() {
    const top = cam.y - 70;
    const bot = cam.y + H + 70;
    for (let i = 0; i < minions.length; i++) {
      const m = minions[i];
      if (m.stagger > 0) return true;
      if (m.wy > top && m.wy < bot) return true;
    }
    return false;
  }

  // stroke เส้นทาง — Path2D cache ถ้ารองรับ, ไม่งั้น lineTo loop (path ถูก build ใน render ก่อนเรียก)
  function strokeRoad() {
    if (HAS_PATH2D) fx.stroke(roadPath);
    else fx.stroke();
  }

  function update() {
    // ---- ตัวจับเวลาเจ้าหญิง ----
    if (hero.invuln > 0) hero.invuln--;
    if (hero.hurtT > 0) hero.hurtT--;

    // ---- สลบ (พลังหมด) ----
    if (hero.fainting > 0) {
      hero.fainting--;
      hero.moving = false;
      if (hero.fainting === 0) heroRespawn();
      // ระหว่างสลบ: กล้องสั่น + ไม่รับ input, particle ยังเดิน
      particleFx.update();
      return;
    }

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

    updateMinions();
    updateReturnAnim();
    particleFx.update();
  }

  // ---------- Phase 2: ลูกสมุนเฝ้าคริสตอล + ต่อสู้ ----------
  function updateMinions() {
    diff = difficultyFor(focusIdx, nodes.length); // ความยากตามคริสตอลเป้าหมาย
    if (hero.attackCd > 0) hero.attackCd--;
    if (hero.swingT > 0) hero.swingT--;

    const fnode = nodes[focusIdx];
    const fid = fnode && fnode.matraId;
    const needGuards = fnode && unlocked[fid] && (stars[fid] || 0) < 3 && !clearedGuards[fid];

    // ปล่อยลูกสมุนเฝ้าคริสตอลเป้าหมายจนครบ diff.guards ตัว (ปล่อยครั้งเดียวต่อความพยายาม)
    if (!REDUCED_MOTION && !returnAnim && hero.fainting === 0 && needGuards) {
      const spawned = guardSpawns[fid] || 0;
      if (spawnCd > 0) spawnCd--;
      if (spawnCd <= 0 && spawned < diff.guards && minions.length < MAX_MINIONS) {
        spawnGuard(fnode, spawned);
        guardSpawns[fid] = spawned + 1;
        spawnCd = 34;
      }
    }

    // ---- เลือก "ตัวที่เข้าปะทะ" ทีละตัว ----
    // ตัวที่ active = ตัวเดียวที่ไล่/กัดได้ ที่เหลือลาดตระเวนรอ
    let active = null;
    for (let i = 0; i < minions.length; i++) {
      const m = minions[i];
      if (m.reengageCd > 0) m.reengageCd--;
      if (m.active) {
        const d = Math.hypot(hero.wx - m.wx, hero.wy - m.wy);
        if (m.stagger > 0 || m.reengageCd > 0 || d > diff.aggroR * 1.4 || hero.fainting > 0) m.active = false;
        else active = m;
      }
    }
    if (!active && hero.fainting === 0) {
      let bd = Infinity;
      for (let i = 0; i < minions.length; i++) {
        const m = minions[i];
        if (m.stagger > 0 || m.reengageCd > 0) continue;
        const d = Math.hypot(hero.wx - m.wx, hero.wy - m.wy);
        if (d < diff.aggroR && d < bd) { bd = d; active = m; }
      }
      if (active) active.active = true;
    }

    const cullLo = cam.y - H * 1.4;
    const cullHi = cam.y + H * 2.4;
    for (let i = minions.length - 1; i >= 0; i--) {
      const m = minions[i];
      if (m.biteCd > 0) m.biteCd--;

      const gnode = nodes[m.guardIdx];
      if (!gnode || (stars[gnode.matraId] || 0) >= 3 || m.wy < cullLo || m.wy > cullHi) {
        minionPool.push(m);
        minions.splice(i, 1);
        continue;
      }

      const dhx = hero.wx - m.wx;
      const dhy = hero.wy - m.wy;
      const distHero = Math.hypot(dhx, dhy);

      if (m.stagger > 0) {
        // ถูกตี → กระเด็นออก (แรง) แล้วสะดุด
        m.stagger--;
        m.wx += m.vx;
        m.wy += m.vy;
        m.vx *= 0.88;
        m.vy *= 0.88;
        m.spin += m.spinV;
        if (m.stagger === 0) m.reengageCd = MINION_REENGAGE; // เดินกลับเข้ามาก่อนค่อยปะทะใหม่
      } else if (m === active) {
        // เข้าปะทะ: ไล่ + กัด
        m.spin = 0;
        const d = distHero || 1;
        m.wx += (dhx / d) * diff.speed;
        m.wy += (dhy / d) * diff.speed;
        m.facing = dhx < 0 ? -1 : 1;
        if (distHero < BITE_R && m.biteCd <= 0 && hero.invuln <= 0 && hero.fainting === 0) {
          biteHero(m);
        }
      } else {
        // ลาดตระเวนวนรอบคริสตอล (วงรีแบน) — เดินกลับเข้าวงถ้าอยู่นอก
        m.spin = 0;
        m.patrolA += m.patrolDir * 0.028;
        const tx = gnode.wx + Math.cos(m.patrolA) * PATROL_R;
        const ty = gnode.wy + Math.sin(m.patrolA) * PATROL_R * 0.62;
        m.wx += (tx - m.wx) * 0.11;
        m.wy += (ty - m.wy) * 0.11;
        m.facing = tx < m.wx ? -1 : 1;
      }
      m.bob += 0.12;

      // เจ้าหญิงเหวี่ยงไม้ใส่ลูกสมุน — เฉพาะตัวที่เข้าปะทะ (active) หรือตัวที่ประชิดตัวจริง ๆ
      // (ไม่เหวี่ยงมั่วใส่ตัวที่แค่ลาดตระเวนผ่าน — เด็กต้องเดินเข้าไปสู้เอง)
      if (hero.fainting === 0 && hero.attackCd <= 0 && m.stagger <= 0 &&
          distHero <= ATTACK_R && (m === active || distHero <= BITE_R + 10)) {
        const d = distHero || 1;
        m.hp--;
        m.stagger = MINION_STAGGER;
        m.active = false;
        m.vx = (-dhx / d) * KNOCK;
        m.vy = (-dhy / d) * KNOCK;
        m.spinV = dhx > 0 ? -0.32 : 0.32;
        hero.attackCd = ATTACK_CD;
        hero.swingT = SWING_T;
        hero.facing = dhx < 0 ? -1 : 1;
        particleFx.spawnExplosion(m.wx, m.wy - cam.y);
        audio.sfx('swing');
        if (m.hp <= 0) {
          particleFx.spawnCelebrationBurst(m.wx, m.wy - cam.y, { hueMin: 90, hueRange: 40 });
          audio.sfx('star');
          addPoints(MINION_PTS);
          const gid = gnode.matraId;
          guardKills[gid] = (guardKills[gid] || 0) + 1;
          if (guardKills[gid] >= diff.guards && !clearedGuards[gid]) {
            // เคลียร์ลูกสมุนครบ → คริสตอลเปิด!
            clearedGuards[gid] = true;
            particleFx.spawnCelebrationBurst(gnode.wx, gnode.wy - cam.y, { hueMin: 186, hueRange: 40 });
            audio.sfx('ting');
            mapSay('เปิดแล้ว! เดินไปเก็บคริสตอลได้เลย');
          }
          minionPool.push(m);
          minions.splice(i, 1);
          continue;
        }
      }
    }
  }

  function biteHero(m) {
    hero.hp -= BITE_DMG;
    hero.invuln = HERO_INVULN;
    hero.hurtT = 12;
    m.biteCd = diff.biteCd;
    // ผลักเจ้าหญิงถอย + ยกเลิกเป้าหมายเดิน
    const d = Math.hypot(hero.wx - m.wx, hero.wy - m.wy) || 1;
    hero.wx += ((hero.wx - m.wx) / d) * 11;
    hero.wy += ((hero.wy - m.wy) / d) * 11;
    hero.moving = false;
    hero.tx = hero.wx;
    hero.ty = hero.wy;
    audio.sfx('bite');
    particleFx.spawnExplosion(hero.wx, hero.wy - cam.y);
    if (hero.hp <= 0) {
      hero.hp = 0;
      hero.fainting = FAINT_T;
      hero.hurtT = 0;
      particleFx.spawnExplosion(hero.wx, hero.wy - cam.y);
    }
  }

  function heroRespawn() {
    const node = nodes[focusIdx] || nodes[0];
    // ฟื้นห่างจากวงลาดตระเวนลงมา (ไม่ตกกลางวงลูกสมุน → กันสลบวนไม่จบ)
    hero.wx = node.wx;
    hero.wy = Math.min(worldH - 20, node.wy + PATROL_R + HERO_START_GAP);
    hero.tx = hero.wx;
    hero.ty = hero.wy;
    hero.moving = false;
    hero.hp = HERO_MAX_HP;
    hero.invuln = 150; // ~2.5s อมตะให้ตั้งหลัก
    hero.hurtT = 0;
    // ดันลูกสมุนไปฝั่งตรงข้าม + กลับไปลาดตระเวน + หน่วงนาน
    for (let i = 0; i < minions.length; i++) {
      const m = minions[i];
      m.patrolA += Math.PI; // ย้ายไปครึ่งวงฝั่งตรงข้าม
      m.wx = node.wx + Math.cos(m.patrolA) * PATROL_R;
      m.wy = node.wy + Math.sin(m.patrolA) * PATROL_R * 0.62;
      m.stagger = 0;
      m.active = false;
      m.reengageCd = 90;
      m.biteCd = diff.biteCd;
      m.vx = 0;
      m.vy = 0;
    }
    camTarget = clampCam(node.wy - H / 2);
    mapSay('ล้มแล้ว! พักแป๊บนึงแล้วลองใหม่นะ');
  }

  // +แต้มสะสม (เหมือน mahjong.addScore) — bump ป้ายคะแนนสะสม
  function addPoints(pts) {
    app.totalScore = (app.totalScore || 0) + pts;
    saveTotalScore(app.totalScore);
    if (dom.totalBadgeValue) dom.totalBadgeValue.textContent = app.totalScore;
  }

  // ลูกสมุนเฝ้าคริสตอล gnode — เกิดที่ขอบวงลาดตระเวน
  function spawnGuard(gnode, idx) {
    const m = minionPool.pop() || {};
    const a = (idx / Math.max(1, diff.guards)) * Math.PI * 2 + h01((performance.now() | 0) + idx * 53) * 1.5;
    m.guardIdx = focusIdx;
    m.patrolA = a;
    m.patrolDir = h01((performance.now() | 0) * 3 + idx) < 0.5 ? -1 : 1;
    m.wx = gnode.wx + Math.cos(a) * PATROL_R;
    m.wy = gnode.wy + Math.sin(a) * PATROL_R * 0.62;
    m.vx = 0;
    m.vy = 0;
    m.hp = diff.hp;
    m.maxHp = diff.hp;
    m.stagger = 0;
    m.reengageCd = 0;
    m.active = false;
    m.biteCd = 45;
    m.spin = 0;
    m.spinV = 0;
    m.bob = h01((performance.now() | 0) * 7 + idx) * 6;
    m.facing = 1;
    minions.push(m);
  }

  // ---------- Phase 3: return beat ----------
  function updateReturnAnim() {
    if (!returnAnim) return;
    const ra = returnAnim;
    ra.t++;
    const node = nodes[ra.idx];
    if (ra.phase === 'absorb') {
      // ดาวไหลเข้าคริสตอล + ประกายเป็นระยะ
      const p = Math.min(1, ra.t / 42);
      ra.shown = ra.from + (ra.to - ra.from) * p;
      if (ra.t % 14 === 6) {
        particleFx.spawnCelebrationBurst(node.wx, node.wy - cam.y, { hueMin: 186, hueRange: 40 });
      }
      camTarget = clampCam(node.wy - H / 2);
      if (ra.t >= 46) {
        ra.shown = ra.to;
        if (ra.nextIdx >= 0) { ra.phase = 'unlock'; ra.t = 0; }
        else { ra.phase = 'done'; ra.t = 0; }
      }
    } else if (ra.phase === 'unlock') {
      // แพนไปลูกถัดไป กุญแจแตก
      const nn = nodes[ra.nextIdx];
      camTarget = clampCam(nn.wy - H / 2);
      if (ra.t === 20) {
        particleFx.spawnGlassShards(nn.wx, nn.wy - cam.y, '#c3b4e8');
        audio.sfx('ting');
      }
      if (ra.t >= 44) { ra.phase = 'done'; ra.t = 0; }
    } else {
      // กลับมาที่ลูกที่เพิ่งผ่าน แล้วเลื่อนเป้าหมายไปคริสตอลถัดไป (ที่ยังมีลูกสมุนเฝ้า)
      camTarget = clampCam(node.wy - H / 2);
      if (ra.t >= 26) {
        returnAnim = null;
        const nextFocus = computeFocusIdx();
        if (nextFocus !== focusIdx) {
          focusIdx = nextFocus;
          camLockIdx = focusIdx;
          resetGuardWave();
          // วางฮีโร่ใต้วงลูกสมุนของลูกถัดไป
          const nn = nodes[focusIdx];
          hero.wx = nn.wx;
          hero.wy = nodeSealed(focusIdx)
            ? Math.min(worldH - 20, nn.wy + PATROL_R + HERO_START_GAP)
            : heroRestY(nn);
          hero.tx = hero.wx;
          hero.ty = hero.wy;
        }
      }
    }
  }

  function nearestUnlockedUnderHero() {
    const R = NODE_R + HERO_R * 0.5;
    const r2 = R * R;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!unlocked[n.matraId] || nodeSealed(i)) continue; // ปิดผนึก = เดินทับก็ยังเก็บไม่ได้
      const dx = hero.wx - n.wx;
      const dy = hero.wy - n.wy;
      if (dx * dx + dy * dy <= r2) return i;
    }
    return -1;
  }

  // ---------- render ----------
  function render(now) {
    // กล้องสั่นตอนสลบ
    const cy = cam.y + (hero.fainting > 0 ? Math.sin(now * 0.55) * 4 : 0);
    scene.clearFx();

    // ฐานสีเข้ม เผื่อช่องว่างบน/ล่างสุด
    fx.fillStyle = BIOME_BASE;
    fx.fillRect(0, 0, W, H);

    // ---- world layer: biome / ดาว / แม่มด / ประดับ / เส้นทาง ----
    fx.save();
    fx.translate(0, -cy);

    for (let b = 0; b < biomeBands.length; b++) {
      const band = biomeBands[b];
      if (band.yHi < cy - 20 || band.yLo > cy + H + 20) continue;
      fx.fillStyle = band.grad; // gradient ผูกพิกัด world — ต้องอยู่ใน transform นี้
      fx.fillRect(0, band.yLo, W, band.yHi - band.yLo);
    }

    if (!REDUCED_MOTION) {
      // ประกายจาง — parallax เลื่อนช้ากว่ากล้อง
      fx.fillStyle = 'rgba(150,130,220,0.22)';
      const pOff = cy * 0.45;
      for (let i = 0; i < decorDots.length; i++) {
        const d = decorDots[i];
        const y = cy + (((d.y - pOff) % H) + H) % H; // wrap ในช่วง 1 จอรอบกล้อง
        fx.fillRect(d.x, y, 1.5, 1.5);
      }
    }

    if (witchWY > cy - 160 && witchWY < cy + H + 40) drawWitch();

    for (let i = 0; i < decor.length; i++) {
      const dc = decor[i];
      if (dc.wy < cy - 140 || dc.wy > cy + H + 70) continue;
      drawDecor(dc);
    }

    fx.lineCap = 'round';
    fx.lineJoin = 'round';
    if (!HAS_PATH2D) {
      fx.beginPath();
      fx.moveTo(nodes[0].wx, nodes[0].wy);
      for (let i = 1; i < nodes.length; i++) fx.lineTo(nodes[i].wx, nodes[i].wy);
    }
    fx.strokeStyle = 'rgba(14,6,34,0.9)';
    fx.lineWidth = 26;
    strokeRoad();
    fx.strokeStyle = 'rgba(255,214,130,0.26)';
    fx.lineWidth = 10;
    strokeRoad();
    fx.setLineDash(ROAD_DASH);
    fx.strokeStyle = 'rgba(255,236,184,0.5)';
    fx.lineWidth = 2;
    strokeRoad();
    fx.setLineDash(NO_DASH);

    fx.restore();

    // ---- screen layer: คริสตอล / ลูกสมุน / ฮีโร่ / particle ----
    fx.textAlign = 'center';
    fx.textBaseline = 'alphabetic';
    fx.font = NODE_FONT;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const sy = n.wy - cy;
      if (sy < -80 || sy > H + 80) continue;
      let sx = n.wx;
      if (n.shake > 0) sx += Math.sin(now * 0.05) * 5 * n.shake;
      drawNode(n, sx, sy, i, now);
    }

    for (let i = 0; i < minions.length; i++) drawMinion(minions[i], cy, now);

    drawHero(cy, now);

    particleFx.draw();

    // ---- HUD: แถบพลังเจ้าหญิง (มุมซ้ายบน ใต้ปุ่ม) ----
    if (!REDUCED_MOTION) drawHpBar();
  }

  function drawHpBar() {
    const x0 = 20;
    const y0 = 66;
    for (let i = 0; i < HERO_MAX_HP; i++) {
      const cx = x0 + i * 18;
      const on = i < hero.hp;
      // หัวใจ = 2 วงกลม + สามเหลี่ยม
      fx.fillStyle = on ? '#ff5b7a' : 'rgba(255,255,255,0.16)';
      fx.beginPath();
      fx.arc(cx - 3, y0 - 2, 4, 0, Math.PI * 2);
      fx.arc(cx + 3, y0 - 2, 4, 0, Math.PI * 2);
      fx.fill();
      fx.beginPath();
      fx.moveTo(cx - 6.5, y0);
      fx.lineTo(cx + 6.5, y0);
      fx.lineTo(cx, y0 + 8);
      fx.closePath();
      fx.fill();
      if (on) {
        fx.fillStyle = 'rgba(255,255,255,0.5)';
        fx.beginPath();
        fx.arc(cx - 3, y0 - 3, 1.4, 0, Math.PI * 2);
        fx.fill();
      }
    }
  }

  function drawNode(n, sx, sy, i, now) {
    const locked = !unlocked[n.matraId];
    const sealed = !locked && nodeSealed(i);

    // วงกระเพื่อมที่ลูกปัจจุบัน (เปิดแล้ว = ฟ้าสว่าง, ยังปิดผนึก = โล่ม่วง)
    if (i === focusIdx && !locked) {
      const t = (now % 1400) / 1400;
      fx.beginPath();
      fx.arc(sx, sy, NODE_R + 5 + t * 9, 0, Math.PI * 2);
      fx.strokeStyle = sealed
        ? 'rgba(180,150,240,' + (0.5 * (1 - t)).toFixed(3) + ')'
        : 'rgba(130,230,255,' + (0.6 * (1 - t)).toFixed(3) + ')';
      fx.lineWidth = sealed ? 2 : 3;
      fx.stroke();
    }

    // แสงเรือง
    fx.beginPath();
    fx.arc(sx, sy, NODE_R + 3, 0, Math.PI * 2);
    fx.fillStyle = locked ? 'rgba(58,42,94,0.45)' : 'rgba(120,220,255,0.16)';
    fx.fill();

    // ตัวคริสตอล (คงสัดส่วนภาพ วางกึ่งกลางโหนด) — ปิดผนึก = หรี่ลง
    if (CRYSTAL_IMG.complete && CRYSTAL_IMG.naturalWidth) {
      if (locked) fx.globalAlpha = 0.42;
      else if (sealed) fx.globalAlpha = 0.7;
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
      // ดาว 0–3 (ระหว่าง return beat ใช้ค่าที่กำลังไหล)
      let sc = stars[n.matraId] || 0;
      if (returnAnim && returnAnim.idx === i) sc = returnAnim.shown;
      const py = sy + NODE_R + 11;
      for (let s = 0; s < 3; s++) {
        // เศษ (0..1) ของดาวที่กำลังเติม → ทำให้พองนิดหน่อย
        const fillAmt = Math.max(0, Math.min(1, sc - s));
        drawPip(sx - 14 + s * 14, py, fillAmt);
      }
    }

    // โล่ปิดผนึก + จำนวนลูกสมุนที่เหลือ
    if (sealed) {
      const t = (now % 1600) / 1600;
      fx.beginPath();
      fx.arc(sx, sy, NODE_R + 12 + Math.sin(t * Math.PI * 2) * 2, 0, Math.PI * 2);
      fx.strokeStyle = 'rgba(150,120,235,0.35)';
      fx.lineWidth = 3;
      fx.stroke();
      fx.beginPath();
      fx.arc(sx, sy, NODE_R + 12, 0, Math.PI * 2);
      fx.fillStyle = 'rgba(90,70,170,0.14)';
      fx.fill();
      const left = Math.max(0, diff.guards - (guardKills[n.matraId] || 0));
      fx.fillStyle = '#e7ddff';
      fx.fillText('ลูกสมุนเหลือ ' + left, sx, sy - NODE_R - 12);
    }

    // ชื่อมาตรา (fx.font set แล้วใน render() ก่อนวน loop)
    fx.fillStyle = locked ? 'rgba(203,193,232,0.62)' : '#ece3fb';
    fx.fillText(n.name, sx, sy + NODE_R + (locked ? 17 : 27));
  }

  // amt: 0 = ว่าง, 1 = เต็ม, ระหว่างนั้น = กำลังเติม (พองนิดหน่อย)
  function drawPip(x, y, amt) {
    const grow = amt > 0 && amt < 1 ? 1 + (1 - Math.abs(amt - 0.5) * 2) * 0.5 : 1;
    const outer = 5 * grow;
    const inner = 2.2 * grow;
    fx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) fx.moveTo(px, py);
      else fx.lineTo(px, py);
    }
    fx.closePath();
    fx.fillStyle = amt >= 0.5 ? STAR_FILL : STAR_EMPTY;
    fx.fill();
  }

  function drawHero(cy, now) {
    const sx = hero.wx;
    const sy = hero.wy - cy;
    const fainting = hero.fainting > 0;
    const bob = hero.moving && !fainting && !REDUCED_MOTION ? Math.sin(hero.bob) * 3 : 0;
    // กระพริบตอนอมตะ (โดนกัด) / เอียงตอนสลบ
    const blink = hero.invuln > 0 && ((now / 70) | 0) % 2;
    const faintRot = fainting ? Math.min(1, (FAINT_T - hero.fainting) / 12) * 1.35 : 0;

    // เงา
    fx.beginPath();
    fx.ellipse(sx, sy + HERO_R - 3, HERO_R * 0.72, HERO_R * 0.26, 0, 0, Math.PI * 2);
    fx.fillStyle = 'rgba(0,0,0,0.28)';
    fx.fill();

    const hh = HERO_R * 2.4;
    const hw = hh * 0.86; // สัดส่วน princess_1.png (272x318) — ไม่บีบให้เพี้ยน
    fx.save();
    fx.globalAlpha = blink ? 0.4 : 1;
    if (HERO_IMG.complete && HERO_IMG.naturalWidth) {
      fx.translate(sx, sy + bob);
      fx.rotate(faintRot);
      fx.scale(hero.facing, 1);
      fx.drawImage(HERO_IMG, -hw / 2, -hh + HERO_R * 0.8, hw, hh);
    } else {
      fx.beginPath();
      fx.arc(sx, sy - HERO_R * 0.3 + bob, HERO_R * 0.7, 0, Math.PI * 2);
      fx.fillStyle = '#ffb3d4';
      fx.fill();
    }
    fx.restore();

    // วูบแดงตอนโดนกัด
    if (hero.hurtT > 0) {
      fx.fillStyle = 'rgba(255,60,60,' + (0.32 * (hero.hurtT / 12)).toFixed(2) + ')';
      fx.beginPath();
      fx.arc(sx, sy - HERO_R * 0.4, HERO_R * 1.1, 0, Math.PI * 2);
      fx.fill();
    }

    // รอยไม้กายสิทธิ์เหวี่ยง (ตอนตีลูกสมุน)
    if (hero.swingT > 0) {
      const p = hero.swingT / SWING_T; // 1 → 0
      const a0 = -0.5 + (1 - p) * 1.9;
      fx.save();
      fx.translate(sx + hero.facing * HERO_R * 0.5, sy - HERO_R * 0.4);
      fx.rotate(hero.facing * a0);
      fx.strokeStyle = 'rgba(255,240,180,' + (0.5 * p + 0.25).toFixed(2) + ')';
      fx.lineWidth = 3;
      fx.lineCap = 'round';
      fx.beginPath();
      fx.arc(0, 0, HERO_R * 0.95, -0.7, 0.7);
      fx.stroke();
      fx.restore();
    }
  }

  // ---------- Phase 2/3 draw helpers ----------
  function drawMinion(m, cy, now) {
    const sx = m.wx;
    const sy = m.wy - cy;
    const staggered = m.stagger > 0;
    fx.save();
    fx.translate(sx, sy);
    if (staggered) fx.rotate(m.spin);
    else fx.translate(0, Math.sin(m.bob) * 2);
    fx.scale(m.facing || 1, 1);
    // เงา
    fx.fillStyle = 'rgba(0,0,0,0.22)';
    fx.beginPath();
    fx.ellipse(0, 11, 9, 3, 0, 0, Math.PI * 2);
    fx.fill();
    // หมวก
    fx.fillStyle = '#4a2f6b';
    fx.beginPath();
    fx.moveTo(0, -16);
    fx.lineTo(-8, -3);
    fx.lineTo(8, -3);
    fx.closePath();
    fx.fill();
    // ตัว (แดงวูบตอนโดนตี)
    fx.fillStyle = staggered && ((now / 60) | 0) % 2 ? '#ffb0b0' : '#86c97f';
    fx.beginPath();
    fx.arc(0, 1, 8.5, 0, Math.PI * 2);
    fx.fill();
    fx.fillStyle = '#a9dda2';
    fx.beginPath();
    fx.arc(0, 2.5, 4.2, 0, Math.PI * 2);
    fx.fill();
    // ตา
    fx.fillStyle = '#1c0f34';
    fx.beginPath();
    fx.arc(-3, -1, 1.4, 0, Math.PI * 2);
    fx.arc(3, -1, 1.4, 0, Math.PI * 2);
    fx.fill();
    // ปาก (กัด) — โผล่ตอนเข้าปะทะ + biteCd เกือบพร้อม
    if (!staggered && m.active && m.biteCd < 26) {
      fx.fillStyle = '#3a1520';
      fx.beginPath();
      fx.arc(0, 5, 2.6, 0, Math.PI);
      fx.fill();
    }
    fx.restore();

    // แถบเลือดลูกสมุน (เฉพาะตอนโดนตีไปแล้ว)
    const mx = m.maxHp || 3;
    if (m.hp < mx) {
      const bw = 20;
      fx.fillStyle = 'rgba(0,0,0,0.45)';
      fx.fillRect(sx - bw / 2, sy - 22, bw, 3);
      fx.fillStyle = '#7bd06a';
      fx.fillRect(sx - bw / 2, sy - 22, bw * (m.hp / mx), 3);
    }
  }

  function drawDecor(dc) {
    const s = dc.s;
    fx.save();
    fx.translate(dc.wx, dc.wy);
    fx.scale(dc.flip * s, s);
    if (dc.type === 0) {
      // โขดหิน
      fx.fillStyle = '#241640';
      fx.beginPath();
      fx.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2);
      fx.fill();
      fx.fillStyle = '#33224f';
      fx.beginPath();
      fx.ellipse(-4, -4, 9, 7, 0, 0, Math.PI * 2);
      fx.fill();
      fx.fillStyle = 'rgba(120,100,170,0.28)';
      fx.beginPath();
      fx.ellipse(-5, -6, 4, 2.5, 0, 0, Math.PI * 2);
      fx.fill();
    } else if (dc.type === 1) {
      // พุ่มไม้
      fx.fillStyle = '#16302a';
      for (let k = 0; k < BUSH_BLOBS.length; k++) {
        fx.beginPath();
        fx.arc(BUSH_BLOBS[k][0], BUSH_BLOBS[k][1], 8, 0, Math.PI * 2);
        fx.fill();
      }
      fx.fillStyle = 'rgba(90,170,140,0.22)';
      fx.beginPath();
      fx.arc(-2, -5, 4, 0, Math.PI * 2);
      fx.fill();
    } else {
      // ต้นไม้
      fx.fillStyle = '#1c1330';
      fx.fillRect(-3, -2, 6, 20);
      fx.fillStyle = '#122a20';
      for (let k = 0; k < TREE_BLOBS.length; k++) {
        fx.beginPath();
        fx.arc(TREE_BLOBS[k][0], TREE_BLOBS[k][1], TREE_BLOBS[k][2], 0, Math.PI * 2);
        fx.fill();
      }
      fx.fillStyle = 'rgba(90,180,150,0.18)';
      fx.beginPath();
      fx.arc(-4, -26, 5, 0, Math.PI * 2);
      fx.fill();
    }
    fx.restore();
  }

  function drawWitch() {
    const wx = W / 2;
    const wy = witchWY;
    // ลำแสงจาง ๆ ลงมา
    fx.fillStyle = 'rgba(150,120,220,0.05)';
    fx.beginPath();
    fx.moveTo(wx - 14, wy + 8);
    fx.lineTo(wx - 70, wy + 260);
    fx.lineTo(wx + 70, wy + 260);
    fx.lineTo(wx + 14, wy + 8);
    fx.closePath();
    fx.fill();
    // แท่นลอย
    fx.fillStyle = '#221040';
    fx.beginPath();
    fx.ellipse(wx, wy + 20, 46, 10, 0, 0, Math.PI * 2);
    fx.fill();
    // ตัวแม่มด
    fx.fillStyle = '#574789';
    fx.beginPath();
    fx.moveTo(wx, wy - 6);
    fx.lineTo(wx - 16, wy + 20);
    fx.lineTo(wx + 16, wy + 20);
    fx.closePath();
    fx.fill();
    fx.fillStyle = '#d7c4ee';
    fx.beginPath();
    fx.arc(wx, wy - 12, 7, 0, Math.PI * 2);
    fx.fill();
    fx.fillStyle = '#241041';
    fx.beginPath();
    fx.moveTo(wx, wy - 38);
    fx.lineTo(wx - 16, wy - 12);
    fx.lineTo(wx + 16, wy - 12);
    fx.closePath();
    fx.fill();
    fx.beginPath();
    fx.ellipse(wx, wy - 12, 20, 4, 0, 0, Math.PI * 2);
    fx.fill();
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
