// worldMap.js — "แผนที่มนตรา" แทนหน้าเลือกมาตรา (Phase 1–3)
//
// เดินฮีโร่ (แม่มดน้อย) บนแผนที่ป่าเวทมนตร์เลื่อนแนวตั้ง (มาตราแรกล่างสุด เดินขึ้นบน)
// คริสตอล 1 ลูก = 1 มาตรา · แตะ/ลากพื้นให้เดิน · เดิน/แตะคริสตอลปลดล็อก → onPickMatra
//
// Phase 2: ลูกสมุนแม่มดลาดตระเวนเฝ้าคริสตอลเป้าหมาย — ไล่กัดแม่มดน้อยเมื่อเข้าใกล้
//          แม่มดน้อยมีแถบพลัง 5 หัวใจ · โดนกัด -1 · หมด = สลบแล้วฟื้นที่คริสตอลเดิม
//          แม่มดน้อยเหวี่ยงไม้ใส่เอง ตี 3 ครั้งลูกสมุนตาย (+แต้ม)
// Phase 3: พื้นหญ้า+ถนนดินเลื้อย · โขดหิน/พุ่ม วาดเอง · ต้นไม้เป็นรูปภาพ (tree.png) สุ่มสองข้างทาง
//          return beat ตอนกลับจากมาตรา (ดาวไหลเข้าคริสตอล → กุญแจลูกถัดไปแตก)
//
// โครงเลียนแบบ src/mahjong.js — วาดบน #fxCanvas ที่ใช้ร่วมกับ game.js/mahjong.js
// ***เจ้าของ canvas ต้องมีตัวเดียวต่อครั้ง*** — main.js เรียก worldMap.stop() ทุกครั้งที่ออก

import { MATRA } from './data/matra.js';
import { isUnlocked, getStars } from './ui/levelSelect.js';
import { createParticleSystem } from './particles.js';
import { saveTotalScore } from './storage.js';
import { getSkillEffects } from './rpg.js';

// จุดมาตราบนแผนที่ = บ้านแม่มด (House wish.png) แทนลูกแก้วคริสตอลเดิม
const HOUSE_IMG = new Image();
HOUSE_IMG.src = 'public/assets/images/House%20wish.png';
// แม่มดน้อย (ตัวที่เด็กบังคับ) — 3 ท่า สลับตาม state ที่มีอยู่แล้วของ hero
// GIF เคลื่อนไหวในตัว: ยืน 21 เฟรม / เดิน 4 เฟรม / ต่อสู้ 8 เฟรม (เฟรมละ 200ms)
// สัดส่วนแต่ละไฟล์ต่างกัน (64x103 / 95x100 / 106x97) — drawHero คิดความกว้างจากเฟรมที่ใช้จริง
//
// ***ทำไมต้อง decode GIF เอง***: browser หยุดเดินเฟรม GIF ของ <img> ที่ไม่ได้ถูกวาดจริงบนจอ
// — เราย่อ element เหลือ 2px + opacity 0.01 + z-index -1 ไม่ให้เกะกะ ผลคือบนมือถือจริง GIF นิ่งสนิท
// (เครื่องทดสอบดูเหมือนได้เพราะ pane ไม่ยิง rAF เลย เทสไม่เจอ — พลาดมาแล้วใน v188)
// ImageDecoder แตกเฟรมเองในหน่วยความจำ แล้วเล่นตามนาฬิกาเกม (now) — คุมเฟรม 100%, เทสได้จริง
// ไม่มี ImageDecoder (Safari < 17.4) → ถอยไปใช้ <img> ใน DOM เหมือนเดิม (ท่าถูก อาจไม่ขยับ = ไม่แย่ลง)
function makeHeroGif(src, fallbackId) {
  const g = {
    frames: [], durs: [], total: 0, ready: false,
    fallback: (typeof document !== 'undefined' && document.getElementById(fallbackId)) || null,
  };
  if (typeof ImageDecoder === 'function') {
    fetch(src)
      .then((r) => r.arrayBuffer())
      .then(async (buf) => {
        const dec = new ImageDecoder({ data: buf, type: 'image/gif' });
        await dec.tracks.ready;
        const track = dec.tracks.selectedTrack;
        const n = (track && track.frameCount) || 1;
        for (let i = 0; i < n; i++) {
          const { image } = await dec.decode({ frameIndex: i });
          g.frames.push(await createImageBitmap(image)); // เฟรมประกอบเสร็จแล้ว (browser จัดการ disposal)
          // µs → ms; GIF delay 0/สั้นมาก → กันเล่นเร็วเวอร์ด้วยขั้นต่ำ 40ms/เฟรม
          g.durs.push(Math.max(40, (image.duration || 0) / 1000 || 100));
          image.close();
        }
        g.total = g.durs.reduce((a, b) => a + b, 0) || 1;
        g.ready = g.frames.length > 0;
        dec.close();
      })
      .catch(() => { /* เงียบ — ใช้ fallback <img> */ });
  }
  return g;
}
const HERO_GIFS = {
  stand: makeHeroGif('public/assets/images/wish%20standing%2030.gif', 'heroStandImg'),
  walk:  makeHeroGif('public/assets/images/wish%20walk%2030.gif',     'heroWalkImg'),
  atk:   makeHeroGif('public/assets/images/wish%20attact%2030.gif',   'heroAtkImg'),
};
// ภาพที่วาดได้ดีที่สุดของท่านี้ ณ เวลา t: เฟรม ImageBitmap ถ้าพร้อม, ไม่งั้น <img> fallback, ไม่งั้น null
function heroPoseImg(g, t) {
  if (g.ready) {
    if (REDUCED_MOTION) return g.frames[0];
    let r = t % g.total;
    for (let i = 0; i < g.frames.length; i++) {
      r -= g.durs[i];
      if (r < 0) return g.frames[i];
    }
    return g.frames[g.frames.length - 1];
  }
  const fb = g.fallback;
  return fb && fb.complete && fb.naturalWidth ? fb : null;
}
const HERO_POSE_ATK_T = 22;  // เฟรมที่ค้างท่าต่อสู้ — ยาวกว่า SWING_T (12) เพราะ 0.2 วิ
                             // สั้นเกินกว่าจะทันเห็นท่า (แยกจากเวลาวาดรอยไม้เหวี่ยง)
// (แม่มดแก่ปลายแผนที่ = MAP_WITCH_IMG คนละตัว — คนละหน้าตา ไม่สับสน)
// แม่มดปลายแผนที่ — ถ้าไฟล์ยังไม่มี ใช้รูปทรงวาดเองแทน (drawWitch)
const MAP_WITCH_IMG = new Image();
MAP_WITCH_IMG.src = 'public/assets/images/Evil%20wish/0-1.gif';

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
const HAS_PATH2D = typeof Path2D === 'function';
// ถนนดิน — วาดเป็นริบบิ้น (polygon) ขอบไม่สม่ำเสมอ ความกว้างสุ่มตามระยะ
const ROAD_HW = 16;        // ครึ่งความกว้างฐาน (px)
const ROAD_HW_VAR = 8;     // แกว่ง ± จากฐาน — บางที่กว้าง บางที่แคบ

// House wish.png = 500x500 ตัวบ้าน ~440x390 กลางภาพ ขอบโปร่ง
// วาดทั้งภาพ scale ให้ "ตัวบ้าน" สูง ≈ 96px, เยื้องขึ้นเล็กน้อยให้ฐานบ้านอยู่ราวจุดโหนด
const HOUSE_DW = 128;
const HOUSE_DH = 128;
const HOUSE_NUDGE_Y = -12;
// รัศมีวงประดับรอบโหนด (แสงเรือง/วงโฟกัส/โล่ผนึก) — บ้านใหญ่กว่า NODE_R ที่ใช้ทำ hit-test
const NODE_HALO = 46;

// ---- Phase 2: ลูกสมุน + บอส เฝ้าคริสตอล ----
// ศัตรู "เข้าทีละตัว" — มีตัวเดียวที่ไล่/กัดได้ (active) ที่เหลือไหลลง/รอ
// ถูกตี → กระเด็นออก + สะดุด + reengageCd (เดินกลับเข้ามาใหม่ / เปิดทางให้ตัวอื่น)
// ศัตรูไหลลงมาจากข้างบนไม่มีหมด · guardKills คุมจังหวะบอสมาเฝ้ากุญแจ
const MAX_MINIONS = 6;
const BOSS_HP = 4;             // บอส (มาตรา 5+) ตี 4 ครั้งตาย

// ---- สายพันธุ์ลูกสมุน — แหล่งความจริงเดียวของสี/พลัง/ความเร็ว/บิน ----
// เพิ่มสายพันธุ์ใหม่ = เพิ่มแถวที่นี่พอ ไม่ต้องแตะโค้ดวาด (drawMinion อ่าน m.kind หมด)
//   speed = ตัวคูณความเร็วไล่ ***ห้ามทำให้เร็วเกินเด็ก*** — มี clamp ตอนรันอีกชั้นกันพลาด
//   hp    = ต้องตีกี่ครั้งถึงตาย (ไม่กระทบจำนวนตัวที่ต้องฆ่าเพื่อเปิดคริสตอล — นับเป็นตัว)
// 12 สายพันธุ์ — ค่อย ๆ ปรากฏตามความยาก (kindsFor). speed หลังหาร 50% แล้ว (ดู difficultyFor)
const MINION_KINDS = [
  { id: 'green',   body: '#86c97f', light: '#a9dda2', hat: '#4a2f6b', wing: null,      hp: 2, speed: 1.00, fly: false },
  { id: 'blue',    body: '#7fb8e8', light: '#b3d9f5', hat: '#2a3f6b', wing: null,      hp: 2, speed: 1.10, fly: false },
  { id: 'orange',  body: '#e8a05c', light: '#f5cfa3', hat: '#6b3f1f', wing: null,      hp: 3, speed: 0.85, fly: false },
  { id: 'bat',     body: '#b98be0', light: '#dcc4f2', hat: '#3b1f5e', wing: '#6f4a9e', hp: 1, speed: 1.20, fly: true  },
  { id: 'red',     body: '#e07b6b', light: '#f2b4a9', hat: '#5e1f1f', wing: null,      hp: 3, speed: 1.05, fly: false },
  { id: 'teal',    body: '#5ec9b8', light: '#a7e6dd', hat: '#1f4a44', wing: null,      hp: 3, speed: 1.15, fly: false },
  { id: 'moth',    body: '#d9c17a', light: '#f0e3b8', hat: '#5a4a1f', wing: '#b89a4a', hp: 2, speed: 1.15, fly: true  },
  { id: 'stone',   body: '#9a9a92', light: '#c4c4bb', hat: '#3a3a34', wing: null,      hp: 4, speed: 0.75, fly: false },
  { id: 'violet',  body: '#a77fd8', light: '#d0b8ee', hat: '#3a1f5e', wing: null,      hp: 4, speed: 1.10, fly: false },
  { id: 'wasp',    body: '#e8c24a', light: '#f5e2a0', hat: '#5e3f0f', wing: '#c99a2a', hp: 2, speed: 1.25, fly: true  },
  { id: 'crimson', body: '#c0506b', light: '#e6a0b0', hat: '#4a1020', wing: null,      hp: 5, speed: 1.00, fly: false },
  { id: 'spectre', body: '#8bb0d8', light: '#c4dcee', hat: '#22344a', wing: '#5a7a9e', hp: 3, speed: 1.30, fly: true  },
];
// บอสเป็น kind หนึ่งเหมือนกัน — drawMinion จะได้อ่านสีจากที่เดียว ไม่ต้อง if isBoss ทุกจุด
const BOSS_KIND = { id: 'boss', body: '#c97fb0', light: '#e6b3de', hat: '#6a1f4a', wing: null, hp: BOSS_HP, speed: 0.90, fly: false };

// สายพันธุ์ที่โผล่ได้ตาม index มาตรา — มาตราแรกมีสายพันธุ์เดียว ค่อย ๆ เพิ่มจนครบ 12 ที่มาตราสุดท้าย
function kindsFor(idx) {
  const N = MATRA.length;
  const n = Math.max(1, Math.min(MINION_KINDS.length, 1 + Math.floor((idx / Math.max(1, N - 1)) * (MINION_KINDS.length - 1))));
  return MINION_KINDS.slice(0, n);
}
const FLY_HOVER = 13;          // ตัวบินลอยเหนือพื้นกี่ px (เงายังอยู่ที่พื้น)
const FLY_WANDER_MUL = 1.4;    // ตัวบินเดินเตร่เร็วกว่าตัวเดิน
// โซนที่ลูกสมุนเดินเตร่ = วงรีกว้างรอบคริสตอล — กระจายห่างกัน ไม่กระจุกที่ลูกแก้ว
// แนวนอนกว้าง (จอมีที่เหลือถึงขอบ) แต่แนวตั้งต้องไม่ถึงคริสตอลลูกข้างเคียง (spacing/2 ≈ 177)
const SCATTER_RX = 176;
const SCATTER_RY = 150;
const WANDER_SPEED = 0.25;       // px/เฟรม — เดินเตร่/ไหลลง (หาร 50% จากเดิม 0.5)

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
    minions: Math.min(2 + idx, 5),  // 2,3,4,5,5,5,... (ตัวที่ต้องฆ่าก่อนบอสมา)
    boss: idx >= 4,                 // มาตรา 5 เป็นต้นไป
    // ความเร็วไล่ — หาร 50% จากเดิม (0.575 → 1.05) · ต้องต่ำกว่าความเร็วเดินต่ำสุดของสกิล 👟 (1.3) เสมอ
    speed: 0.575 + t * 0.475,
    aggroR: 120 + t * 90,           // 120 → 210 (ลูกสมุนกระจายไกล — ต้องเห็นเด็กไกลขึ้น)
    biteCd: Math.round(112 - t * 46), // 112 → 66 เฟรม
    // ด่านท้าย ๆ ลูกสมุนตายยากขึ้น — +HP ต่อตัว (บวกกับ kind.hp)
    hpBonus: idx < 12 ? 0 : idx < 20 ? 1 : 2,
  };
}
const HERO_START_GAP = 64; // แม่มดน้อยเริ่มห่างจากขอบโซนลูกสมุนเท่านี้ (ต้องเดินเข้าไปเอง)

// ---- แถบพลังแม่มดน้อย ----
const FAINT_T = 66;           // เฟรมช่วงสลบก่อนฟื้น

// ---- พื้นแผนที่: หญ้า + ถนนดิน (texture ไฟล์ seamless tile, วาดด้วย createPattern) ----
// เดิมเป็น biome ไล่สีม่วงตามกลุ่มสระ — เปลี่ยนเป็นหญ้าเขียวโทนเดียวทั้งแผนที่ (ผู้ใช้เลือก)
// ไฟล์สร้างจาก scripts/gen-textures.mjs — แทนด้วยภาพ AI ได้ถ้า tile ต่อขอบเองและคง 256x256
const GROUND_IMG = new Image();
GROUND_IMG.src = 'public/assets/images/ground_grass.png';
const ROAD_IMG = new Image();
ROAD_IMG.src = 'public/assets/images/road_dirt.png';
const GRASS_BASE = '#5c8c3a'; // เติมช่องว่างก่อน texture โหลด / นอกขอบโลก
// ต้นไม้ประดับ — รูปภาพจริง (โปร่งใส) วางสุ่มสองข้างทาง, ขนาดต่างกัน
// โคนลำต้นในภาพอยู่ที่ ~y 0.84 ของกรอบ → drawDecor จัดให้ตรงพื้น
const TREE_IMG = new Image();
TREE_IMG.src = 'public/assets/images/tree.png';

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
    poseAtk: 0, // เฟรมที่เหลือของ "ท่าต่อสู้" (ยาวกว่ารอยไม้เหวี่ยง ให้ทันเห็นท่า)
    jumpT: 0,   // สกิล 🦘 — เฟรมพุ่งเร็วช่วงต้นของการเคลื่อน
    broomT: 0,  // สกิล 🧹 — เฟรมลอย (ลูกสมุนพื้นกัดไม่โดน)
    beamCd: 0,  // สกิล ✨ — cooldown ยิงแสง
    beamFx: null, // { tx, ty, t } เส้นแสงยิง
  };
  let helpers = [];        // สกิล 🧚 — ผู้ช่วยสู้อัตโนมัติ (เตรียมระบบ, GIF ทีหลัง)
  let hitFx = [];          // { wx, wy, t } วงรีแสงทองขยายออก ตอนตีโดน (แทนดาวกระจาย)
  let pendingSpin = null;  // { r, wide } — AoE เหวี่ยงหมุน ประมวลผลหลังจบ minion loop (กัน splice ซ้อน)
  let enterLatch = false; // true = ตัดสินใจเข้าโหนดแล้ว รอ stop() (กันเข้าซ้ำ tap+เดินถึง)

  let gems = [];          // { wx, wy, taken, respawn, bob } — เดินทับ = +1 หัวใจ
  let walkCeilY = 0;      // เดินขึ้นเหนือ y นี้ไม่ได้ (เกินลูกที่ล็อกได้แค่ 2 ลูก)
  let lastUnlockedIdx = 0;

  // Phase 2 — ลูกสมุน (object pool แบบ mahjong/particles)
  let minions = [];
  const minionPool = [];
  let spawnCd = 80;
  const keyDelivered = Object.create(null); // matraId -> true (พากุญแจกลับมาเปิดบ้านแล้ว)
  const bossDone = Object.create(null);     // matraId -> true (ฆ่าบอสรอบนี้แล้ว)
  let heroKey = -1;                          // idx บ้านที่แม่มดถือกุญแจอยู่ (-1 = ไม่ถือ)
  let diff = difficultyFor(0, 30); // ความยากของคริสตอลเป้าหมายปัจจุบัน (อัปเดตใน updateMinions)
  // บ้านเป้าหมาย "ปิดผนึก" จนกว่าจะพากุญแจ (ที่อยู่เหนือบ้าน) กลับมาเปิด — เก็บ per matraId ทั้ง session
  const guardKills = Object.create(null);    // matraId -> จำนวนลูกสมุนที่ฆ่า (คุมจังหวะบอสมา)
  const guardSpawns = Object.create(null);   // matraId -> จำนวนลูกสมุนที่ปล่อยออกมาแล้ว

  // Phase 3
  let groundPat = null; // CanvasPattern หญ้า — สร้างครั้งเดียวตอน texture โหลดเสร็จ
  let roadPat = null;   // CanvasPattern ดิน
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
  let roadPoly = null;    // Path2D ริบบิ้นถนนดิน (world space) — สร้างครั้งเดียวตอน computeLayout
  let roadPolyPts = [];   // จุดขอบ polygon (fallback เมื่อไม่มี Path2D)
  let spine = [];         // เส้นกลางถนน { x, y } ต่อมาตรา — บ้าน/ต้นไม้เยื้องจากเส้นนี้

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
  // เปลี่ยนตำแหน่งได้ทุกครั้งที่เกิดใหม่ ต่างจากของประดับที่ต้องอยู่นิ่ง
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
    // โลกกว้างกว่าจอมาก — เผื่อบ้านเยื้องออกข้างถนนแล้วกล้องยังเฟรมบ้านได้
    const amp = Math.max(100, W * 0.6);
    const midX = W / 2 + amp;          // กึ่งกลางโลก
    worldW = W + amp * 2;              // บ้านสุดขอบ → cam.x ∈ [0, worldW - W]
    const pad = H * 0.55;
    const spacing = Math.max(190, H * 0.42);
    nodeSpacing = spacing;
    worldH = pad + spacing * (N - 1) + pad;

    // เส้นกลางถนน (spine) — ไล่ขึ้นแนวตั้ง + ส่ายแนวนอน sine เบา ๆ
    // i=0 อยู่ล่างสุดของโลก เดินขึ้นบนเมื่อคืบหน้า
    spine = [];
    for (let i = 0; i < N; i++) {
      spine.push({
        x: midX + Math.sin(i * 0.55) * (amp * 0.34),
        y: pad + (N - 1 - i) * spacing,
      });
    }

    // บ้านมาตรา = จุด spine เยื้องออกข้างถนน สลับ 2 ฝั่งแบบสุ่ม (ไม่ทับถนน)
    const NODE_OFF = Math.max(110, W * 0.3);
    nodes = MATRA.map((m, i) => {
      let sideSign = i % 2 === 0 ? 1 : -1;               // หลัก: สลับซ้าย-ขวา
      if (h01(i * 23 + 5) < 0.30) sideSign = -sideSign;  // สุ่มพลิกบางลูก → 2 ฝั่งแบบสุ่ม
      const off = NODE_OFF * (0.88 + 0.24 * h01(i * 31 + 2));
      let wx = spine[i].x + sideSign * off;
      const m2 = HOUSE_DW * 0.42 + 12;
      wx = Math.max(m2, Math.min(worldW - m2, wx));
      return {
        matraId: m.id,
        name: m.name,
        idx: i,
        wx,
        wy: spine[i].y,
        side: sideSign,
        shake: 0,
      };
    });

    // ประกายพื้นหลัง — สุ่มแบบ deterministic (ไม่ใช้ Math.random ใน loop) ใน band สูง 1 จอ
    const DOT_N = 46;
    decorDots.length = 0;
    for (let i = 0; i < DOT_N; i++) {
      // hash เลขลำดับ → กระจายทั่ว ๆ พอ ไม่ต้องสวยมาก
      const a = (i * 92821) % 10007;
      const b = (i * 53113) % 9973;
      decorDots.push({ x: (a / 10007) * W, y: (b / 9973) * H });
    }

    // ถนนดิน = ริบบิ้น polygon เลื้อยแบบงู ขอบไม่สม่ำเสมอ (world space) — สร้างครั้งเดียว
    // (1) เส้นกลาง = โค้ง Catmull-Rom ผ่านคริสตอลทุกลูก (ไม่หักมุมที่โหนด)
    // (2) ส่ายซ้าย-ขวาแรง ๆ หลายลูกคลื่นต่อช่วงคริสตอล → เลื้อยเหมือนงู
    //     envelope sin²(πt) บีบให้ offset + ความชัน = 0 ตรงคริสตอล (ถนนผ่ากลางลูกแก้ว เรียบ ไม่หักมุม)
    {
      const SEGS = 22;       // ช่วงย่อยต่อ 1 ช่วง spine (ถี่ขึ้นเพราะคลื่นเยอะ)
      const AMP = Math.min(78, nodeSpacing * 0.5);  // แอมพลิจูดการเลื้อย (px)
      const WAVES = 2.4;     // จำนวนครึ่งคลื่นต่อช่วง spine (>2 = มี S หลายตัว)
      const ctrl = spine.map((s) => ({ wx: s.x, wy: s.y }));  // ถนนตามเส้นกลาง ไม่ใช่ตัวบ้าน
      const pts = [];
      const segT = [];      // { seg, t } ของแต่ละจุด — ใช้คำนวณคลื่นการเลื้อย
      for (let i = 0; i < ctrl.length - 1; i++) {
        const p0 = ctrl[i - 1] || ctrl[i];
        const p1 = ctrl[i];
        const p2 = ctrl[i + 1];
        const p3 = ctrl[i + 2] || ctrl[i + 1];
        for (let k = 0; k < SEGS; k++) {
          const t = k / SEGS, tt = t * t, ttt = tt * t;
          const cx =
            0.5 * (2 * p1.wx + (-p0.wx + p2.wx) * t +
              (2 * p0.wx - 5 * p1.wx + 4 * p2.wx - p3.wx) * tt +
              (-p0.wx + 3 * p1.wx - 3 * p2.wx + p3.wx) * ttt);
          const cy =
            0.5 * (2 * p1.wy + (-p0.wy + p2.wy) * t +
              (2 * p0.wy - 5 * p1.wy + 4 * p2.wy - p3.wy) * tt +
              (-p0.wy + 3 * p1.wy - 3 * p2.wy + p3.wy) * ttt);
          pts.push({ x: cx, y: cy });
          segT.push({ seg: i, t });
        }
      }
      pts.push({ x: ctrl[ctrl.length - 1].wx, y: ctrl[ctrl.length - 1].wy });
      segT.push({ seg: ctrl.length - 2, t: 1 });

      // ส่ายแบบงู: offset ตั้งฉาก = sin(t·π·WAVES) · AMP · sin²(π t) · (แอมป์สุ่มต่อช่วง)
      const base = pts.map((p) => ({ x: p.x, y: p.y }));
      for (let j = 1; j < pts.length - 1; j++) {
        const a = base[j - 1], b = base[j + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d, ny = dx / d;
        const { seg, t } = segT[j];
        const env = Math.sin(Math.PI * t);           // 0 ที่ปลายช่วง
        const ampSeg = AMP * (0.75 + 0.5 * h01(seg * 131 + 7)); // แต่ละช่วงเลื้อยไม่เท่ากัน
        const off = Math.sin(t * Math.PI * WAVES) * ampSeg * env * env;
        pts[j].x = base[j].x + nx * off;
        pts[j].y = base[j].y + ny * off;
      }

      // value noise เรียบ ๆ ต่อ sample — lerp ค่า hash ทุก 6 จุด (ไม่ให้ขอบสั่นจั๊กจี้)
      const roadHW = (k) => {
        const CELL = 6;
        const g = k / CELL, i0 = Math.floor(g), f = g - i0;
        const s = f * f * (3 - 2 * f);
        const a = h01(i0 * 2749 + 13), b = h01((i0 + 1) * 2749 + 13);
        return ROAD_HW + ((a * (1 - s) + b * s) - 0.5) * 2 * ROAD_HW_VAR;
      };

      const left = [], right = [];
      for (let j = 0; j < pts.length; j++) {
        const p0 = pts[Math.max(0, j - 1)];
        const p1 = pts[Math.min(pts.length - 1, j + 1)];
        let dx = p1.x - p0.x, dy = p1.y - p0.y;
        const d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d, ny = dx / d;   // ตั้งฉากกับแนวเส้นทาง
        const hw = roadHW(j);
        left.push({ x: pts[j].x + nx * hw, y: pts[j].y + ny * hw });
        right.push({ x: pts[j].x - nx * hw, y: pts[j].y - ny * hw });
      }
      right.reverse();
      roadPolyPts = left.concat(right);
      roadPoly = HAS_PATH2D ? new Path2D() : null;
      if (roadPoly) {
        roadPoly.moveTo(roadPolyPts[0].x, roadPolyPts[0].y);
        for (let j = 1; j < roadPolyPts.length; j++) roadPoly.lineTo(roadPolyPts[j].x, roadPolyPts[j].y);
        roadPoly.closePath();
      }
    }

    // พื้นหญ้าเป็น pattern เดียวทั้งแผนที่ — ไม่มี band ต่อกลุ่มแล้ว (สร้าง pattern ใน render)

    // แม่มดอยู่เหนือมาตราสุดท้าย (index N-1 = wy น้อยสุด)
    witchWY = nodes[N - 1].wy - spacing * 0.95;
    witchWX = nodes[N - 1].wx;

    // ของประดับ — หิน/พุ่ม/ต้นไม้ วางอิง "เส้นกลางถนน" (spine) ให้พ้นถนน+พ้นบ้านเสมอ
    // deterministic (hash ไม่ใช่ Math.random) → resize แล้วตำแหน่งไม่สลับ
    decor.length = 0;
    const decorN = Math.max(16, Math.round(worldH / 118));
    // พ้นถนน (spine ± ~30) และพ้นแนวบ้าน (spine ± NODE_OFF, บ้านกว้าง ~HOUSE_DW/2)
    const decorClear = NODE_OFF + HOUSE_DW * 0.5 + 26;
    for (let i = 0; i < decorN; i++) {
      const r2 = h01(i * 3 + 2);
      const r3 = h01(i * 3 + 3);
      const r4 = h01(i * 7 + 5);   // ชนิด
      const r5 = h01(i * 11 + 9);  // สเกล
      const r6 = h01(i * 13 + 8);  // ฝั่ง/flip
      const wy = ((i + r3) / decorN) * worldH;
      const side = r6 < 0.5 ? -1 : 1;
      const dist = decorClear + r2 * (W * 0.3);
      let wx = spineXAt(wy) + side * dist;
      wx = Math.max(14, Math.min(worldW - 14, wx));
      const type = r4 < 0.26 ? 0 : r4 < 0.46 ? 1 : 2;   // ~54% เป็นต้นไม้
      // ต้นไม้ (รูปภาพ) สเกลกว้าง 0.55–1.8 ให้ขนาดต่างกันชัด · หิน/พุ่ม 0.75–1.45
      const s = type === 2 ? 0.55 + r5 * 1.25 : 0.75 + r5 * 0.7;
      const dc = { wx, wy, type, s, flip: r6 < 0.5 ? -1 : 1 };
      if (type === 2) dc.trunkR = 8 * s;   // รัศมีโคนต้นไม้ (แม่มดชนไม่ทะลุ)
      decor.push(dc);
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
    // เดินขึ้นได้เกินบ้านที่ปลดล็อกไปอีกแค่ 2 หลัง (หลังที่ล็อก)
    const ceilIdx = Math.min(nodes.length - 1, lastUnlockedIdx + 2);
    walkCeilY = nodes[ceilIdx].wy - NODE_R - 20;
    const prevFocus = focusIdx;
    focusIdx = computeFocusIdx();
    // บ้านเป้าหมายยังผนึก → ต้องเดินขึ้นไปถึงกุญแจได้ (สำคัญตอน focus = บ้านหลังสุด)
    if (nodeSealed(focusIdx)) {
      walkCeilY = Math.min(walkCeilY, keyPos(focusIdx).wy - 60);
    }
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

  // บ้านปิดผนึกอยู่ไหม (ต้องพากุญแจกลับมาเปิด)
  function nodeSealed(i) {
    if (REDUCED_MOTION) return false;      // โหมดสงบ — ไม่มีศัตรู/กุญแจ เปิดตลอด
    if (i !== focusIdx) return false;      // มีศัตรู/กุญแจเฉพาะบ้านเป้าหมาย
    return !keyDelivered[nodes[i].matraId];
  }

  // ตำแหน่งกุญแจของบ้าน i — เหนือบ้านขึ้นไป (ไม่ใช่เดินเก็บง่าย) สุ่มแนวนอนรอบถนน
  // deterministic (hash) → ตายแล้วกุญแจกลับจุดเดิมเป๊ะ ไม่ต้องเก็บ state
  function keyPos(i) {
    const n = nodes[i];
    const upFrac = 0.62 + h01(i * 41 + 7) * 0.33;         // 0.62–0.95 ของ nodeSpacing เหนือบ้าน
    const ky = n.wy - nodeSpacing * upFrac;
    const kx = spineXAt(ky) + (h01(i * 53 + 11) - 0.5) * (W * 0.56);
    return { wx: Math.max(30, Math.min(worldW - 30, kx)), wy: ky };
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

  // x ของเส้นกลางถนนที่ระดับ world y (lerp ระหว่างจุด spine) — วางบ้าน/ต้นไม้เยื้องจากนี้
  function spineXAt(wy) {
    const n = spine.length;
    if (n < 2) return worldW / 2;
    if (wy >= spine[0].y) return spine[0].x;                 // spine[0] = ล่างสุด (y มาก)
    if (wy <= spine[n - 1].y) return spine[n - 1].x;
    for (let i = 0; i < n - 1; i++) {
      const a = spine[i], b = spine[i + 1];                  // a.y > b.y
      if (wy <= a.y && wy >= b.y) {
        const f = (a.y - wy) / (a.y - b.y || 1);
        return a.x + (b.x - a.x) * f;
      }
    }
    return spine[0].x;
  }

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
    resetGuardWave(); // init ตัวนับ guardKills/guardSpawns + หน่วงก่อนศัตรูตัวแรกไหลมา
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
    hero.jumpT = 0; hero.broomT = 0; hero.beamCd = 0; hero.beamFx = null;
    heroKey = -1; // เข้าเล่นมาตราแล้วกลับมา = ไม่ถือกุญแจ (keyDelivered ยังคงอยู่ทั้ง session)
    hitFx.length = 0;
    pendingSpin = null;
    helpers.length = 0;
    syncHelpers(); // สกิล 🧚 — สร้างผู้ช่วยตามจำนวนที่อัปไว้
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
      const dm = Math.hypot(m.wx - hero.wx, m.wy - hero.wy);
      // สกิล ✨ — ลูกสมุนไกลเกินเอื้อม แต่ในระยะยิงแสง → ยิงใส่ทันที ไม่ต้องเดินไปหา
      if (sk.beam > 0 && !m.isBoss && dm > ATTACK_R && dm <= sk.beam && hero.beamCd <= 0 && hero.fainting === 0) {
        const d = dm || 1;
        m.hp--;
        m.stagger = MINION_STAGGER;
        m.active = false;
        m.vx = ((m.wx - hero.wx) / d) * KNOCK * 0.5;
        m.vy = ((m.wy - hero.wy) / d) * KNOCK * 0.5;
        hero.beamCd = 40;
        hero.beamFx = { tx: m.wx, ty: m.wy, t: 0 };
        hero.facing = m.wx < hero.wx ? -1 : 1;
        hero.poseAtk = HERO_POSE_ATK_T;
        audio.sfx('swing');
        audio.sfx('minion_cry');
        spawnHitFx(m.wx, m.wy);
        if (m.hp <= 0) killMinionAt(m);
        pressNodeIdx = -1;
        return;
      }
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
    // สกิล 🦘 — แตะพื้นไกล ๆ = พุ่งกระโดดเร็วช่วงต้น
    if (sk.jump > 0 && Math.hypot(w.wx - hero.wx, w.wy - hero.wy) > 130) hero.jumpT = 12;
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
        mapSay(heroKey === i ? 'พากุญแจมาที่บ้านสิ!' : 'ไปเก็บกุญแจเหนือบ้านก่อนนะ!');
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
  // trace ริบบิ้นถนนลง current path (fallback เมื่อไม่มี Path2D)
  function traceRoadPoly() {
    fx.beginPath();
    fx.moveTo(roadPolyPts[0].x, roadPolyPts[0].y);
    for (let i = 1; i < roadPolyPts.length; i++) fx.lineTo(roadPolyPts[i].x, roadPolyPts[i].y);
    fx.closePath();
  }

  function update() {
    // ---- ตัวจับเวลาแม่มดน้อย ----
    if (hero.invuln > 0) hero.invuln--;
    if (hero.hurtT > 0) hero.hurtT--;
    if (hero.poseAtk > 0) hero.poseAtk--;
    if (hero.jumpT > 0) hero.jumpT--;
    if (hero.broomT > 0) hero.broomT--;
    if (hero.beamCd > 0) hero.beamCd--;
    if (hero.beamFx && ++hero.beamFx.t > 10) hero.beamFx = null;

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
        // สกิล 👟 ความเร็วปกติ · สกิล 🦘 พุ่งเร็วช่วงต้น (jumpT)
        const spd = hero.jumpT > 0 ? sk.heroSpeed * sk.jump : sk.heroSpeed;
        const step = Math.min(d, spd);
        hero.wx += (dx / d) * step;
        hero.wy += (dy / d) * step;
        if (Math.abs(dx) > 0.8) hero.facing = dx < 0 ? -1 : 1;
        hero.bob += 0.28;
      }
      hero.wx = Math.max(22, Math.min(worldW - 22, hero.wx));
      // เดินขึ้นเกินลูกที่ล็อกได้แค่ 2 ลูก (walkCeilY คำนวณใน refresh)
      hero.wy = Math.max(walkCeilY, Math.min(worldH - 18, hero.wy));

      // ---- ชนโคนต้นไม้: ดันออกนอกรัศมีโคน + สไลด์อ้อม (ไม่ทะลุ ไม่ค้าง) ----
      const foot = 11;
      for (let d = 0; d < decor.length; d++) {
        const dc = decor[d];
        if (!dc.trunkR) continue;
        if (Math.abs(dc.wy - hero.wy) > 120) continue;   // เช็คเฉพาะต้นที่ใกล้
        const ddx = hero.wx - dc.wx;
        const ddy = hero.wy - dc.wy;
        const rr = dc.trunkR + foot;
        const dd = Math.hypot(ddx, ddy);
        if (dd > 0.01 && dd < rr) {
          const nxr = ddx / dd, nyr = ddy / dd;
          hero.wx = dc.wx + nxr * rr;           // ดันออกแนวรัศมี
          hero.wy = dc.wy + nyr * rr;
          // เป้าอยู่ "หลัง" ต้นไม้ → สไลด์ตามเส้นสัมผัสไปด้านที่ใกล้เป้า (เดินอ้อม)
          const tgx = hero.tx - hero.wx, tgy = hero.ty - hero.wy;
          if (tgx * -nxr + tgy * -nyr > 0) {
            let tx1 = -nyr, ty1 = nxr;
            if (tgx * tx1 + tgy * ty1 < 0) { tx1 = -tx1; ty1 = -ty1; }
            const slide = Math.min(sk.heroSpeed, Math.hypot(tgx, tgy));
            hero.wx += tx1 * slide;
            hero.wy += ty1 * slide;
            const nd = Math.hypot(hero.wx - dc.wx, hero.wy - dc.wy) || 1;
            if (nd < rr) { hero.wx = dc.wx + (hero.wx - dc.wx) / nd * rr; hero.wy = dc.wy + (hero.wy - dc.wy) / nd * rr; }
          }
        }
      }
    }

    // ---- เก็บพลอยเติมหัวใจ ----
    updateGems();

    // ---- กุญแจบ้าน: เดินทับ = ถือ · พากลับไปที่บ้าน = เปิด ----
    updateKey();

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
    updateHelpers();
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
    // ยังไม่ส่งกุญแจ = บ้านยังผนึก = ศัตรูยังไหลมาไม่หยุด
    const needGuards = fnode && unlocked[fid] && !keyDelivered[fid];

    // ลูกสมุนไหลลงมาจากข้างบนเรื่อยๆ ไม่มีหมด · ฆ่าครบจำนวนความยาก → บอสมาเฝ้ากุญแจ 1 ตัว
    if (!REDUCED_MOTION && !returnAnim && hero.fainting === 0 && needGuards) {
      const killed = guardKills[fid] || 0;
      let normalsAlive = 0;
      let bossAlive = false;
      for (let k = 0; k < minions.length; k++) {
        if (minions[k].isBoss) bossAlive = true;
        else normalsAlive++;
      }
      if (spawnCd > 0) spawnCd--;
      if (spawnCd <= 0) {
        if (diff.boss && killed >= diff.minions && !bossAlive && !bossDone[fid]) {
          spawnBoss(fnode);
          spawnCd = 90;
        } else if (normalsAlive < MAX_MINIONS) {
          spawnStreamMinion(fnode);
          // ยิ่งด่านยาก ยิ่งไหลถี่ (~52 → 40 เฟรม)
          spawnCd = Math.max(40, Math.round(60 - diff.minions * 4));
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
      // ปล่อยคืน pool: บ้านเปิดแล้ว / หลุดจอ / เดินลงเลยบ้านไปแล้ว (สายไหลผ่านไป ไม่ปะทะ)
      const flowedPast = !m.isBoss && !m.active && m.reengageCd <= 0 &&
        m.wy > (m.streamTargetY != null ? m.streamTargetY + 24 : gnode ? gnode.wy + 90 : 1e9);
      if (!gnode || keyDelivered[gnode.matraId] || m.wy < cullLo || m.wy > cullHi || flowedPast) {
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
        // ***invariant: ห้ามเร็วเกินเด็ก*** ไม่งั้นหนีไม่ได้เลย — clamp ตอนรันกันไว้
        // อีกชั้น เผื่อมีคนแก้ speed ในตาราง MINION_KINDS ทีหลังจนทะลุเพดาน
        const msp = Math.min(diff.speed * (m.kind.speed || 1), sk.heroSpeed - 0.2);
        m.wx += (dhx / d) * msp;
        m.wy += (dhy / d) * msp;
        m.facing = dhx < 0 ? -1 : 1;
        // สกิล 🧹 — แม่มดลอยไม้กวาดอยู่ → ลูกสมุน "พื้น" กัดไม่ถึง (ตัวบินยังกัดได้)
        const canBite = !(hero.broomT > 0 && !m.kind.fly);
        if (canBite && distHero < BITE_R && m.biteCd <= 0 && hero.invuln <= 0 && hero.fainting === 0) {
          biteHero(m);
        }
      } else if (m.isBoss) {
        // บอสเฝ้าตรงบริเวณกุญแจ — ค่อย ๆ กลับไปที่กุญแจถ้าถูกตีกระเด็นออก
        m.spin = 0;
        const kp = keyPos(focusIdx);
        const dx = kp.wx - m.wx, dy = kp.wy - m.wy;
        const dd = Math.hypot(dx, dy);
        if (dd > 8) { m.wx += (dx / dd) * 0.9; m.wy += (dy / dd) * 0.9; }
        else m.wx += Math.sin(m.bob * 0.5) * 0.4;
      } else {
        // ศัตรูกระจายทั่วแนวจอแล้วเดินลงตรง ๆ (ไม่รวมเป็นสาย/ไม่บีบเข้าบ้าน)
        // เดินพ้นบ้านลงไป → despawn (flowedPast) → สายไหลไม่มีหมด
        m.spin = 0;
        const step = WANDER_SPEED * 2.2 * (m.kind.fly ? FLY_WANDER_MUL : 1);
        m.wy += step;
        m.wx += Math.sin(m.bob * 0.6 + (m.homeA || 0)) * 0.55; // ส่ายซ้ายขวาเล็กน้อย
        m.facing = 1;
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
        hero.poseAtk = HERO_POSE_ATK_T;
        hero.facing = dhx < 0 ? -1 : 1;
        spawnHitFx(m.wx, m.wy); // เอฟเฟกต์ตี — วงรีแสงทอง
        // สกิล 🌀/💫 — เหวี่ยงทีเดียวโดนลูกสมุนรอบตัว (ประมวลผลหลังจบ loop กัน splice ซ้อน)
        if ((sk.spin || sk.spinWide) && !m.isBoss) {
          pendingSpin = { r: Math.max(sk.spin, sk.spinWide), wide: sk.spinWide > 0 };
        }
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
          dropGems(m); // บินตาย → พลอยหัวใจ 3 เม็ด
          dropCoin(m); // เดินตาย → เหรียญทอง 1 เหรียญ
          if (m.isBoss) {
            bossDone[gid] = true;
            particleFx.spawnCelebrationBurst(sX(m.wx), sY(m.wy), { hueMin: 280, hueRange: 40 });
            audio.sfx('ting');
            mapSay('ล้มบอสแล้ว! รีบไปเก็บกุญแจ');
          } else if (diff.boss && !bossDone[gid] && guardKills[gid] === diff.minions) {
            mapSay('บอสกำลังมาเฝ้ากุญแจ!');
          }
          if (hero.atk === m) hero.atk = null; // ตัวที่สั่งตีตายแล้ว
          minionPool.push(m);
          minions.splice(i, 1);
          continue;
        }
      }
    }

    // สกิล 🌀/💫 — AoE เหวี่ยงหมุน หลัง loop จบ (backward loop ภายใน = splice ปลอดภัย)
    if (pendingSpin) {
      doSpinHit(pendingSpin.r, pendingSpin.wide);
      pendingSpin = null;
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
    // สกิล 🧹 — โดนกัดแล้วขึ้นไม้กวาดลอยหนีชั่วครู่ (ลูกสมุนพื้นกัดไม่โดน)
    if (sk.broom > 0 && hero.hp > 0) {
      hero.broomT = sk.broom;
      mapSay('ขึ้นไม้กวาด! ลอยหนีลูกสมุน');
    }
    if (hero.hp <= 0) {
      hero.hp = 0;
      hero.fainting = FAINT_T;
      hero.hurtT = 0;
      hero.atk = null;
      addPoints(-100); // ตาย = เหรียญสะสมลด 100 (clamp ≥ 0 ใน addPoints)
      if (heroKey !== -1) {
        heroKey = -1; // ตายพร้อมถือกุญแจ → กุญแจหล่นกลับไปจุดเดิม (keyPos คงที่)
        mapSay('ทำกุญแจหล่น! ต้องไปเอาใหม่ที่เดิม');
      } else {
        mapSay('ล้มแล้ว! เสียเหรียญ 100');
      }
      particleFx.spawnExplosion(sX(hero.wx), sY(hero.wy));
    }
  }

  function heroRespawn() {
    const node = nodes[focusIdx] || nodes[0];
    // ฟื้นใต้บ้าน (ไม่ตกกลางวง → กันสลบวนไม่จบ)
    hero.wx = node.wx;
    hero.wy = heroSealedStartY(node);
    hero.tx = hero.wx;
    hero.ty = hero.wy;
    hero.moving = false;
    hero.hp = sk.maxHp;
    hero.invuln = 150; // ~2.5s อมตะให้ตั้งหลัก
    hero.hurtT = 0;
    // ล้างศัตรูที่ค้าง — สายไหลจะสร้างใหม่เอง (guardKills/bossDone คงไว้ = ความคืบหน้าไม่หาย)
    minions.forEach((m) => minionPool.push(m));
    minions.length = 0;
    spawnCd = 90;
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

  // ลูกสมุน "บิน" ตาย → พลอยหล่น 3 เม็ด ตรงจุดตาย (ของหล่น: เก็บแล้วหาย ไม่เกิดใหม่)
  // ลูกสมุน "บิน" ตาย → พลอยหัวใจหล่น 3 เม็ด ตรงจุดตาย
  function dropGems(m) {
    if (!m || !m.kind || !m.kind.fly) return;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.random() * 0.8;
      gems.push({
        drop: true, life: 620, taken: false, respawn: 0, bob: Math.random() * 6,
        nodeIdx: m.guardIdx | 0,
        wx: m.wx + Math.cos(a) * (12 + Math.random() * 16),
        wy: m.wy + Math.sin(a) * (10 + Math.random() * 12),
      });
    }
    audio.sfx('gem');
  }

  // ลูกสมุน "เดิน (ไม่บิน)" ตาย → เหรียญทองหล่น 1 เหรียญ (เก็บ = +1 คะแนนสะสม)
  function dropCoin(m) {
    if (!m || !m.kind || m.kind.fly) return;
    gems.push({
      coin: true, drop: true, life: 620, taken: false, respawn: 0, bob: Math.random() * 6,
      nodeIdx: m.guardIdx | 0,
      wx: m.wx + (Math.random() - 0.5) * 14,
      wy: m.wy + (Math.random() - 0.5) * 12,
    });
  }

  // เก็บ: พลอย = +1 หัวใจ (ตอนพลังไม่เต็ม) · เหรียญ = +1 คะแนนสะสม (เสมอ)
  // พลอยประจำบ้านเกิดใหม่ใน GEM_RESPAWN · ของหล่น (drop) เก็บแล้วหาย · อายุ ~10 วิ
  function updateGems() {
    const canHeal = hero.hp < sk.maxHp && hero.fainting === 0;
    const pr2 = GEM_PICK_R * GEM_PICK_R;
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (g.drop && g.life !== undefined && --g.life <= 0) { gems.splice(i, 1); i--; continue; } // หมดอายุ
      if (g.taken) {
        if (g.drop) { gems.splice(i, 1); i--; continue; }
        // เกิดใหม่ = สุ่มที่ใหม่ ไม่โผล่จุดเดิม (เดิมเด็กจำตำแหน่งได้ ไม่ต้องสำรวจ)
        if (--g.respawn <= 0) { g.taken = false; placeGem(g, nodes[g.nodeIdx]); }
        continue;
      }
      if (Math.abs(g.wy - hero.wy) > 160) continue; // เช็คเฉพาะเม็ดใกล้ตัว
      const dx = g.wx - hero.wx;
      const dy = g.wy - hero.wy;
      if (dx * dx + dy * dy > pr2) continue;
      if (g.coin) {
        addPoints(1);
        audio.sfx('gem');
        particleFx.spawnCelebrationBurst(sX(g.wx), sY(g.wy), { hueMin: 44, hueRange: 16 });
        gems.splice(i, 1); i--;
        continue; // เหรียญเก็บได้หลายเม็ดต่อเฟรม
      }
      if (!canHeal) continue;
      hero.hp = Math.min(sk.maxHp, hero.hp + 1);
      audio.sfx('gem');
      particleFx.spawnCelebrationBurst(sX(g.wx), sY(g.wy), { hueMin: 315, hueRange: 30 });
      if (g.drop) { gems.splice(i, 1); i--; }
      else { g.taken = true; g.respawn = GEM_RESPAWN; }
      break; // พลอยหัวใจเก็บทีละเม็ดต่อเฟรม
    }
  }

  // กุญแจบ้าน — เดินทับ (เหนือบ้าน) = ถือ · พากลับมาที่บ้าน = เปิดผนึก แล้ว nearestUnlockedUnderHero เข้าเอง
  function updateKey() {
    const i = focusIdx;
    const n = nodes[i];
    if (REDUCED_MOTION || !n || !unlocked[n.matraId] || keyDelivered[n.matraId] || hero.fainting > 0) return;
    if (heroKey === i) {
      const dx = hero.wx - n.wx, dy = hero.wy - n.wy;
      const R = NODE_R + HERO_R + 8;
      if (dx * dx + dy * dy <= R * R) {
        keyDelivered[n.matraId] = true;
        heroKey = -1;
        audio.sfx('ting');
        particleFx.spawnCelebrationBurst(sX(n.wx), sY(n.wy), { hueMin: 44, hueRange: 26 });
        mapSay('เปิดบ้านได้แล้ว! เดินเข้าไปเลย');
      }
    } else if (heroKey === -1) {
      const kp = keyPos(i);
      const dx = hero.wx - kp.wx, dy = hero.wy - kp.wy;
      const R = GEM_PICK_R + 8;
      if (dx * dx + dy * dy <= R * R) {
        // ด่านที่มีบอส: กุญแจถูกคำสาปล็อกอยู่ ต้องล้มบอสก่อนถึงเก็บได้
        if (difficultyFor(i, nodes.length).boss && !bossDone[n.matraId]) {
          if (!updateKey._warn || performance.now() - updateKey._warn > 2500) {
            updateKey._warn = performance.now();
            audio.sfx('wrong_soft');
            mapSay('คำสาปล็อกกุญแจอยู่! ต้องล้มบอสก่อน');
          }
          return;
        }
        heroKey = i;
        audio.sfx('gem');
        particleFx.spawnCelebrationBurst(sX(kp.wx), sY(kp.wy), { hueMin: 44, hueRange: 22 });
        mapSay('ได้กุญแจแล้ว! รีบพากลับไปเปิดบ้าน');
      }
    }
  }

  // ---------- สกิลต่อสู้ 5–10 ----------
  // เอฟเฟกต์ตี — วงรีแสงทองแนวนอนขยายออก+จาง (แทนดาวกระจายเดิม) เก็บพิกัด world
  function spawnHitFx(wx, wy) {
    hitFx.push({ wx, wy, t: 0 });
    if (hitFx.length > 28) hitFx.shift();
  }

  // ลูกสมุน m ตายจาก AoE/beam/ผู้ช่วย (ไม่ใช่จากตีตรง) — แต้ม/นับ/เอฟเฟกต์/ถอดออกจาก array
  function killMinionAt(m) {
    const idx = minions.indexOf(m);
    if (idx < 0) return;
    const gn = nodes[m.guardIdx];
    if (gn) {
      addPoints(m.isBoss ? BOSS_PTS : MINION_PTS);
      guardKills[gn.matraId] = (guardKills[gn.matraId] || 0) + 1;
      dropGems(m); // บินตาย → พลอยหัวใจ 3 เม็ด
      dropCoin(m); // เดินตาย → เหรียญทอง 1 เหรียญ
      if (m.isBoss) { bossDone[gn.matraId] = true; mapSay('ล้มบอสแล้ว! รีบไปเก็บกุญแจ'); }
      particleFx.spawnCelebrationBurst(sX(m.wx), sY(m.wy), { hueMin: m.isBoss ? 280 : 90, hueRange: 40 });
    }
    if (hero.atk === m) hero.atk = null;
    minionPool.push(m);
    minions.splice(idx, 1);
  }

  // AoE เหวี่ยงหมุน — เรียกหลังจบ minion loop (backward, splice ปลอดภัย)
  function doSpinHit(r, wide) {
    const r2 = r * r;
    let hitAny = false;
    for (let i = minions.length - 1; i >= 0; i--) {
      const m = minions[i];
      if (m === hero.atk || m.isBoss || m.stagger > 0) continue; // ตัวหลักโดนแล้ว · บอสต้องตีตรง
      const dx = m.wx - hero.wx, dy = m.wy - hero.wy;
      if (dx * dx + dy * dy > r2) continue;
      const d = Math.hypot(dx, dy) || 1;
      const k = wide ? KNOCK * 1.5 : KNOCK * 0.7;
      m.hp--;
      m.stagger = MINION_STAGGER;
      m.active = false;
      m.vx = (dx / d) * k;
      m.vy = (dy / d) * k;
      m.spinV = 0.3;
      spawnHitFx(m.wx, m.wy);
      hitAny = true;
      if (m.hp <= 0) killMinionAt(m);
    }
    if (hitAny) audio.sfx('minion_cry');
  }

  // ผู้ช่วย — จำนวนตาม sk.helpers, โคจรรอบแม่มด + ยิงศัตรูใกล้สุดเป็นระยะ (auto)
  function syncHelpers() {
    const want = sk.helpers | 0;
    while (helpers.length < want) helpers.push({ wx: hero.wx, wy: hero.wy, a: Math.random() * 6.28, atkCd: 30, zap: null });
    while (helpers.length > want) helpers.pop();
  }
  function updateHelpers() {
    for (let h = 0; h < helpers.length; h++) {
      const hp = helpers[h];
      hp.a += 0.03;
      const ox = hero.wx + Math.cos(hp.a + h * 2.1) * (46 + h * 5);
      const oy = hero.wy - HERO_R * 0.7 + Math.sin(hp.a + h * 2.1) * (28 + h * 4);
      hp.wx += (ox - hp.wx) * 0.14;
      hp.wy += (oy - hp.wy) * 0.14;
      if (hp.atkCd > 0) hp.atkCd--;
      if (hp.zap && ++hp.zap.t > 8) hp.zap = null;
      if (hp.atkCd <= 0 && hero.fainting === 0) {
        let best = null, bd = 150 * 150;
        for (let i = 0; i < minions.length; i++) {
          const m = minions[i];
          if (m.isBoss || m.stagger > 0) continue;
          const dx = m.wx - hp.wx, dy = m.wy - hp.wy;
          const dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = m; }
        }
        if (best) {
          best.hp--;
          if (best.stagger < 8) best.stagger = 8;
          hp.atkCd = 66;
          hp.zap = { tx: best.wx, ty: best.wy, t: 0 };
          spawnHitFx(best.wx, best.wy);
          audio.sfx('minion_cry');
          if (best.hp <= 0) killMinionAt(best);
        }
      }
    }
  }

  // ตั้งค่าฟิลด์ร่วมของลูกสมุน/บอส (ดึงจาก pool ใช้ซ้ำ ไม่ alloc)
  function initMinion(m, isBoss) {
    m.guardIdx = focusIdx;
    m.isBoss = !!isBoss;
    m.wanderX = m.wx;
    m.wanderY = m.wy;
    m.wanderT = 30;
    m.vx = 0;
    m.vy = 0;
    m.hp = m.kind.hp + (isBoss ? 0 : (diff.hpBonus || 0)); // ด่านท้าย ๆ ตายยากขึ้น
    m.maxHp = m.hp;
    m.stagger = 0;
    m.reengageCd = 0;
    m.active = false;
    m.biteCd = isBoss ? 30 : 45;
    m.spin = 0;
    m.spinV = 0;
    m.bob = Math.random() * 6;
    m.facing = 1;
    minions.push(m);
  }

  // ลูกสมุน 1 ตัว — เกิดเหนือจอ/เหนือกุญแจ แล้วเดินลงมาผ่านบ้าน (สายไหลไม่มีหมด)
  function spawnStreamMinion(gnode) {
    const m = minionPool.pop() || {};
    const seq = guardSpawns[gnode.matraId] || 0;
    guardSpawns[gnode.matraId] = seq + 1;
    const kinds = kindsFor(focusIdx);
    m.kind = kinds[seq % kinds.length];
    const kp = keyPos(focusIdx);
    const spawnY = Math.min(cam.y - 50, kp.wy - 40);
    m.wy = spawnY;
    // กระจายทั่วแนวกว้างของจอ (ไม่เกิดเป็นสายเดียว) — เดินลงตรง ๆ ไม่บีบเข้าหาบ้าน
    m.wx = Math.max(20, Math.min(worldW - 20, cam.x + 12 + Math.random() * (W - 24)));
    m.homeA = Math.random() * Math.PI * 2;              // เฟสส่ายซ้ายขวา
    m.streamTargetY = gnode.wy + 90;                    // ผ่านบ้านลงไปเกินนี้ = despawn
    initMinion(m, false);
  }

  // บอส 1 ตัว — โผล่เฝ้ากุญแจ (เหนือบ้าน) เมื่อฆ่าลูกสมุนครบจำนวนความยาก
  function spawnBoss(gnode) {
    const m = minionPool.pop() || {};
    m.kind = BOSS_KIND;
    const kp = keyPos(focusIdx);
    m.wx = kp.wx;
    m.wy = kp.wy;                                       // โผล่ตรงบริเวณกุญแจ
    m.homeA = Math.PI / 2;
    m.streamTargetY = m.wy;                             // บอสไม่ไหลลง
    initMinion(m, true);
    mapSay('บอสมาเฝ้ากุญแจ! ตีให้ล้ม');
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

    // สร้าง pattern ครั้งเดียวเมื่อ texture โหลดเสร็จ (createPattern ผูกกับ context นี้)
    if (!groundPat && GROUND_IMG.complete && GROUND_IMG.naturalWidth) {
      groundPat = fx.createPattern(GROUND_IMG, 'repeat');
    }
    if (!roadPat && ROAD_IMG.complete && ROAD_IMG.naturalWidth) {
      roadPat = fx.createPattern(ROAD_IMG, 'repeat');
    }

    // ฐานหญ้า เผื่อช่องว่างก่อน texture โหลด / นอกขอบโลก
    fx.fillStyle = GRASS_BASE;
    fx.fillRect(0, 0, W, H);

    // ---- world layer: พื้นหญ้า / ประกาย / แม่มด / ประดับ / ถนนดิน ----
    fx.save();
    fx.translate(-cx, -cy);

    // พื้นหญ้าเต็มความกว้างโลก เฉพาะช่วงที่กล้องเห็น — pattern ผูกพิกัด world เลื่อนตามกล้องเอง
    if (groundPat) {
      fx.fillStyle = groundPat;
      fx.fillRect(-40, cy - 40, worldW + 80, H + 80);
    }

    if (!REDUCED_MOTION) {
      // ละอองแสง/เกสรลอย — parallax เลื่อนช้ากว่ากล้อง (wrap เป็น tile ขนาดจอตามกล้อง)
      fx.fillStyle = 'rgba(255,250,205,0.45)';
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

    // ถนนดิน: ริบบิ้น polygon ขอบไม่สม่ำเสมอ — เนื้อดิน (pattern) + ขอบเข้มบาง ๆ ตัดกับหญ้า
    // (พื้นดิน วาดก่อน actors ทั้งหมด → ต้นไม้/บ้าน/ตัวละครยืนอยู่ "บน" ทาง)
    fx.lineJoin = 'round';
    if (HAS_PATH2D) {
      fx.fillStyle = roadPat || '#8a6a44';
      fx.fill(roadPoly);
      fx.strokeStyle = 'rgba(50,34,18,0.55)';
      fx.lineWidth = 6;
      fx.stroke(roadPoly);
    } else {
      traceRoadPoly();
      fx.fillStyle = roadPat || '#8a6a44';
      fx.fill();
      fx.strokeStyle = 'rgba(50,34,18,0.55)';
      fx.lineWidth = 6;
      fx.stroke();
    }

    fx.restore();

    // ---- actors เรียงตามความลึก (y โลก): ต้นไม้ / บ้าน / ลูกสมุน / แม่มดน้อย ----
    // ไกล (y น้อย = บนจอ) วาดก่อน, ใกล้ (y มาก = ล่างจอ) วาดทับ → เดินหลังต้นไม้ = ถูกบัง
    fx.textAlign = 'center';
    fx.textBaseline = 'alphabetic';
    fx.font = NODE_FONT;

    const zlist = [];
    for (let i = 0; i < decor.length; i++) {
      const dc = decor[i];
      // margin ล่างเผื่อต้นไม้สูง (โคนใต้จอ ยอดยังโผล่)
      if (dc.wy < cy - 80 || dc.wy > cy + H + 280) continue;
      zlist.push({ z: dc.wy, k: 0, dc });
    }
    const nodeScr = new Array(nodes.length).fill(null);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const sy = n.wy - cy;
      if (sy < -160 || sy > H + 160) continue;
      let sx = n.wx - cx;
      if (sx < -180 || sx > W + 180) continue;
      if (n.shake > 0) sx += Math.sin(now * 0.05) * 5 * n.shake;
      nodeScr[i] = { sx, sy };
      zlist.push({ z: n.wy + 8, k: 1, i, sx, sy });
    }
    for (let i = 0; i < minions.length; i++) zlist.push({ z: minions[i].wy, k: 2, m: minions[i] });
    zlist.push({ z: hero.wy, k: 3 });
    zlist.sort((a, b) => a.z - b.z);
    for (let q = 0; q < zlist.length; q++) {
      const it = zlist[q];
      if (it.k === 0) drawDecor(it.dc, cx, cy);
      else if (it.k === 1) drawHouseSprite(nodes[it.i], it.sx, it.sy);
      else if (it.k === 2) drawMinion(it.m, cx, cy, now);
      else drawHero(cx, cy, now);
    }
    drawHelpers(cx, cy);  // ผู้ช่วยโคจรรอบแม่มด (วาดหลัง actors)

    // ---- overlay (บนสุดเสมอ): ป้ายมาตรา + พลอย + particle — อ่านง่าย ไม่ถูกบัง ----
    for (let i = 0; i < nodes.length; i++) {
      if (nodeScr[i]) drawNodeUI(nodes[i], nodeScr[i].sx, nodeScr[i].sy, i, now);
    }

    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (g.taken) continue;
      // พลอยหล่นใกล้หมดอายุ → กะพริบเตือน
      if (g.drop && g.life < 96 && ((now / 90) | 0) % 2) continue;
      const gsy = g.wy - cy;
      if (gsy < -40 || gsy > H + 40) continue;
      const gsx = g.wx - cx;
      if (gsx < -40 || gsx > W + 40) continue;
      drawGem(gsx, gsy, g.bob, now, g.coin);
    }

    // กุญแจบ้านเป้าหมาย — ที่จุดเดิม (ยังไม่เก็บ) หรือลอยเหนือหัวแม่มด (ถืออยู่)
    {
      const fi = focusIdx;
      const fn = nodes[fi];
      if (fn && !REDUCED_MOTION && unlocked[fn.matraId] && !keyDelivered[fn.matraId]) {
        if (heroKey === fi) {
          drawKey(hero.wx - cx, hero.wy - cy - HERO_R * 2.6, now, true, false);
        } else {
          const kp = keyPos(fi);
          const cursed = difficultyFor(fi, nodes.length).boss && !bossDone[fn.matraId];
          drawKey(kp.wx - cx, kp.wy - cy, now, false, cursed);
        }
      }
    }

    drawBeam(cx, cy);
    drawHitFx(cx, cy);
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

  // ตัวบ้าน (สไปรต์) — อยู่ในลำดับ y-sort จึงถูกต้นไม้/ฮีโร่บังได้ตามระยะ
  function drawHouseSprite(n, sx, sy) {
    const locked = !unlocked[n.matraId];
    const sealed = !locked && nodeSealed(n.idx);

    // แสงเรือง (ใต้บ้าน)
    fx.beginPath();
    fx.arc(sx, sy + 6, NODE_HALO, 0, Math.PI * 2);
    fx.fillStyle = locked ? 'rgba(58,42,94,0.40)' : 'rgba(255,225,150,0.18)';
    fx.fill();

    // ตัวบ้าน (คงสัดส่วนภาพ เยื้องขึ้นให้ฐานอยู่ราวจุดโหนด) — ล็อก = หรี่, ปิดผนึก = หรี่นิดหน่อย
    if (HOUSE_IMG.complete && HOUSE_IMG.naturalWidth) {
      if (locked) fx.globalAlpha = 0.42;
      else if (sealed) fx.globalAlpha = 0.72;
      fx.drawImage(HOUSE_IMG, sx - HOUSE_DW / 2, sy - HOUSE_DH / 2 + HOUSE_NUDGE_Y, HOUSE_DW, HOUSE_DH);
      fx.globalAlpha = 1;
    } else {
      fx.beginPath();
      fx.arc(sx, sy, NODE_R - 4, 0, Math.PI * 2);
      fx.fillStyle = locked ? '#3a2a5e' : '#c98a5a';
      fx.fill();
    }

    // กอหญ้าตามขอบล่างบ้าน — บังรอยต่อกับพื้น (โคนบ้านในภาพ ~y sy+34)
    fx.save();
    fx.globalAlpha = locked ? 0.5 : 1;
    for (let g = -2; g <= 2; g++) grassTuft(sx + g * 22 + (g % 2 ? 6 : 0), sy + 34, 18, 5);
    fx.restore();

    if (locked) {
      // แม่กุญแจคาดหน้าบ้าน
      fx.fillStyle = 'rgba(16,8,34,0.55)';
      fx.beginPath();
      fx.arc(sx, sy - 2, 13, 0, Math.PI * 2);
      fx.fill();
      fx.strokeStyle = '#d8ccf2';
      fx.lineWidth = 2.6;
      fx.beginPath();
      fx.arc(sx, sy - 5, 5.5, Math.PI, 0);
      fx.stroke();
      fx.fillStyle = '#d8ccf2';
      fx.fillRect(sx - 7.5, sy - 5, 15, 11);
    }
  }

  // ป้าย/เอฟเฟกต์ของมาตรา (วงกระเพื่อม/ดาว/โล่ผนึก/ชื่อ) — วาด overlay บนสุดเสมอ อ่านง่าย
  function drawNodeUI(n, sx, sy, i, now) {
    const locked = !unlocked[n.matraId];
    const sealed = !locked && nodeSealed(i);

    // วงกระเพื่อมที่ลูกปัจจุบัน (เปิดแล้ว = ฟ้าสว่าง, ยังปิดผนึก = โล่ม่วง)
    if (i === focusIdx && !locked) {
      const t = (now % 1400) / 1400;
      fx.beginPath();
      fx.arc(sx, sy, NODE_HALO + 4 + t * 10, 0, Math.PI * 2);
      // overlay layer แล้ว → หรี่ลงจากเดิมนิดหน่อย ไม่ให้เด่นเกินตัวบ้าน
      fx.strokeStyle = sealed
        ? 'rgba(190,165,245,' + (0.38 * (1 - t)).toFixed(3) + ')'
        : 'rgba(140,235,255,' + (0.45 * (1 - t)).toFixed(3) + ')';
      fx.lineWidth = sealed ? 2 : 3;
      fx.stroke();
    }

    if (!locked) {
      // ดาว 0–3 (ระหว่าง return beat ใช้ค่าที่กำลังไหล)
      let sc = stars[n.matraId] || 0;
      if (returnAnim && returnAnim.idx === i) sc = returnAnim.shown;
      const py = sy + NODE_HALO + 16;
      for (let s = 0; s < 3; s++) {
        const fillAmt = Math.max(0, Math.min(1, sc - s));
        drawPip(sx - 14 + s * 14, py, fillAmt);
      }
    }

    // โล่ปิดผนึก (คำสาป) + สถานะเป้าหมาย
    if (sealed) {
      const t = (now % 1600) / 1600;
      const cursed = difficultyFor(i, nodes.length).boss && !bossDone[n.matraId];
      fx.beginPath();
      fx.arc(sx, sy, NODE_HALO + 8 + Math.sin(t * Math.PI * 2) * 2, 0, Math.PI * 2);
      fx.strokeStyle = cursed ? 'rgba(200,70,120,0.42)' : 'rgba(150,120,235,0.35)';
      fx.lineWidth = 3;
      fx.stroke();
      let msg;
      if (heroKey === i) msg = '🔑 พากุญแจกลับบ้าน!';
      else if (cursed) msg = '👹 ล้มบอสทำลายคำสาป!';
      else msg = '🔑 เก็บกุญแจเหนือบ้าน';
      fx.fillStyle = cursed ? '#ffc2d2' : '#ffe6a6';
      fx.fillText(msg, sx, sy - NODE_HALO - 30);
    }

    // ชื่อมาตรา (fx.font set แล้วใน render() ก่อนวน loop)
    fx.fillStyle = locked ? 'rgba(203,193,232,0.72)' : '#ece3fb';
    fx.fillText(n.name, sx, sy + NODE_HALO + (locked ? 22 : 32));
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
    // สกิล 🧹 — ลอยไม้กวาด: ยกตัวขึ้น + เงาย่อ (เข้า-ออกนุ่ม ๆ ตาม broomT)
    const fly = hero.broomT > 0 ? Math.min(1, hero.broomT / 20) * Math.min(1, (sk.broom - hero.broomT) / 12 + 0.15) : 0;
    const sy = hero.wy - cy - fly * 16;
    const fainting = hero.fainting > 0;
    const bob = hero.moving && !fainting && !REDUCED_MOTION ? Math.sin(hero.bob) * 3 : 0;
    // กระพริบตอนอมตะ (โดนกัด) / เอียงตอนสลบ
    const blink = hero.invuln > 0 && ((now / 70) | 0) % 2;
    const faintRot = fainting ? Math.min(1, (FAINT_T - hero.fainting) / 12) * 1.35 : 0;

    // เงา — อยู่ที่ "พื้น" เสมอ (ตอนลอยไม้กวาด เงาย่อลงไม่ลอยตาม)
    const groundY = hero.wy - cy + HERO_R - 3;
    fx.beginPath();
    fx.ellipse(sx, groundY, HERO_R * 0.72 * (1 - fly * 0.4), HERO_R * 0.26 * (1 - fly * 0.4), 0, 0, Math.PI * 2);
    fx.fillStyle = 'rgba(0,0,0,' + (0.28 - fly * 0.12).toFixed(2) + ')';
    fx.fill();

    // เลือกท่าตาม state ที่มีอยู่แล้ว — ต่อสู้ > เดิน > ยืน
    // (ไม่มีท่าโดนกัด/สลบ ใช้ท่ายืน + เอฟเฟกต์กระพริบ/เอียงเหมือนเดิม)
    const pose = hero.poseAtk > 0 ? 'atk' : (hero.moving && !fainting ? 'walk' : 'stand');
    const g0 = HERO_GIFS[pose];
    // ยืน/เดิน = ลูปตามนาฬิกาจริง. ต่อสู้ = ยัดสวิง 8 เฟรมทั้งชุดลงช่วงถือท่า (~0.37 วิ)
    // เพราะคลิป atk ยาว 1.6 วิ แต่ hold แค่ 0.37 วิ ถ้าเล่นตามเวลาจริงจะเห็นแค่ 2 เฟรมแรก
    let poseT = now;
    if (pose === 'atk' && g0.total) {
      const frac = (HERO_POSE_ATK_T - hero.poseAtk) / HERO_POSE_ATK_T; // 0 → 1
      poseT = Math.min(frac, 0.999) * g0.total;
    }
    // เฟรม ImageBitmap ปัจจุบัน (หรือ <img> fallback) — ถอยไปท่ายืนถ้าท่านี้ยังไม่พร้อม
    let img = heroPoseImg(g0, poseT) || heroPoseImg(HERO_GIFS.stand, now);
    // ImageBitmap มี .width/.height; <img> ต้องใช้ .naturalWidth (element ถูกย่อเหลือ 2px)
    const iw = img ? (img.naturalWidth || img.width) : 0;
    const ih = img ? (img.naturalHeight || img.height) : 0;

    const hh = HERO_R * 2.4;
    // สัดส่วนอ่านจากขนาดจริงของ "ท่าที่กำลังใช้" ไม่ฮาร์ดโค้ด — 3 ท่าครอปไม่เท่ากัน
    // (เคยฮาร์ดโค้ด 0.86 ของ princess_1.png ไว้ พอเปลี่ยนรูปตัวละครก็ผิดทันที)
    const hw = ih ? hh * (iw / ih) : hh * 0.8;
    fx.save();
    fx.globalAlpha = blink ? 0.4 : 1;
    if (img && iw) {
      fx.translate(sx, sy + bob);
      fx.rotate(faintRot);
      fx.scale(hero.facing, 1);
      fx.drawImage(img, -hw / 2, -hh + HERO_R * 0.8, hw, hh);
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
  // เอฟเฟกต์ตี — วงรีแสงทองแนวนอนขยายออก + จาง (แทนดาวกระจาย)
  function drawHitFx(cx, cy) {
    for (let i = hitFx.length - 1; i >= 0; i--) {
      const f = hitFx[i];
      f.t++;
      if (f.t > 15) { hitFx.splice(i, 1); continue; }
      const p = f.t / 15;
      const rx = 12 + p * 42;
      const ry = rx * 0.4;
      const x = f.wx - cx, y = f.wy - cy;
      fx.save();
      fx.globalAlpha = (1 - p) * 0.85;
      fx.strokeStyle = '#ffe08a';
      fx.lineWidth = 4 * (1 - p) + 1.2;
      fx.beginPath(); fx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); fx.stroke();
      fx.globalAlpha = (1 - p) * 0.5;
      fx.fillStyle = '#fff6d0';
      fx.beginPath(); fx.ellipse(x, y, rx * 0.5, ry * 0.5, 0, 0, Math.PI * 2); fx.fill();
      fx.restore();
    }
  }

  // เส้นแสงยิง (สกิล ✨) จากแม่มดไปเป้า
  function drawBeam(cx, cy) {
    if (!hero.beamFx) return;
    const p = hero.beamFx.t / 10;
    fx.save();
    fx.globalAlpha = (1 - p) * 0.9;
    fx.strokeStyle = '#ffe8a0';
    fx.lineWidth = 5 * (1 - p) + 1;
    fx.lineCap = 'round';
    fx.beginPath();
    fx.moveTo(hero.wx - cx, hero.wy - cy - HERO_R * 0.6);
    fx.lineTo(hero.beamFx.tx - cx, hero.beamFx.ty - cy);
    fx.stroke();
    fx.restore();
  }

  // ผู้ช่วย (สกิล 🧚) — TODO: เปลี่ยนเป็น GIF ทีหลัง · ตอนนี้ orb เรืองแสง + หมวกจิ๋ว
  function drawHelpers(cx, cy) {
    for (let h = 0; h < helpers.length; h++) {
      const hp = helpers[h];
      const x = hp.wx - cx, y = hp.wy - cy;
      if (hp.zap) {
        fx.strokeStyle = 'rgba(255,225,140,' + (1 - hp.zap.t / 8).toFixed(2) + ')';
        fx.lineWidth = 2.5;
        fx.beginPath(); fx.moveTo(x, y); fx.lineTo(hp.zap.tx - cx, hp.zap.ty - cy); fx.stroke();
      }
      fx.fillStyle = 'rgba(180,140,255,0.32)';
      fx.beginPath(); fx.arc(x, y, 11, 0, Math.PI * 2); fx.fill();
      fx.fillStyle = '#c9b3f5';
      fx.beginPath(); fx.arc(x, y, 6.5, 0, Math.PI * 2); fx.fill();
      fx.fillStyle = '#6a4a9e';
      fx.beginPath();
      fx.moveTo(x, y - 12); fx.lineTo(x - 5, y - 4); fx.lineTo(x + 5, y - 4);
      fx.closePath(); fx.fill();
    }
  }

  function drawMinion(m, cx, cy, now) {
    const sx = m.wx - cx;
    const sy = m.wy - cy;
    const k = m.kind || MINION_KINDS[0];
    const staggered = m.stagger > 0;
    const bs = m.isBoss ? 1.65 : 1;        // บอสตัวใหญ่กว่า
    // ตัวบินลอยเหนือพื้น + ขยับขึ้นลง (โดนตีแล้วร่วงลงพื้น = เห็นชัดว่าโดน)
    const hover = k.fly && !staggered ? -FLY_HOVER + Math.sin(m.bob * 1.3) * 3 : 0;

    // เงา — วาดที่ "พื้น" เสมอ ไม่ลอยตามตัว นี่คือสิ่งที่ทำให้อ่านออกว่าตัวไหนบิน
    fx.save();
    fx.translate(sx, sy);
    fx.scale(bs, bs);
    fx.fillStyle = k.fly ? 'rgba(0,0,0,0.13)' : 'rgba(0,0,0,0.22)';
    fx.beginPath();
    fx.ellipse(0, 11, k.fly ? 6 : 9, k.fly ? 2 : 3, 0, 0, Math.PI * 2);
    fx.fill();
    fx.restore();

    fx.save();
    fx.translate(sx, sy + hover);
    if (staggered) fx.rotate(m.spin);
    else fx.translate(0, Math.sin(m.bob) * 2);
    fx.scale((m.facing || 1) * bs, bs);

    // ปีก (ตัวบิน) — วาดก่อนตัว จะได้อยู่ข้างหลัง กระพือตาม bob
    if (k.fly) {
      const flap = Math.sin(m.bob * 2.4);
      fx.fillStyle = k.wing;
      for (let s2 = -1; s2 <= 1; s2 += 2) {
        fx.save();
        fx.scale(s2, 1);
        fx.beginPath();
        fx.ellipse(10, -3, 7.5, 3.4 + flap * 2, -0.55, 0, Math.PI * 2);
        fx.fill();
        fx.restore();
      }
    }

    // หมวก
    fx.fillStyle = k.hat;
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
    fx.fillStyle = staggered && ((now / 60) | 0) % 2 ? '#ffb0b0' : k.body;
    fx.beginPath();
    fx.arc(0, 1, 8.5, 0, Math.PI * 2);
    fx.fill();
    fx.fillStyle = k.light;
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
    // ต้องบวก hover ด้วย ไม่งั้นแถบของตัวบินจะค้างอยู่ต่ำกว่าตัวมันเอง
    const mx = m.maxHp || 2;
    if (m.isBoss || m.hp < mx) {
      const bw = m.isBoss ? 34 : 20;
      const by = sy + hover - (m.isBoss ? 30 : 22);
      fx.fillStyle = 'rgba(0,0,0,0.45)';
      fx.fillRect(sx - bw / 2, by, bw, m.isBoss ? 4 : 3);
      fx.fillStyle = m.isBoss ? '#ff7ac0' : '#7bd06a';
      fx.fillRect(sx - bw / 2, by, bw * Math.max(0, m.hp / mx), m.isBoss ? 4 : 3);
    }
  }

  // พลอยเติมพลัง — เพชรชมพูลอยเด้ง (สีต่างจากคริสตอลฟ้า / ดาวเหลือง / ลูกสมุนเขียว)
  // กุญแจทอง — หูจับ (วงแหวน) + ก้าน + เดือย 2 อัน · carried = เล็กลง ไม่ลอย
  function drawKey(sx, sy, now, carried, cursed) {
    const sc = carried ? 0.72 : 1;
    const bob = carried ? 0 : Math.sin(now * 0.004) * 4;
    // cursed = ยังไม่ล้มบอส → กุญแจสีคล้ำ + ออร่าม่วงคำสาป + โซ่ ยังเก็บไม่ได้
    const ringOut = cursed ? '#3a2350' : '#8a5f16';
    const ringIn = cursed ? '#7a5aa8' : '#e8b53a';
    const body = cursed ? '#8f78b3' : '#e8b53a';
    fx.save();
    fx.translate(sx, sy + bob);
    fx.scale(sc, sc);
    if (!carried) {
      const pulse = 0.3 + 0.28 * Math.sin(now * 0.006);
      fx.fillStyle = cursed
        ? 'rgba(150,90,220,' + pulse.toFixed(2) + ')'
        : 'rgba(255,224,130,' + pulse.toFixed(2) + ')';
      fx.beginPath(); fx.arc(0, 0, 19, 0, Math.PI * 2); fx.fill();
    }
    // หูจับ (วงแหวนกลวง วาดด้วยเส้น ไม่เจาะรูทะลุ overlay)
    fx.strokeStyle = ringOut; fx.lineWidth = 5.5;
    fx.beginPath(); fx.arc(0, -7, 6.6, 0, Math.PI * 2); fx.stroke();
    fx.strokeStyle = ringIn; fx.lineWidth = 3.4;
    fx.beginPath(); fx.arc(0, -7, 6.6, 0, Math.PI * 2); fx.stroke();
    // ก้าน + เดือย
    fx.fillStyle = body;
    fx.strokeStyle = ringOut; fx.lineWidth = 1.4;
    fx.fillRect(-2, -1, 4, 16); fx.strokeRect(-2, -1, 4, 16);
    fx.fillRect(2, 8, 6, 3); fx.strokeRect(2, 8, 6, 3);
    fx.fillRect(2, 12, 4, 3); fx.strokeRect(2, 12, 4, 3);
    if (cursed) {
      // โซ่คำสาปพันกุญแจ
      fx.strokeStyle = 'rgba(40,20,60,0.8)'; fx.lineWidth = 2.4;
      fx.beginPath();
      fx.moveTo(-9, -12 + Math.sin(now * 0.003) * 1.5);
      fx.lineTo(9, 10 - Math.sin(now * 0.003) * 1.5);
      fx.moveTo(9, -12 - Math.sin(now * 0.003) * 1.5);
      fx.lineTo(-9, 10 + Math.sin(now * 0.003) * 1.5);
      fx.stroke();
    } else {
      // ประกาย
      fx.fillStyle = 'rgba(255,255,235,0.9)';
      fx.beginPath(); fx.arc(-2.5, -9, 1.6, 0, Math.PI * 2); fx.fill();
    }
    fx.restore();
  }

  function drawGem(sx, sy0, phase, now, coin) {
    const sy = sy0 - 3 - Math.sin(now * 0.004 + phase) * 3;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.006 + phase);
    if (coin) {
      // เหรียญทอง — วงกลม + ขอบเข้ม + ประกาย
      fx.beginPath();
      fx.arc(sx, sy, 10 + pulse * 2, 0, Math.PI * 2);
      fx.fillStyle = 'rgba(255,215,120,0.18)';
      fx.fill();
      fx.beginPath();
      fx.arc(sx, sy, 7, 0, Math.PI * 2);
      fx.fillStyle = '#e8b53a';
      fx.fill();
      fx.lineWidth = 1.6; fx.strokeStyle = '#8a5f16'; fx.stroke();
      fx.fillStyle = '#f6dd8e';
      fx.beginPath(); fx.arc(sx - 2, sy - 2, 2.4, 0, Math.PI * 2); fx.fill();
      return;
    }
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

  // กอหญ้าเล็ก ๆ ที่โคน (บังรอยต่อกับพื้น ไม่ให้ดูลอย) — n ใบ ชี้ขึ้น เอียงสลับ
  function grassTuft(x, y, spanW, n) {
    for (let k = 0; k < n; k++) {
      const f = n > 1 ? k / (n - 1) - 0.5 : 0;
      const bx = x + f * spanW;
      const lean = f * 7 + (k % 2 ? 1.5 : -1.5);
      const h = 6 + (k % 3) * 3;
      fx.fillStyle = k % 2 ? '#4f8a39' : '#356b2b';
      fx.beginPath();
      fx.moveTo(bx - 1.6, y);
      fx.quadraticCurveTo(bx + lean * 0.4, y - h * 0.6, bx + lean, y - h);
      fx.quadraticCurveTo(bx + lean * 0.4, y - h * 0.5, bx + 1.6, y);
      fx.closePath();
      fx.fill();
    }
  }

  function drawDecor(dc, cx, cy) {
    const s = dc.s;
    fx.save();
    fx.translate(dc.wx - cx, dc.wy - cy);
    fx.scale(dc.flip * s, s);
    // เงาที่พื้นหญ้า — ให้ decor ดู "วางอยู่บน" พื้น ไม่ลอย (ต้นไม้เงากว้างกว่า)
    fx.fillStyle = 'rgba(30,50,20,0.20)';
    fx.beginPath();
    fx.ellipse(0, dc.type === 2 ? 0 : 3, dc.type === 2 ? 22 : 15, dc.type === 2 ? 7 : 5, 0, 0, Math.PI * 2);
    fx.fill();
    if (dc.type === 2) {
      // ต้นไม้ — รูปภาพจริง (tree.png) โคนลำต้นอยู่ที่ origin, พุ่มชี้ขึ้น
      if (TREE_IMG.complete && TREE_IMG.naturalWidth) {
        const h = 120;
        const w = h * (TREE_IMG.naturalWidth / TREE_IMG.naturalHeight);
        fx.drawImage(TREE_IMG, -w / 2, -h * 0.84, w, h);
      } else {
        // fallback วาดเอง (ภาพยังโหลดไม่เสร็จ)
        fx.fillStyle = '#6b4a2f';
        fx.fillRect(-3, -2, 6, 20);
        fx.fillStyle = '#356b2f';
        for (let k = 0; k < TREE_BLOBS.length; k++) {
          fx.beginPath();
          fx.arc(TREE_BLOBS[k][0], TREE_BLOBS[k][1], TREE_BLOBS[k][2], 0, Math.PI * 2);
          fx.fill();
        }
      }
      grassTuft(0, 2, 26, 6); // กอหญ้าบังโคน
      fx.restore();
      return;
    }
    if (dc.type === 0) {
      // โขดหิน — หินเทา
      fx.fillStyle = '#877f77';
      fx.beginPath();
      fx.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2);
      fx.fill();
      fx.fillStyle = '#9c948b';
      fx.beginPath();
      fx.ellipse(-4, -4, 9, 7, 0, 0, Math.PI * 2);
      fx.fill();
      fx.fillStyle = 'rgba(255,255,255,0.30)';
      fx.beginPath();
      fx.ellipse(-5, -6, 4, 2.5, 0, 0, Math.PI * 2);
      fx.fill();
    } else {
      // พุ่มไม้ (type 1) — เขียวสด
      fx.fillStyle = '#3f7d38';
      for (let k = 0; k < BUSH_BLOBS.length; k++) {
        fx.beginPath();
        fx.arc(BUSH_BLOBS[k][0], BUSH_BLOBS[k][1], 8, 0, Math.PI * 2);
        fx.fill();
      }
      fx.fillStyle = 'rgba(190,235,150,0.40)';
      fx.beginPath();
      fx.arc(-2, -5, 4, 0, Math.PI * 2);
      fx.fill();
    }
    fx.restore();
  }

  function drawWitch() {
    const wx = witchWX;
    const wy = witchWY;

    // รูปแม่มดใจร้ายจริง — ถ้าโหลดไม่ได้ ตกไปวาดรูปทรงเองด้านล่าง
    if (MAP_WITCH_IMG.complete && MAP_WITCH_IMG.naturalWidth) {
      const iw = MAP_WITCH_IMG.naturalWidth;
      const ih = MAP_WITCH_IMG.naturalHeight;
      // จัดขนาดแบบ contain — ย่อเล็กลง 60% จากเดิม (× 0.4) ตามที่ผู้ใช้ขอ
      const boxW = W * 0.88 * 0.4;
      const boxH = Math.min(260, H * 0.42) * 0.4;
      const scale = Math.min(boxW / iw, boxH / ih);
      const dw = iw * scale;
      const dh = ih * scale;
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
