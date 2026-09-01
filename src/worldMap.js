// worldMap.js — "แผนที่มนตรา" แทนหน้าเลือกมาตรา (Phase 1–3)
//
// เดินฮีโร่ (แม่มดน้อย) บนแผนที่ป่าเวทมนตร์เลื่อนแนวตั้ง (มาตราแรกล่างสุด เดินขึ้นบน)
// คริสตอล 1 ลูก = 1 มาตรา · แตะ/ลากพื้นให้เดิน · เดิน/แตะคริสตอลปลดล็อก → onPickMatra
//
// Phase 2: ลูกสมุนแม่มดลาดตระเวนเฝ้าคริสตอลเป้าหมาย — ไล่กัดแม่มดน้อยเมื่อเข้าใกล้
//          แม่มดน้อยมีแถบพลัง 5 หัวใจ · โดนกัด -1 · หมด = สลบแล้วฟื้นที่คริสตอลเดิม
//          แม่มดน้อยเหวี่ยงไม้ใส่เอง ตี 3 ครั้งลูกสมุนตาย (+แต้ม)
// Phase 3: biome สี 6 โซนตามกลุ่มสระ · โขดหิน/พุ่ม/ต้นไม้ วาด procedural · แม่มดปลายแผนที่
//          return beat ตอนกลับจากมาตรา (ดาวไหลเข้าคริสตอล → กุญแจลูกถัดไปแตก)
//
// โครงเลียนแบบ src/mahjong.js — วาดบน #fxCanvas ที่ใช้ร่วมกับ game.js/mahjong.js
// ***เจ้าของ canvas ต้องมีตัวเดียวต่อครั้ง*** — main.js เรียก worldMap.stop() ทุกครั้งที่ออก

import { MATRA } from './data/matra.js';
import { isUnlocked, getStars } from './ui/levelSelect.js';
import { createParticleSystem } from './particles.js';
import { saveTotalScore } from './storage.js';
import { getSkillEffects } from './rpg.js';

// asset ที่มีอยู่แล้วใน APP_SHELL — encode ช่องว่างเหมือนที่อื่นในโปรเจกต์
const CRYSTAL_IMG = new Image();
CRYSTAL_IMG.src = 'public/assets/images/glass%20ball.png';
const HERO_IMG = new Image();
HERO_IMG.src = 'public/assets/images/witch.png'; // แม่มดน้อย = ตัวที่เด็กบังคับ
// (แม่มดแก่ปลายแผนที่ = MAP_WITCH_IMG คนละตัว — คนละหน้าตา ไม่สับสน)
// แม่มดปลายแผนที่ — ถ้าไฟล์ยังไม่มี ใช้รูปทรงวาดเองแทน (drawWitch)
const MAP_WITCH_IMG = new Image();
MAP_WITCH_IMG.src = 'public/assets/images/map%20witch.png';

const REDUCED_MOTION =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- ปรับจูน ----
const NODE_R = 30;        // รัศมีคริสตอล (วาด + hit test)
const HERO_R = 26;        // ครึ่งความสูงฮีโร่โดยประมาณ (เงา/ระยะถึงโหนด)
// ความเร็วเดิน / cooldown ตี / พลังหัวใจ / เวลาอมตะ — มาจากสกิล (rpg.js) ผ่านตัวแปร sk
//   ***ห้ามประกาศค่าฐานซ้ำที่นี่*** ค่าเดียวกันอยู่ 2 ที่แล้วแก้ที่เดียว = เพี้ยนแน่นอน
//   แหล่งเดียวคือ rpg.js SKILLS[*].levels[0]
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

// ---- Phase 2: ลูกสมุน + บอส เฝ้าคริสตอล ----
// ศัตรู "เข้าทีละตัว" — มีตัวเดียวที่ไล่/กัดได้ (active) ที่เหลือลาดตระเวนรอ
// ถูกตี → กระเด็นออก + สะดุด + reengageCd (เดินกลับเข้ามาใหม่ / เปิดทางให้ตัวอื่น)
// ศัตรูของแต่ละมาตรา "หมดได้" — ฆ่าแล้วไม่เกิดใหม่ (clearedGuards/guardKills per matraId)
const MAX_MINIONS = 6;
const MINION_HP = 2;           // ลูกสมุนปกติ ตี 2 ครั้งตาย
const BOSS_HP = 4;             // บอส (มาตรา 5+) ตี 4 ครั้งตาย
// โซนที่ลูกสมุนเดินเตร่ = วงรีกว้างรอบคริสตอล — กระจายห่างกัน ไม่กระจุกที่ลูกแก้ว
// แนวนอนกว้าง (จอมีที่เหลือถึงขอบ) แต่แนวตั้งต้องไม่ถึงคริสตอลลูกข้างเคียง (spacing/2 ≈ 177)
const SCATTER_RX = 176;
const SCATTER_RY = 150;
const WANDER_SPEED = 0.5;        // px/เฟรม — เดินเตร่ช้า ๆ

// ---- พลอยเติมพลัง (เดินทับ = +1 หัวใจ) ----
const GEM_PICK_R = 26;           // รัศมีเก็บพลอย
const GEM_RESPAWN = 720;         // เฟรมก่อนพลอยเกิดใหม่ (~12 วิ) — เก็บซ้ำได้แต่ไม่รัว
// โซนสุ่มตำแหน่งพลอยรอบคริสตอล (วงรี) — แนวตั้งต้องไม่เกินครึ่งระยะห่างคริสตอล
// ไม่งั้นพลอยของลูกนี้ไปโผล่ในโซนลูกข้างเคียง
const GEM_PER_NODE = 2;          // จำนวนพลอยต่อคริสตอล (คงเดิม — งบฮีลไม่เปลี่ยน)
const GEM_RX = 200;
const GEM_RY = 150;
const GEM_MIN_F = 0.45;          // ใกล้สุด 45% ของรัศมี — ไม่ให้ทับตัวคริสตอล
const MINION_STAGGER = 16;     // เฟรมสะดุดหลังโดนตี (กัดไม่ได้)
const MINION_REENGAGE = 26;    // เฟรมหลังสะดุด ที่ยังไม่กลับมาเป็น active
const MINION_PTS = 3;          // แต้มต่อลูกสมุน 1 ตัว
const BOSS_PTS = 12;           // แต้มต่อบอส 1 ตัว
const BITE_R = 40;             // ระยะกัด
const BITE_DMG = 1;

const ATTACK_R = 56;           // ระยะที่แม่มดน้อยเหวี่ยงไม้ใส่ศัตรู
const KNOCK = 6.5;             // แรงกระเด็นตอนโดนตี (บอสโดนถีบครึ่งเดียว)
const SWING_T = 12;            // เฟรมโชว์รอยไม้เหวี่ยง

// จำนวน/ความยากศัตรูตาม index มาตรา
//   มาตรา 1 (idx0) = 2 ตัว · เพิ่มมาตราละ 1 ถึง 5 ตัว · มาตรา 5 (idx4) เป็นต้นไป + บอส 1 ตัว
function difficultyFor(idx, total) {
  const t = total > 1 ? idx / (total - 1) : 0;
  return {
    minions: Math.min(2 + idx, 5),  // 2,3,4,5,5,5,...
    boss: idx >= 4,                 // มาตรา 5 เป็นต้นไป
    speed: 1.15 + t * 0.95,         // 1.15 → 2.1 (ต่ำกว่าความเร็วเดินต่ำสุดของสกิล 👟 = 2.6 เสมอ)
    aggroR: 120 + t * 90,           // 120 → 210 (ลูกสมุนกระจายไกล — ต้องเห็นเด็กไกลขึ้น)
    biteCd: Math.round(112 - t * 46), // 112 → 66 เฟรม
  };
}
function enemyTotal(d) { return d.minions + (d.boss ? 1 : 0); }
const HERO_START_GAP = 64; // แม่มดน้อยเริ่มห่างจากขอบโซนลูกสมุนเท่านี้ (ต้องเดินเข้าไปเอง)

// ---- แถบพลังแม่มดน้อย ----
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
  let worldW = 0;      // โลกกว้างกว่าจอ → กล้องแพนแนวนอนตามคริสตอล/ฮีโร่
  let nodeSpacing = 190; // ระยะห่างแนวตั้งระหว่างคริสตอล (คำนวณใน computeLayout)

  // ค่าจากสกิล (rpg.js) — อ่านใหม่ทุกครั้งที่ enter() เพราะเด็กอัปสกิลแล้วกลับมาแผนที่ได้
  // ห้ามอ่านครั้งเดียวตอนสร้างโมดูล ไม่งั้นสกิลที่เพิ่งอัปจะไม่มีผลจนกว่าจะรีโหลดแอป
  let sk = getSkillEffects();

  const cam = { x: 0, y: 0 };
  let camTargetX = 0;
  let camTargetY = 0;
  let camLockIdx = -1; // >=0 = กล้องล็อกที่โหนดนี้จนกว่าจะแตะพื้นครั้งแรก

  const hero = {
    wx: 0, wy: 0, tx: 0, ty: 0, moving: false, facing: 1, bob: 0,
    attackCd: 0, swingT: 0,
    hp: sk.maxHp, invuln: 0, hurtT: 0, fainting: 0,
    atk: null, // ลูกสมุนที่เด็ก "กดสั่งตี" — แม่มดน้อยไม่ตีอัตโนมัติ ตีเฉพาะตัวนี้
  };
  let enterLatch = false; // true = ตัดสินใจเข้าโหนดแล้ว รอ stop() (กันเข้าซ้ำ tap+เดินถึง)

  let gems = [];          // { wx, wy, taken, respawn, bob } — เดินทับ = +1 หัวใจ
  let walkCeilY = 0;      // เดินขึ้นเหนือ y นี้ไม่ได้ (เกินลูกที่ล็อกได้แค่ 2 ลูก)
  let lastUnlockedIdx = 0;

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
  let witchWX = 0;     // world x ของแม่มด (เหนือมาตราสุดท้าย)
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

  // สุ่มตำแหน่งพลอยรอบคริสตอล — แต่ละเม็ดสุ่มใน "ช่อง" ของตัวเอง (แบ่งวงตาม GEM_PER_NODE)
  // สุ่มจริงแต่ไม่ทับกันเอง · ใช้ Math.random ไม่ใช่ h01 เพราะพลอยเป็นของ gameplay ที่
  // เปลี่ยนตำแหน่งได้ (แนวเดียวกับ pickWanderTarget) ต่างจากของประดับที่ต้องอยู่นิ่ง
  function placeGem(g, node) {
    const ang = ((g.slot + Math.random()) / GEM_PER_NODE) * Math.PI * 2;
    const f = GEM_MIN_F + Math.random() * (1 - GEM_MIN_F);
    g.wx = Math.max(22, Math.min(worldW - 22, node.wx + Math.cos(ang) * GEM_RX * f));
    g.wy = node.wy + Math.sin(ang) * GEM_RY * f;
    g.bob = Math.random() * 6;
  }

  // ---------- layout ----------
  function computeLayout() {
    W = scene.W;
    H = scene.H;
    const N = MATRA.length;
    // สวิงกว้างกว่าจอ → กล้องแพนแนวนอนตามคริสตอลเป้าหมายให้อยู่กลางจอได้
    const amp = Math.max(70, W * 0.42);
    const midX = W / 2 + amp;          // กึ่งกลางโลก (เผื่อสวิงซ้าย-ขวาเท่า ๆ กัน)
    worldW = W + amp * 2;              // คริสตอลสุดขอบ → cam.x ∈ [0, worldW - W]
    const pad = H * 0.55;
    const spacing = Math.max(190, H * 0.42);
    nodeSpacing = spacing;
    worldH = pad + spacing * (N - 1) + pad;

    nodes = MATRA.map((m, i) => ({
      matraId: m.id,
      name: m.name,
      idx: i,
      // เส้นทางคดเคี้ยวด้วย sine — กล้องแพนตามให้คริสตอลอยู่กลางจอ
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
    witchWX = nodes[N - 1].wx;

    // ของประดับ — หิน/พุ่ม/ต้นไม้ กระจาย deterministic (เลี่ยงกลางเส้นทาง)
    decor.length = 0;
    const decorN = Math.max(8, Math.round(worldH / 220));
    for (let i = 0; i < decorN; i++) {
      const r1 = h01(i * 3 + 1);
      const r2 = h01(i * 3 + 2);
      const r3 = h01(i * 3 + 3);
      const side = r1 < 0.5 ? -1 : 1;
      // ออกห่างจากแกนกลาง (เส้นทาง) อย่างน้อย amp*0.55 แล้วสุ่มต่อไปทางขอบโลก
      const dx = side * (amp * 0.55 + r2 * (worldW * 0.32));
      const wx = Math.max(20, Math.min(worldW - 20, midX + dx));
      const wy = ((i + r3) / decorN) * worldH;
      const type = r3 < 0.42 ? 0 : r3 < 0.78 ? 1 : 2;
      decor.push({ wx, wy, type, s: 0.75 + r2 * 0.7, flip: r1 < 0.5 ? -1 : 1 });
    }

    // พลอยเติมพลัง — 2 เม็ดต่อคริสตอล (ซ้าย-ขวาล่าง ในโซนที่เด็กสู้) ตำแหน่งตายตัว
    gems.length = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let k = 0; k < GEM_PER_NODE; k++) {
        const g = { nodeIdx: i, slot: k, wx: 0, wy: 0, taken: false, respawn: 0, bob: 0 };
        placeGem(g, nodes[i]);
        gems.push(g);
      }
    }
  }

  function refresh() {
    lastUnlockedIdx = 0;
    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i].matraId;
      unlocked[id] = isUnlocked(app, i);
      stars[id] = getStars(app, id);
      if (unlocked[id]) lastUnlockedIdx = i;
    }
    // เดินขึ้นได้เกินคริสตอลที่ปลดล็อกไปอีกแค่ 2 ลูก (ลูกที่ล็อก)
    const ceilIdx = Math.min(nodes.length - 1, lastUnlockedIdx + 2);
    walkCeilY = nodes[ceilIdx].wy - NODE_R - 20;
    const prevFocus = focusIdx;
    focusIdx = computeFocusIdx();
    if (focusIdx !== prevFocus) {
      // เป้าหมายเปลี่ยน (เช่น admin ล็อกอิน) — ลูกสมุนเฝ้าลูกเก่าไม่ต้องแล้ว
      minions.forEach((m) => minionPool.push(m));
      minions.length = 0;
      hero.atk = null;
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

  // ตั้งจังหวะปล่อยศัตรูของคริสตอลเป้าหมาย
  //   ***ไม่รีเซ็ต guardKills*** — ศัตรูที่ฆ่าไปแล้วตายถาวรทั้ง session (ศัตรูมีจำนวนจำกัด)
  //   แค่ทำให้ตัวนับมีค่าเริ่ม + หน่วงก่อนตัวแรกโผล่
  function resetGuardWave() {
    const fn = nodes[focusIdx];
    if (!fn) return;
    if (guardKills[fn.matraId] == null) guardKills[fn.matraId] = 0;
    if (guardSpawns[fn.matraId] == null) guardSpawns[fn.matraId] = 0;
    spawnCd = 60;
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
  function clampCamX(x) {
    return Math.max(0, Math.min(x, Math.max(0, worldW - W)));
  }
  // world → screen (หัก cam ออก) — ใช้ตอน spawn particle ที่วาดในพิกัดจอ
  function sX(wx) { return wx - cam.x; }
  function sY(wy) { return wy - cam.y; }

  function heroRestY(node) {
    // ยืนใต้คริสตอลนิดหน่อย — ไกลพอที่ arrival check จะไม่ยิงทันทีตอน enter()
    return node.wy + NODE_R + HERO_R + 10;
  }
  // จุดเริ่มของแม่มดน้อยตอนคริสตอลยังผนึก — ใต้โซนลูกสมุน แต่ไม่เลยไปทับคริสตอลลูกถัดไป
  function heroSealedStartY(node) {
    const want = node.wy + SCATTER_RY + HERO_START_GAP;
    const cap = node.wy + nodeSpacing * 0.6; // กันไปยืนทับคริสตอลลูกล่าง
    return Math.min(worldH - 20, want, cap);
  }

  // ---------- lifecycle ----------
  // opts?: { focusMatraId, justCompleted:{matraId,stars} }
  function enter(opts) {
    opts = opts || {};
    const jc = opts.justCompleted;
    // snapshot ก่อน refresh — stars/unlocked ยังเป็นค่าจากครั้งก่อนที่อยู่บนแผนที่
    const oldStars = jc ? (stars[jc.matraId] || 0) : 0;
    const prevUnlocked = Object.assign(Object.create(null), unlocked);

    sk = getSkillEffects(); // อัปสกิลแล้วกลับมา → มีผลทันที
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
    resetGuardWave(); // ศัตรูที่เหลือ = enemyTotal - ที่ฆ่าไปแล้ว (ไม่เกิดใหม่)
    const node = nodes[fi];

    hero.wx = node.wx;
    // เริ่มห่างจากโซนลูกสมุนลงมา — เด็กต้องเดินเข้าไปสู้เอง
    hero.wy = nodeSealed(fi) ? heroSealedStartY(node) : heroRestY(node);
    hero.tx = hero.wx;
    hero.ty = hero.wy;
    hero.moving = false;
    hero.facing = 1;
    hero.bob = 0;
    hero.attackCd = 0;
    hero.swingT = 0;
    hero.hp = sk.maxHp; // เข้ามาตราแล้วกลับมา = พลังเต็ม (ตามสกิล ❤️)
    hero.invuln = 0;
    hero.hurtT = 0;
    hero.fainting = 0;
    hero.atk = null;
    for (let i = 0; i < gems.length; i++) { gems[i].taken = false; gems[i].respawn = 0; }

    cam.x = clampCamX(node.wx - W / 2);
    cam.y = clampCam(node.wy - H / 2);
    camTargetX = cam.x;
    camTargetY = cam.y;
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
    hero.atk = null;
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
    hero.atk = null;
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
      cam.x = clampCamX(node.wx - W / 2);
      cam.y = clampCam(node.wy - H / 2);
      camTargetX = cam.x;
      camTargetY = cam.y;
      camLockIdx = focusIdx;
      enterLatch = false;
    }
  }

  // ---------- input ----------
  function toWorld(x, y) {
    return { wx: x + cam.x, wy: y + cam.y };
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
  // ลูกสมุนที่นิ้วเด็กแตะโดน (รัศมีเผื่อไว้กว้าง — นิ้วเด็กพลาดง่าย) — ตัวใกล้สุดชนะ
  function minionAt(wx, wy) {
    const R = 34;
    let best = null;
    let bd = R * R;
    for (let i = 0; i < minions.length; i++) {
      const m = minions[i];
      const hit = m.isBoss ? R + 10 : R;
      const dx = wx - m.wx;
      const dy = wy - m.wy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= hit * hit && d2 < bd) { bd = d2; best = m; }
    }
    return best;
  }

  // จำกัดเป้าเดินไม่ให้เกินเพดาน/ขอบโลก (กัน hero.moving ค้างเพราะไปไม่ถึงเป้า)
  function clampTarget(wx, wy) {
    hero.tx = Math.max(22, Math.min(worldW - 22, wx));
    hero.ty = Math.max(walkCeilY, Math.min(worldH - 18, wy));
  }

  function onPick(x, y) {
    if (!running) return;
    returnAnim = null; // แตะ = ข้าม return beat
    pressed = true;
    moved = false;
    pressX = x;
    pressY = y;
    const w = toWorld(x, y);

    // กดโดนลูกสมุน → สั่งให้แม่มดน้อยไปตีตัวนั้น (ไม่ตีอัตโนมัติ)
    const m = minionAt(w.wx, w.wy);
    if (m) {
      hero.atk = m;
      pressNodeIdx = -1;
      clampTarget(m.wx, m.wy);
      hero.moving = true;
      camLockIdx = -1;
      return;
    }

    // กดพื้น/คริสตอล → เดิน (+ เลิกสั่งตี)
    hero.atk = null;
    pressNodeIdx = nodeAt(w.wx, w.wy);
    clampTarget(w.wx, w.wy);
    hero.moving = true;
    camLockIdx = -1; // แตะพื้นครั้งแรก → กล้องเลิกล็อกโหนด ตามฮีโร่แทน
  }

  function onMove(x, y) {
    if (!running || !pressed) return;
    if (Math.hypot(x - pressX, y - pressY) > TAP_SLOP) {
      moved = true;
      hero.atk = null; // ลากจอ = บังคับเดินเอง เลิกสั่งตี
    }
    const w = toWorld(x, y);
    clampTarget(w.wx, w.wy);
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
        const tot = enemyTotal(difficultyFor(i, nodes.length));
        const left = Math.max(0, tot - (guardKills[n.matraId] || 0));
        mapSay('กำจัดศัตรูให้หมดก่อนนะ! เหลืออีก ' + left + ' ตัว');
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
      Math.abs(camTargetY - cam.y) < 0.5 &&
      Math.abs(camTargetX - cam.x) < 0.5 &&
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
    // ---- ตัวจับเวลาแม่มดน้อย ----
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

    // ---- ตามลูกสมุนที่กดสั่งตี ----
    if (hero.atk) {
      if (minions.indexOf(hero.atk) < 0 || hero.atk.hp <= 0) {
        hero.atk = null;
      } else {
        const adx = hero.atk.wx - hero.wx;
        const ady = hero.atk.wy - hero.wy;
        if (Math.hypot(adx, ady) > ATTACK_R * 0.75) {
          clampTarget(hero.atk.wx, hero.atk.wy); // เดินเข้าไปหา
          hero.moving = true;
        } else {
          hero.moving = false; // ประชิดแล้ว — ยืนตี (ตีจริงใน updateMinions)
        }
      }
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
        const step = Math.min(d, sk.heroSpeed); // สกิล 👟
        hero.wx += (dx / d) * step;
        hero.wy += (dy / d) * step;
        if (Math.abs(dx) > 0.8) hero.facing = dx < 0 ? -1 : 1;
        hero.bob += 0.28;
      }
      hero.wx = Math.max(22, Math.min(worldW - 22, hero.wx));
      // เดินขึ้นเกินลูกที่ล็อกได้แค่ 2 ลูก (walkCeilY คำนวณใน refresh)
      hero.wy = Math.max(walkCeilY, Math.min(worldH - 18, hero.wy));
    }

    // ---- เก็บพลอยเติมหัวใจ ----
    updateGems();

    // ---- กล้อง (แพนทั้งแนวตั้ง + แนวนอน) ----
    if (camLockIdx >= 0 && nodes[camLockIdx]) {
      camTargetX = clampCamX(nodes[camLockIdx].wx - W / 2);
      camTargetY = clampCam(nodes[camLockIdx].wy - H / 2);
    } else {
      camTargetX = clampCamX(hero.wx - W / 2);
      camTargetY = clampCam(hero.wy - H / 2);
    }
    const camLerp = REDUCED_MOTION ? 1 : CAM_LERP;
    cam.x += (camTargetX - cam.x) * camLerp;
    cam.y += (camTargetY - cam.y) * camLerp;
    if (Math.abs(camTargetX - cam.x) < 0.3) cam.x = camTargetX;
    if (Math.abs(camTargetY - cam.y) < 0.3) cam.y = camTargetY;

    // ---- เดินถึงคริสตอลที่ปลดล็อก → เก็บ ---- (ไม่เก็บระหว่างกำลังสั่งตีลูกสมุน)
    if (!enterLatch && !pressed && !hero.atk) {
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

    // ปล่อยศัตรูทีละตัว — ลูกสมุนปกติก่อนจนหมด แล้วบอส 1 ตัว (idx>=4)
    //   ศัตรูมีจำนวนจำกัด: จำนวนที่ยังต้องเจอ = diff.minions - ที่ฆ่าไปแล้ว (+ บอสถ้ามี)
    if (!REDUCED_MOTION && !returnAnim && hero.fainting === 0 && needGuards) {
      const killed = guardKills[fid] || 0;
      const normalsKilled = Math.min(killed, diff.minions);
      let normalsAlive = 0;
      let bossAlive = false;
      for (let k = 0; k < minions.length; k++) {
        if (minions[k].isBoss) bossAlive = true;
        else normalsAlive++;
      }
      if (spawnCd > 0) spawnCd--;
      if (spawnCd <= 0 && minions.length < MAX_MINIONS) {
        if (normalsKilled + normalsAlive < diff.minions) {
          spawnGuard(fnode, guardSpawns[fid] || 0, false);
          guardSpawns[fid] = (guardSpawns[fid] || 0) + 1;
          spawnCd = 34;
        } else if (diff.boss && normalsKilled >= diff.minions && !bossAlive && killed < diff.minions + 1) {
          spawnGuard(fnode, guardSpawns[fid] || 0, true);
          guardSpawns[fid] = (guardSpawns[fid] || 0) + 1;
          spawnCd = 44;
        }
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
        if (hero.atk === m) hero.atk = null;
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
        // เดินเตร่ช้า ๆ กระจายอยู่ใกล้ ๆ คริสตอล (ไม่วนเป็นวง) — สุ่มจุดใหม่เป็นระยะ
        m.spin = 0;
        m.wanderT--;
        if (m.wanderT <= 0) pickWanderTarget(m, gnode);
        const wdx = m.wanderX - m.wx;
        const wdy = m.wanderY - m.wy;
        const wd = Math.hypot(wdx, wdy);
        if (wd > 3) {
          const step = Math.min(wd, WANDER_SPEED);
          m.wx += (wdx / wd) * step;
          m.wy += (wdy / wd) * step;
          if (Math.abs(wdx) > 0.3) m.facing = wdx < 0 ? -1 : 1;
        }
        // ถ้าถึงจุดก่อนหมดเวลา = ยืนแช่ (idle bob) จนกว่า wanderT จะหมดแล้วสุ่มใหม่
      }
      m.bob += 0.12;

      // แม่มดน้อยเหวี่ยงไม้ใส่ศัตรู — ***เฉพาะตัวที่เด็กกดสั่งตี (hero.atk)*** ไม่ตีอัตโนมัติ
      if (m === hero.atk && hero.fainting === 0 && hero.attackCd <= 0 &&
          m.stagger <= 0 && distHero <= ATTACK_R) {
        const d = distHero || 1;
        const knock = m.isBoss ? KNOCK * 0.5 : KNOCK; // บอสหนัก ถีบไม่ค่อยไป
        m.hp--;
        m.stagger = MINION_STAGGER;
        m.active = false;
        m.vx = (-dhx / d) * knock;
        m.vy = (-dhy / d) * knock;
        m.spinV = dhx > 0 ? -0.32 : 0.32;
        hero.attackCd = sk.attackCd; // สกิล ⚔️ — ยิ่งอัปยิ่งตีถี่
        hero.swingT = SWING_T;
        hero.facing = dhx < 0 ? -1 : 1;
        particleFx.spawnExplosion(sX(m.wx), sY(m.wy));
        audio.sfx('swing');
        audio.sfx('minion_cry'); // เสียงร้องลูกสมุนโดนตี
        if (m.isBoss && m.hp > 0) mapSay('ตีบอสอีก ' + m.hp + ' ครั้ง!');
        if (m.hp <= 0) {
          const gid = gnode.matraId;
          particleFx.spawnCelebrationBurst(sX(m.wx), sY(m.wy), {
            hueMin: m.isBoss ? 280 : 90, hueRange: 40,
          });
          audio.sfx('star');
          addPoints(m.isBoss ? BOSS_PTS : MINION_PTS);
          guardKills[gid] = (guardKills[gid] || 0) + 1;
          if (guardKills[gid] >= enemyTotal(diff) && !clearedGuards[gid]) {
            // เคลียร์ศัตรูครบ (ลูกสมุน + บอส) → คริสตอลเปิด!
            clearedGuards[gid] = true;
            particleFx.spawnCelebrationBurst(sX(gnode.wx), sY(gnode.wy), { hueMin: 186, hueRange: 40 });
            audio.sfx('ting');
            mapSay('เปิดแล้ว! เดินไปเก็บคริสตอลได้เลย');
          } else if (diff.boss && guardKills[gid] === diff.minions) {
            mapSay('บอสมาแล้ว! ระวังตัวนะ');
          }
          if (hero.atk === m) hero.atk = null; // ตัวที่สั่งตีตายแล้ว
          minionPool.push(m);
          minions.splice(i, 1);
          continue;
        }
      }
    }
  }

  function biteHero(m) {
    hero.hp -= BITE_DMG;
    hero.invuln = sk.invuln; // สกิล 🛡️
    hero.hurtT = 12;
    m.biteCd = diff.biteCd;
    // ผลักแม่มดน้อยถอย + ยกเลิกเป้าหมายเดิน
    const d = Math.hypot(hero.wx - m.wx, hero.wy - m.wy) || 1;
    hero.wx += ((hero.wx - m.wx) / d) * 11;
    hero.wy += ((hero.wy - m.wy) / d) * 11;
    hero.moving = false;
    hero.tx = hero.wx;
    hero.ty = hero.wy;
    audio.sfx('bite');
    audio.sfx('hero_cry'); // เสียงร้องแม่มดน้อยโดนกัด
    particleFx.spawnExplosion(sX(hero.wx), sY(hero.wy));
    if (hero.hp <= 0) {
      hero.hp = 0;
      hero.fainting = FAINT_T;
      hero.hurtT = 0;
      hero.atk = null;
      addPoints(-100); // ตาย = เหรียญสะสมลด 100 (clamp ≥ 0 ใน addPoints)
      mapSay('ล้มแล้ว! เสียเหรียญ 100');
      particleFx.spawnExplosion(sX(hero.wx), sY(hero.wy));
    }
  }

  function heroRespawn() {
    const node = nodes[focusIdx] || nodes[0];
    // ฟื้นห่างจากโซนลูกสมุนลงมา (ไม่ตกกลางวง → กันสลบวนไม่จบ)
    hero.wx = node.wx;
    hero.wy = heroSealedStartY(node);
    hero.tx = hero.wx;
    hero.ty = hero.wy;
    hero.moving = false;
    hero.hp = sk.maxHp;
    hero.invuln = 150; // ~2.5s อมตะให้ตั้งหลัก
    hero.hurtT = 0;
    // ดึงลูกสมุนกลับเข้าโซนบ้านของตัวเอง เอนขึ้นบน (พ้นจากฮีโร่ที่ฟื้นด้านล่าง) + หน่วงนาน
    for (let i = 0; i < minions.length; i++) {
      const m = minions[i];
      const f = 0.6 + Math.random() * 0.4;
      m.wx = node.wx + Math.cos(m.homeA) * SCATTER_RX * f;
      m.wy = node.wy + Math.sin(m.homeA) * SCATTER_RY * f - 30; // เอนขึ้นบน หนีฮีโร่
      m.wanderX = m.wx;
      m.wanderY = m.wy;
      m.wanderT = 60;
      m.stagger = 0;
      m.active = false;
      m.reengageCd = 90;
      m.biteCd = diff.biteCd;
      m.vx = 0;
      m.vy = 0;
    }
    camTargetX = clampCamX(node.wx - W / 2);
    camTargetY = clampCam(node.wy - H / 2);
    mapSay('ตั้งหลักใหม่ ระวังมากขึ้นนะ');
  }

  // +แต้มสะสม (เหมือน mahjong.addScore) — bump ป้ายคะแนนสะสม
  //   clamp ≥ 0 — ตอนตายหักเหรียญ 100 แล้วห้ามติดลบ
  function addPoints(pts) {
    app.totalScore = Math.max(0, (app.totalScore || 0) + pts);
    saveTotalScore(app.totalScore);
    if (dom.totalBadgeValue) dom.totalBadgeValue.textContent = app.totalScore;
  }

  // เก็บพลอย = +1 หัวใจ (ตอนพลังไม่เต็มเท่านั้น) · เก็บแล้วเกิดใหม่ใน GEM_RESPAWN เฟรม
  function updateGems() {
    const canHeal = hero.hp < sk.maxHp && hero.fainting === 0;
    const pr2 = GEM_PICK_R * GEM_PICK_R;
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (g.taken) {
        // เกิดใหม่ = สุ่มที่ใหม่ ไม่โผล่จุดเดิม (เดิมเด็กจำตำแหน่งได้ ไม่ต้องสำรวจ)
        if (--g.respawn <= 0) { g.taken = false; placeGem(g, nodes[g.nodeIdx]); }
        continue;
      }
      if (!canHeal) continue;
      if (Math.abs(g.wy - hero.wy) > 160) continue; // เช็คเฉพาะเม็ดใกล้ตัว
      const dx = g.wx - hero.wx;
      const dy = g.wy - hero.wy;
      if (dx * dx + dy * dy <= pr2) {
        g.taken = true;
        g.respawn = GEM_RESPAWN;
        hero.hp = Math.min(sk.maxHp, hero.hp + 1);
        audio.sfx('gem');
        particleFx.spawnCelebrationBurst(sX(g.wx), sY(g.wy), { hueMin: 315, hueRange: 30 });
        break; // เก็บทีละเม็ดต่อเฟรม
      }
    }
  }

  // เลือกจุดเดินเตร่ใหม่ — แต่ละตัวมี "โซนบ้าน" (m.homeA) ของตัวเอง กระจายห่างกันรอบคริสตอล
  // เตร่อยู่ในโซนตัวเอง + ระยะไม่น้อยกว่า ~ครึ่งวง (ไม่มุดกลับมากอดลูกแก้ว)
  function pickWanderTarget(m, gnode) {
    const ang = m.homeA + (Math.random() - 0.5) * 0.8;    // เตร่ในโซนตัวเอง ~±23° (ไม่ล้ำช่องล่าง)
    const f = 0.55 + Math.random() * 0.45;                 // 0.55–1.0 ของรัศมีวงรี
    m.wanderX = gnode.wx + Math.cos(ang) * SCATTER_RX * f;
    m.wanderY = gnode.wy + Math.sin(ang) * SCATTER_RY * f;
    m.wanderT = 90 + (Math.random() * 130 | 0);            // เดิน/ยืนแช่ ~2–3.7 วิ
  }

  // ศัตรูเฝ้าคริสตอล gnode — แต่ละตัวได้ "โซนบ้าน" กระจายเท่า ๆ กันรอบคริสตอล
  //   เว้นช่องล่างตรง ๆ (ทางที่เด็กเดินขึ้นมา) ไว้ — ลูกสมุนเฝ้าด้านข้าง+ด้านบน+เฉียงล่าง
  //   เด็กเดินขึ้นทางกลางได้โดยไม่โดนรุมทันที แต่ต้องกวาดให้ครบทุกตัวคริสตอลถึงเปิด
  function spawnGuard(gnode, idx, isBoss) {
    const m = minionPool.pop() || {};
    const total = Math.max(1, enemyTotal(diff));
    const GAP = 1.15;                       // ครึ่งความกว้างช่องล่างที่เว้นไว้ (rad ~66°)
    const arc = Math.PI * 2 - GAP * 2;      // ส่วนโค้งที่กระจายลูกสมุน (~228°)
    const slot = idx % total;
    m.homeA = Math.PI / 2 + GAP + ((slot + 0.5) / total) * arc; // π/2 = ทิศลง (หา่งเด็ก)
    const f = 0.6 + h01(idx * 7 + 3) * 0.4;
    m.guardIdx = focusIdx;
    m.isBoss = !!isBoss;
    m.wx = gnode.wx + Math.cos(m.homeA) * SCATTER_RX * f;
    m.wy = gnode.wy + Math.sin(m.homeA) * SCATTER_RY * f;
    m.wanderX = m.wx;
    m.wanderY = m.wy;
    m.wanderT = 20 + idx * 8; // เหลื่อมกันเล็กน้อยตอนเพิ่งเกิด
    m.vx = 0;
    m.vy = 0;
    m.hp = isBoss ? BOSS_HP : MINION_HP;
    m.maxHp = m.hp;
    m.stagger = 0;
    m.reengageCd = 0;
    m.active = false;
    m.biteCd = isBoss ? 30 : 45;
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
        particleFx.spawnCelebrationBurst(sX(node.wx), sY(node.wy), { hueMin: 186, hueRange: 40 });
      }
      camTargetX = clampCamX(node.wx - W / 2);
      camTargetY = clampCam(node.wy - H / 2);
      if (ra.t >= 46) {
        ra.shown = ra.to;
        if (ra.nextIdx >= 0) { ra.phase = 'unlock'; ra.t = 0; }
        else { ra.phase = 'done'; ra.t = 0; }
      }
    } else if (ra.phase === 'unlock') {
      // แพนไปลูกถัดไป กุญแจแตก
      const nn = nodes[ra.nextIdx];
      camTargetX = clampCamX(nn.wx - W / 2);
      camTargetY = clampCam(nn.wy - H / 2);
      if (ra.t === 20) {
        particleFx.spawnGlassShards(sX(nn.wx), sY(nn.wy), '#c3b4e8');
        audio.sfx('ting');
      }
      if (ra.t >= 44) { ra.phase = 'done'; ra.t = 0; }
    } else {
      // กลับมาที่ลูกที่เพิ่งผ่าน แล้วเลื่อนเป้าหมายไปคริสตอลถัดไป (ที่ยังมีลูกสมุนเฝ้า)
      camTargetX = clampCamX(node.wx - W / 2);
      camTargetY = clampCam(node.wy - H / 2);
      if (ra.t >= 26) {
        returnAnim = null;
        const nextFocus = computeFocusIdx();
        if (nextFocus !== focusIdx) {
          focusIdx = nextFocus;
          camLockIdx = focusIdx;
          resetGuardWave();
          // วางฮีโร่ใต้โซนลูกสมุนของลูกถัดไป
          const nn = nodes[focusIdx];
          hero.wx = nn.wx;
          hero.wy = nodeSealed(focusIdx) ? heroSealedStartY(nn) : heroRestY(nn);
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
    const shake = hero.fainting > 0 ? Math.sin(now * 0.55) * 4 : 0;
    const cx = cam.x + shake;
    const cy = cam.y + shake;
    scene.clearFx();

    // ฐานสีเข้ม เผื่อช่องว่างบน/ล่างสุด
    fx.fillStyle = BIOME_BASE;
    fx.fillRect(0, 0, W, H);

    // ---- world layer: biome / ดาว / แม่มด / ประดับ / เส้นทาง ----
    fx.save();
    fx.translate(-cx, -cy);

    for (let b = 0; b < biomeBands.length; b++) {
      const band = biomeBands[b];
      if (band.yHi < cy - 20 || band.yLo > cy + H + 20) continue;
      fx.fillStyle = band.grad; // gradient ผูกพิกัด world — ต้องอยู่ใน transform นี้
      fx.fillRect(0, band.yLo, worldW, band.yHi - band.yLo);
    }

    if (!REDUCED_MOTION) {
      // ประกายจาง — parallax เลื่อนช้ากว่ากล้อง (wrap เป็น tile ขนาดจอตามกล้อง)
      fx.fillStyle = 'rgba(150,130,220,0.22)';
      const pX = cx * 0.5;
      const pY = cy * 0.5;
      for (let i = 0; i < decorDots.length; i++) {
        const d = decorDots[i];
        const x = cx + (((d.x - pX) % W) + W) % W;
        const y = cy + (((d.y - pY) % H) + H) % H;
        fx.fillRect(x, y, 1.5, 1.5);
      }
    }

    if (witchWY > cy - 340 && witchWY < cy + H + 60) drawWitch();

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
      let sx = n.wx - cx;
      if (sx < -120 || sx > W + 120) continue;
      if (n.shake > 0) sx += Math.sin(now * 0.05) * 5 * n.shake;
      drawNode(n, sx, sy, i, now);
    }

    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (g.taken) continue;
      const gsy = g.wy - cy;
      if (gsy < -40 || gsy > H + 40) continue;
      const gsx = g.wx - cx;
      if (gsx < -40 || gsx > W + 40) continue;
      drawGem(gsx, gsy, g.bob, now);
    }

    for (let i = 0; i < minions.length; i++) drawMinion(minions[i], cx, cy, now);

    drawHero(cx, cy, now);

    particleFx.draw();

    // ---- HUD: แถบพลังแม่มดน้อย (มุมซ้ายบน ใต้ปุ่ม) ----
    if (!REDUCED_MOTION) drawHpBar();
  }

  function drawHpBar() {
    const x0 = 20;
    const y0 = 66;
    // แผ่นรองจาง ๆ — กันหัวใจจมกับคริสตอล/ของประดับที่อาจเลื่อนมาอยู่หลังมุมนี้
    const bx = x0 - 12;
    const bw = (sk.maxHp - 1) * 18 + 26;
    fx.fillStyle = 'rgba(18,10,38,0.5)';
    fx.beginPath();
    if (fx.roundRect) fx.roundRect(bx, y0 - 14, bw, 26, 12);
    else fx.rect(bx, y0 - 14, bw, 26);
    fx.fill();
    for (let i = 0; i < sk.maxHp; i++) {
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
      const left = Math.max(0, enemyTotal(diff) - (guardKills[n.matraId] || 0));
      fx.fillStyle = '#e7ddff';
      fx.fillText('ศัตรูเหลือ ' + left, sx, sy - NODE_R - 12);
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

  function drawHero(cx, cy, now) {
    const sx = hero.wx - cx;
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
    // สัดส่วนอ่านจากขนาดจริงของไฟล์ ไม่ฮาร์ดโค้ด — เปลี่ยนรูปตัวละครแล้วไม่บีบเพี้ยน
    // (เคยฮาร์ดโค้ด 0.86 ของ princess_1.png ไว้ พอเปลี่ยนเป็นแม่มดน้อยก็ผิดทันที)
    const hw = HERO_IMG.naturalHeight
      ? hh * (HERO_IMG.naturalWidth / HERO_IMG.naturalHeight)
      : hh * 0.8;
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
  function drawMinion(m, cx, cy, now) {
    const sx = m.wx - cx;
    const sy = m.wy - cy;
    const staggered = m.stagger > 0;
    const bs = m.isBoss ? 1.65 : 1; // บอสตัวใหญ่กว่า
    fx.save();
    fx.translate(sx, sy);
    if (staggered) fx.rotate(m.spin);
    else fx.translate(0, Math.sin(m.bob) * 2);
    fx.scale((m.facing || 1) * bs, bs);
    // เงา
    fx.fillStyle = 'rgba(0,0,0,0.22)';
    fx.beginPath();
    fx.ellipse(0, 11, 9, 3, 0, 0, Math.PI * 2);
    fx.fill();
    // หมวก
    fx.fillStyle = m.isBoss ? '#6a1f4a' : '#4a2f6b';
    fx.beginPath();
    fx.moveTo(0, -16);
    fx.lineTo(-8, -3);
    fx.lineTo(8, -3);
    fx.closePath();
    fx.fill();
    // มงกุฎทองของบอส
    if (m.isBoss) {
      fx.fillStyle = '#ffd86b';
      fx.beginPath();
      fx.moveTo(-9, -2);
      fx.lineTo(-9, -11);
      fx.lineTo(-4.5, -6);
      fx.lineTo(0, -14);
      fx.lineTo(4.5, -6);
      fx.lineTo(9, -11);
      fx.lineTo(9, -2);
      fx.closePath();
      fx.fill();
    }
    // ตัว (แดงวูบตอนโดนตี)
    fx.fillStyle = staggered && ((now / 60) | 0) % 2
      ? '#ffb0b0'
      : (m.isBoss ? '#c97fb0' : '#86c97f');
    fx.beginPath();
    fx.arc(0, 1, 8.5, 0, Math.PI * 2);
    fx.fill();
    fx.fillStyle = m.isBoss ? '#e6b3de' : '#a9dda2';
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

    // แถบเลือด — บอสโชว์ตลอด, ลูกสมุนโชว์เมื่อโดนตีไปแล้ว
    const mx = m.maxHp || 2;
    if (m.isBoss || m.hp < mx) {
      const bw = m.isBoss ? 34 : 20;
      const by = sy - (m.isBoss ? 30 : 22);
      fx.fillStyle = 'rgba(0,0,0,0.45)';
      fx.fillRect(sx - bw / 2, by, bw, m.isBoss ? 4 : 3);
      fx.fillStyle = m.isBoss ? '#ff7ac0' : '#7bd06a';
      fx.fillRect(sx - bw / 2, by, bw * Math.max(0, m.hp / mx), m.isBoss ? 4 : 3);
    }
  }

  // พลอยเติมพลัง — เพชรชมพูลอยเด้ง (สีต่างจากคริสตอลฟ้า / ดาวเหลือง / ลูกสมุนเขียว)
  function drawGem(sx, sy0, phase, now) {
    const sy = sy0 - 3 - Math.sin(now * 0.004 + phase) * 3;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.006 + phase);
    fx.beginPath();
    fx.arc(sx, sy, 10 + pulse * 2, 0, Math.PI * 2);
    fx.fillStyle = 'rgba(255,120,205,0.16)';
    fx.fill();
    fx.save();
    fx.translate(sx, sy);
    fx.rotate(Math.PI / 4);
    fx.fillStyle = '#ff7ecb';
    fx.fillRect(-5, -5, 10, 10);
    fx.fillStyle = '#ffd0ee';
    fx.fillRect(-4.5, -4.5, 4, 4);
    fx.restore();
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
    const wx = witchWX;
    const wy = witchWY;

    // รูปแม่มดจริง (public/assets/images/map witch.png) — ถ้ายังไม่มีไฟล์ ตกไปวาดเอง
    if (MAP_WITCH_IMG.complete && MAP_WITCH_IMG.naturalWidth) {
      const iw = MAP_WITCH_IMG.naturalWidth;
      const ih = MAP_WITCH_IMG.naturalHeight;
      const dh = Math.min(260, H * 0.42);
      const dw = dh * (iw / ih);
      const topY = wy - dh * 0.32; // เผยตัวเหนือมาตราสุดท้าย
      // ลำแสง/เงามนตราแผ่ลงมา
      fx.fillStyle = 'rgba(150,120,220,0.06)';
      fx.beginPath();
      fx.moveTo(wx - dw * 0.16, topY + dh * 0.5);
      fx.lineTo(wx - dw * 0.75, topY + dh + 220);
      fx.lineTo(wx + dw * 0.75, topY + dh + 220);
      fx.lineTo(wx + dw * 0.16, topY + dh * 0.5);
      fx.closePath();
      fx.fill();
      fx.drawImage(MAP_WITCH_IMG, wx - dw / 2, topY, dw, dh);
      return;
    }

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

  return { enter, onPick, onMove, onRelease, relayout, refresh, stop };
}
