// mahjong.js — มินิเกม "ไพ่นกกระจอกจับคู่คำไทย" ด่านอุ่นเครื่องก่อนเกมหยิบฟอง
// เล่นครั้งแรกที่ปลดล็อกแต่ละมาตราเท่านั้น (คุมจาก main.js ผ่าน app.mahjongSeen)
//
// กลไก: ไพ่วางซ้อนเป็นชั้นปิรามิด (พอร์ตอัลกอริทึมจาก prototypes/thai-mahjong-
// prototype.html) — แตะ/จีบนิ้ว (AR) ที่ไพ่ที่ "หยิบได้" (ไม่ถูกทับ + เปิดข้างซ้าย
// หรือขวา) แล้วลอยเข้าถาดพัก 5 ช่องเองทันที ไม่ต้องลากไปวางเอง พอในถาดมีคำซ้ำกัน
// 2 ใบจึงจับคู่หายไป — ไม่มีเงื่อนไขแพ้/ตัวจับเวลา ถาดเต็มไม่มีคู่ = ปุ่มสลับป้าย
// (สุ่มคำใหม่ทั่วถาด+กระดาน) เท่านั้น

import { createParticleSystem } from './particles.js';
import { saveTotalScore } from './storage.js';

const TRAY_CAPACITY = 5;
const FLY_MS = 350;
const MATCH_REMOVE_MS = 320;
const PRE_EXPLODE_STEP_MS = 160; // ถอยห่าง+วิ่งเข้าชนกันก่อนระเบิด (ข้อ 3) คนละช่วง
const MATCH_POINTS = 20;
const DEFAULT_TILE_W = 74;
const TILE_ASPECT = 92 / 74; // สัดส่วนกว้าง:สูงของไพ่
// เยื้องต่อชั้นเป็น "สัดส่วน" ของขนาดไพ่ (ไม่ใช่พิกเซลตายตัว) ให้ยังเห็นคำของ
// ไพ่ที่ถูกทับอยู่ได้จริง (ข้อ 3) แทนที่จะซ้อนเกือบสนิทแบบ mahjong solitaire ทั่วไป
const LAYER_OFFSET_X_RATIO = 0.34;
const LAYER_OFFSET_Y_RATIO = 0.32;

// สีตัวอักษรหลากสี (ตัดกับพื้นขาว มี text-shadow ใน CSS ช่วยอีกชั้น) — คำเดียวกัน
// ได้สีเดียวกันเสมอ (ผูกกับ word ไม่ใช่กับไพ่ ดู wordColorMap ใน startMatra/shuffle)
// ช่วยให้เด็กจับคู่ได้ง่ายขึ้นด้วยสายตา อิโมจิตกแต่งมุมไพ่ยังสุ่มอิสระไม่ผูกกับคำ
const TILE_TEXT_COLORS = ['#c0264d', '#1f7a4d', '#1d5fb8', '#b8590a', '#7c3aed', '#0f8a8a'];
const TILE_EMOJIS = ['✨', '⭐', '🌙', '🔮', '🌟', '🎶'];

// อิโมจิแทนคำ (ข้อ 7) — ใช้ตอนมาตรานั้นมีคำจริงไม่พอ pairCount ที่ต้องการ (เช่น
// กลุ่ม FILL_FINAL ตายตัวมาตราละ 5 คำ แต่ curriculumIndex สูงต้องการมากกว่านั้น
// มาก) ต้องมีจำนวนมากพอไม่ให้ซ้ำกันเมื่อต้องพากันหลายคู่ในมาตราท้ายๆ (สูงสุด
// pairCount ~31 ที่มาตราสุดท้าย) — ไพ่กลุ่มนี้จับคู่แล้วไม่อ่านคำ ได้ยินเสียงชม
// สุ่มแทน (ดู flyToTray/playMatchEffect กับ audio.voice('mahjong_emoji_match'))
const WORD_EMOJIS = [
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
  '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦄',
  '🐴', '🦋', '🐢', '🐳', '🐬', '🐙', '🦀', '🐝', '🐞', '🐌',
  '🍎', '🍌', '🍇', '🍉', '🍓', '🍕', '🍰', '🍦', '🍭', '⚽',
];

// ---------- pure logic (พอร์ตจาก prototype, export ไว้เทสต์แยกได้) ----------

// จัดวางไพ่เป็นชั้นปิรามิด — สัดส่วนต่อชั้น [0.45,0.3,0.17,0.08] (ชั้น 0 = ฐาน
// กว้างสุด) layerCount ห้ามเกิน 4 เพราะตารางสัดส่วนนี้มีแค่ 4 ค่า
//
// กันพัง: แต่ละชั้นต้องมีอย่างน้อย 2 ใบ (บังคับด้วย Math.max(2,...) ด้านล่าง) ถ้า
// pairCount น้อยเกินไปเทียบกับ layerCount ที่ขอ (เช่น pairs=3, layers=4 → ต้องการ
// อย่างน้อย 2*4=8 ใบ แต่มีแค่ 6) counts[0] จะถูกลบด้วย diff จนเหลือ 0 หรือติดลบ
// ทำให้ layer0Cols=0 แล้ว rows ของชั้นถัดไปคำนวณ sqrt(count/0)=Infinity จน loop
// วางไพ่ค้างไม่รู้จบ (เจอจริงตอนปรับตาราง TIERS ให้ยากขึ้น, ข้อ 1) จึงต้องลด
// layerCount ลงเองถ้า total ไม่พอ ก่อนคำนวณสัดส่วนต่อชั้น
// เพดานแถว/คอลัมน์สูงสุดต่อชั้น — ไพ่แต่ละชั้นเรียงได้สูงสุด 6 แถว × 4 คอลัมน์
// (24 ใบ/ชั้น) ห้ามเกินไม่ว่าจอจะกว้างแค่ไหน — คอลัมน์แคบลงจาก 5 (คู่กับเพิ่ม
// จำนวนชั้นเป็น 4 ที่ MAX_LAYERS ด้านล่าง) กันไพ่ถูกหนีบซ้อนกันเยอะเกินไปในแถว
// เดียว ให้ปิรามิดสูงขึ้น/แคบลงแทนที่จะกว้าง/แบนเกินไป
const MAX_LAYER_ROWS = 6;
const MAX_LAYER_COLS = 4;

export function buildPyramidLayout(pairCount, layerCount, maxLayer0Cols = 8) {
  const total = pairCount * 2;
  const safeLayerCount = Math.max(1, Math.min(layerCount, Math.floor(total / 2)));
  const weights = [0.45, 0.3, 0.17, 0.08].slice(0, safeLayerCount);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.max(2, Math.round((w / wsum) * total)));
  const diff = total - counts.reduce((a, b) => a + b, 0);
  counts[0] += diff;

  // คอลัมน์สูงสุดของหน้าจอจริง (จาก computeMaxBoardCols ในโรงงาน) แต่ไม่เกิน
  // เพดานตายตัว 5 คอลัมน์ เสมอ — จอกว้าง (แท็บเล็ต/เดสก์ท็อป) ก็ไม่ให้เกิน 5
  const cappedCols = Math.min(maxLayer0Cols, MAX_LAYER_COLS);

  // ไล่ยกส่วนที่เกินเพดาน (6 แถว × cappedCols คอลัมน์) ของแต่ละชั้นไปให้ชั้นถัดไป
  // แทน — เกิดขึ้นเฉพาะมาตรายากท้ายๆ ที่ pairCount สูงมากจน layer0 ได้รับส่วน
  // แบ่งเกิน 30 ใบ (ตัวอย่างจริง: มาตราสุดท้าย pairCount=31 → layer0 ได้ 31 ใบ
  // เกินเพดานไป 1 ใบ) ชั้นสุดท้ายไม่มีที่ไปต่อ ปล่อยเกินได้เป็นทางออกสุดท้าย
  // (ห้ามลดจำนวนไพ่ทิ้งเด็ดขาด ทุกคู่ต้องมีที่วางและจับคู่ได้จริงเสมอ)
  for (let L = 0; L < counts.length - 1; L++) {
    const capacity = cappedCols * MAX_LAYER_ROWS;
    if (counts[L] > capacity) {
      const overflow = counts[L] - capacity;
      counts[L] = capacity;
      counts[L + 1] += overflow;
    }
  }

  const slots = [];
  // จำนวนคู่มากขึ้นเรื่อยๆ ตามมาตรา (ข้อ 7, deriveDifficulty) แถวฐาน (layer0)
  // ตายตัวที่ 2 แถวเดิมจะกว้างขึ้นเรื่อยๆ ไม่มีเพดาน (คอลัมน์ = counts[0]/2) จน
  // ล้นความกว้างจอได้ — เพิ่มแถวฐานเองเมื่อคอลัมน์เกิน cappedCols แทน ให้ปิรามิด
  // สูงขึ้นแทนที่จะกว้างขึ้นไม่จำกัด แต่ไม่เกิน MAX_LAYER_ROWS (คุมได้ด้วย
  // overflow-y:auto สำหรับกรณีตกค้างที่ปล่อยเกินไว้ด้านบน)
  const layer0Rows = Math.min(MAX_LAYER_ROWS, Math.max(2, Math.ceil(counts[0] / cappedCols)));
  const layer0Cols = Math.ceil(counts[0] / layer0Rows);
  const baseWidth = layer0Cols;

  for (let L = 0; L < safeLayerCount; L++) {
    const count = counts[L];
    let rows = L === 0 ? layer0Rows : Math.max(1, Math.round(Math.sqrt(count / (layer0Cols / layer0Rows))));
    // กันแถวน้อยเกินไปจนคอลัมน์ที่คำนวณได้ (count/rows) ต้องเกิน cappedCols (ใช้
    // ค่าเดียวกับ layer0 ไม่ใช่เพดานตายตัว 5 เฉยๆ — กันชั้นบนกว้างเกิน baseWidth
    // ของ layer0 จนล้นขอบจอ) ต้องคำนวณก่อนกันแถวเกินเสมอ ไม่งั้นไพ่จะหายจากกระดาน
    rows = Math.max(rows, Math.ceil(count / cappedCols));
    // กันแถวเกิน MAX_LAYER_ROWS (6) — ปลอดภัยเสมอเพราะ cascade ด้านบนรับประกันว่า
    // count<=cappedCols*6 แล้วสำหรับทุกชั้นยกเว้นชั้นสุดท้าย (ซึ่งปล่อยเกินได้)
    rows = Math.min(rows, MAX_LAYER_ROWS);
    const cols = Math.ceil(count / rows);
    const offsetX = Math.floor((baseWidth - cols) / 2);
    const offsetY = L;
    let placed = 0;
    for (let r = 0; r < rows && placed < count; r++) {
      for (let c = 0; c < cols && placed < count; c++) {
        slots.push({ x: c + offsetX, y: r + offsetY, layer: L });
        placed++;
      }
    }
  }
  return slots;
}

// ไพ่หยิบได้ = ยังอยู่บนกระดาน + ไม่ถูกทับจากชั้นบน + เปิดข้างซ้ายหรือขวาใน
// ชั้นเดียวกัน — ต่างจาก prototype ตรงเช็ค state==='board' แทน !matched เพราะ
// ที่นี่ไพ่ที่ลอยขึ้นถาดแล้วต้องไม่นับเป็นตัวบัง/ตัวปิดข้างให้ไพ่อื่นอีกต่อไป
export function isTileFree(tile, allTiles) {
  if (tile.state !== 'board') return false;
  const isCovered = allTiles.some(
    (o) => o.state === 'board' && o.x === tile.x && o.y === tile.y && o.layer > tile.layer
  );
  if (isCovered) return false;
  const isOpenSide = (dx) =>
    !allTiles.some((o) => o.state === 'board' && o.layer === tile.layer && o.y === tile.y && o.x === tile.x + dx);
  return isOpenSide(-1) || isOpenSide(1);
}


// ความยากอิงลำดับ 26 มาตราปัจจุบัน (v143, ดูคอมเมนต์หัวไฟล์ data/matra.js)
// (ข้อ 7): "มาตราปัจจุบันต้องมีไพ่มากกว่ามาตราก่อนหน้าอย่างน้อย 2 ใบ (1 คู่)"
// เป็นกฎตรงตัวทุกมาตรา ไม่ใช่แค่ระหว่างกลุ่ม — pairCount จึงผูกกับ curriculumIndex
// ตรงๆ (BASE + index) ไม่ cap ด้วยจำนวนคำจริงอีกต่อไป (ต่างจากเดิม) เพราะมาตรา
// คำน้อย (เช่นกลุ่ม FILL_FINAL ตายตัว 5 คำ/มาตรา) จะใช้ "ไพ่อิโมจิ" แทนคำที่ขาด
// (ดู startMatra — จับคู่อิโมจิไม่อ่านคำ แต่ได้ยินเสียงชมแบบสุ่มแทน)
// layerCount ซ้อนได้สูงสุด 4 ชั้น (คู่กับคอลัมน์แคบลงเหลือ 4 ที่ MAX_LAYER_COLS
// ด้านบน) — กันไพ่ถูกหนีบซ้อนกันเยอะเกินไปในแถวเดียวตอนมาตรายาก ปิรามิดจึงลึก
// ขึ้น (4 ชั้น) แทนที่จะกว้าง/แบนแบบเดิม
const BASE_PAIRS = 6; // kaka (idx0) = 6 คู่ (12 ใบ) ตามที่เคยขอไว้ก่อนหน้า
const MAX_LAYERS = 4;
export function deriveDifficulty(matra, curriculumIndex) {
  const pairCount = BASE_PAIRS + curriculumIndex; // เพิ่มอย่างน้อย 1 คู่ (2 ใบ) ทุกมาตรา
  return { pairCount, layerCount: MAX_LAYERS };
}

// ขอบเส้นประของ .mj-tray เอง (2px ทั้งสองฝั่ง, ดู .mj-tray ใน styles.css) — ช่องไพ่
// แต่ละใบ (.mj-tray-slot) เป็น box-sizing:border-box จึงไม่บวกความกว้างเพิ่ม แต่
// ตัว .mj-tray container เองไม่ได้ set width ชัดเจน (shrink-to-fit ตามลูก) ทำให้
// border ของ container เองบวกเพิ่มนอกเหนือผลรวมของช่องไพ่เสมอ ต้องกันพื้นที่นี้ไว้
const TRAY_OUTER_BORDER_PX = 4;

// วัดความกว้าง "ใช้งานได้จริง" จาก DOM (นับ padding จริงของ #mahjongScreen ที่เป็น
// ผู้ปกครองของ #mahjongBoard/#mahjongTray) แทนการประมาณด้วย window.innerWidth*0.94
// เดิม — ค่าประมาณเดิมคลาดเคลื่อนจาก padding จริงของ .screen (24px ทั้ง 2 ฝั่ง =
// 48px) มากพอจะทำให้ถาด/กระดานล้นขอบจอมือถือแนวตั้งจริง (บั๊กที่เจอจริง ข้อ 1)
// screenEl เป็น optional — เผื่อเรียกจากสคริปต์ทดสอบ pure logic ที่ไม่มี DOM จริง
function computeUsableWidth(screenEl) {
  if (screenEl) {
    const cs = getComputedStyle(screenEl);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    return screenEl.clientWidth - padL - padR - TRAY_OUTER_BORDER_PX;
  }
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
  return vw * 0.94 - TRAY_OUTER_BORDER_PX;
}

// ขนาดไพ่คงที่ตามความกว้างจอ (ถาด 5 ช่องเสมอ) เท่านั้น — ไม่ย่อลงตามจำนวนไพ่/
// คอลัมน์ของกระดานอีกต่อไป (ข้อ 5) มาตราที่มีไพ่เยอะจะได้ปิรามิดที่ "กว้าง/สูง
// ขึ้น" (คอลัมน์/แถวเพิ่ม) แทนที่ไพ่จะเล็กลงเรื่อยๆ จนอ่านยาก
function computeTileSize(screenEl) {
  const usableW = computeUsableWidth(screenEl);
  let w = Math.floor(usableW / TRAY_CAPACITY);
  w = Math.max(34, Math.min(DEFAULT_TILE_W, w));
  const h = Math.round(w * TILE_ASPECT);
  // font-size ผูกกับ w แบบสัดส่วน (ไม่ใช่ค่าคงที่) — 0.6 = ใหญ่ขึ้น 2 เท่าจาก
  // อัตราส่วนเดิม (22px ที่ DEFAULT_TILE_W=74px ≈ 0.297) (ข้อ 6 รอบก่อน)
  const fontSize = Math.max(14, Math.round(w * 0.6));
  return { w, h, fontSize };
}

// จำนวนคอลัมน์สูงสุดที่ฐานปิรามิด (layer0) ใช้ได้โดยไม่ล้นความกว้างจอ ที่ขนาด
// ไพ่คงที่ (ข้อ 5) — คำนวณจากขนาดไพ่จริงแทนค่าคงที่ตายตัว ให้จอกว้าง (แท็บเล็ต/
// เดสก์ท็อป) ใช้คอลัมน์ได้มากขึ้นตามจริง แทนที่จะจำกัดไว้ที่ 8 เท่ากันทุกจอ
//
// ต้องกันพื้นที่ให้ "layer offset" ด้วย (ข้อ 1 บั๊กที่เจอจริง) — ไพ่ชั้นบนเยื้อง
// ซ้ายด้วย baseShiftX (ดู positionTileOnBoard/sizeBoardContainer) ทำให้กระดานจริง
// กว้างกว่า "จำนวนคอลัมน์ × tileW" เสมอ อีก (MAX_LAYERS-1) × tileW × ratio เยื้อง —
// ถ้าไม่กันไว้ maxBoardCols จะปล่อยให้ layer0 กว้างพอดีเป๊ะกับจอ แล้วส่วนเยื้อง
// ล้นออกไปอีกจนกระดานล้นขอบจอจริง (วัดได้จริงบนมือถือแนวตั้ง 360px)
function computeMaxBoardCols(tileW, screenEl) {
  const usableW = computeUsableWidth(screenEl);
  const offsetReservePx = (MAX_LAYERS - 1) * LAYER_OFFSET_X_RATIO * tileW;
  return Math.max(2, Math.floor((usableW - offsetReservePx) / tileW));
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- factory ----------

export function createMahjongWarmup({ scene, audio, app, dom, onComplete }) {
  const particleFx = createParticleSystem(scene.fx); // pool แยกจากของ game.js เอง

  let tiles = [];
  let tray = [];
  let matchQueue = [];       // คู่ที่จับได้แล้ว รอเล่นเอฟเฟกต์/เสียงทีละคู่ (กันเสียงทับกันตอน shuffle เจอหลายคู่พร้อมกัน)
  let matchProcessing = false;
  let matchedPairs = 0;
  let totalPairs = 0;
  let currentMatraId = null;
  let _stuckVoicePlayed = false;
  let running = false;
  let rafId = 0;
  let tileW = DEFAULT_TILE_W;
  let tileH = Math.round(DEFAULT_TILE_W * TILE_ASPECT);
  let tileFontSize = Math.round(DEFAULT_TILE_W * 0.6);
  let maxLayerInBoard = 0; // ใช้คำนวณ baseShiftX กันไพ่ชั้นบนหลุดพิกัดติดลบ (ดู positionTileOnBoard)
  let wordColorMap = new Map(); // word.display -> สี — คู่คำเดียวกันได้สีเดียวกันเสมอ (ข้อ 2)

  // ตัว setTimeout ของ flyToTray/playMatchEffect ต้องถูกยกเลิกใน stop() —
  // ถ้าไม่ทำ แล้วผู้เล่นกด back ระหว่างไพ่กำลังลอย/กำลังจะจับคู่ callback ที่ค้าง
  // จะยิงทีหลังตอน matchedPairs/totalPairs ถูก reset เป็น 0 พร้อมกันแล้ว ทำให้
  // 0===0 เข้าเงื่อนไข "จบด่าน" เรียก onComplete() ซ้ำผิดจังหวะทั้งที่ออกไปแล้ว
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

  function witchSay(text) {
    if (!dom.toast) return;
    dom.toast.textContent = text;
    dom.toast.classList.add('show');
    clearTimeout(witchSay._t);
    witchSay._t = setTimeout(() => dom.toast.classList.remove('show'), 3500);
  }

  function hideHandCursor() {
    if (dom.mahjongHandCursor) dom.mahjongHandCursor.classList.add('hidden');
  }

  // ---------- particle loop (วิ่งเฉพาะตอนมี particle ค้างอยู่ — ไพ่เป็น DOM
  // ไม่ต้องวาดซ้ำทุกเฟรมเหมือนฟองในเกมหลัก) ----------
  function loop() {
    if (!running) { rafId = 0; return; }
    particleFx.update();
    scene.clearFx();
    particleFx.draw();
    if (particleFx.count > 0) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = 0;
    }
  }
  function ensureLoopRunning() {
    running = true;
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  // ---------- board render ----------
  // ชั้นสูงเยื้องซ้าย/ขึ้นด้วย offset ลบ — ถ้าไม่ชดเชยด้วย baseShiftX พิกัดซ้ายสุด
  // (x=0 ชั้นลึกสุด) จะติดลบ ทำให้เนื้อหาจริงล้นออกนอกกล่อง .mj-board ทางซ้าย
  // มากกว่าทางขวา margin:auto จึงจัดกึ่งกลาง "กล่อง" ได้ แต่ "เนื้อหาที่เห็นจริง"
  // เยื้องซ้ายกว่ากึ่งกลางจอ (ข้อ 2) — ชดเชยด้วยการบวก maxLayer*offX เข้าไปทุกใบ
  // ให้พิกัดซ้ายสุดที่แท้จริงเริ่มที่ 0 พอดี ตรงกับขอบกล่อง
  function positionTileOnBoard(t) {
    const offX = tileW * LAYER_OFFSET_X_RATIO;
    const offY = tileH * LAYER_OFFSET_Y_RATIO;
    const baseShiftX = maxLayerInBoard * offX;
    t.el.style.left = (t.x * tileW - t.layer * offX + baseShiftX) + 'px';
    t.el.style.top = (t.y * tileH - t.layer * offY) + 'px';
    t.el.style.width = tileW + 'px';
    t.el.style.height = tileH + 'px';
    t.el.style.zIndex = String(t.layer * 100 + t.y * 10 + t.x);
  }

  function sizeBoardContainer() {
    if (!tiles.length || !dom.mahjongBoard) return;
    const maxX = Math.max(...tiles.map((t) => t.x));
    const maxY = Math.max(...tiles.map((t) => t.y));
    maxLayerInBoard = Math.max(...tiles.map((t) => t.layer));
    const offX = tileW * LAYER_OFFSET_X_RATIO;
    dom.mahjongBoard.style.width = ((maxX + 1) * tileW + maxLayerInBoard * offX) + 'px';
    dom.mahjongBoard.style.height = ((maxY + 1) * tileH + 24) + 'px';
  }

  function sizeTraySlots() {
    if (!dom.mahjongTray) return;
    Array.from(dom.mahjongTray.children).forEach((slotEl) => {
      slotEl.style.width = tileW + 'px';
      slotEl.style.height = tileH + 'px';
    });
  }

  // ไพ่ไหลมาเรียงตัวทีละใบตอนเปิดหน้า (ข้อ 3) — เริ่มจากจุดกึ่งกลางกระดานเดียวกัน
  // ทุกใบ (เล็ก+โปร่งใส ผ่าน .entering) แล้วทยอยขยับไปตำแหน่งจริงแบบ stagger
  function renderBoard() {
    if (!dom.mahjongBoard) return;
    dom.mahjongBoard.innerHTML = '';
    sizeBoardContainer(); // ตั้งขนาดกล่องก่อน (อ่านแค่ grid coords ไม่ต้องมี DOM) เพื่อหาจุดกึ่งกลางเริ่มไหล
    const centerX = dom.mahjongBoard.offsetWidth / 2;
    const centerY = dom.mahjongBoard.offsetHeight / 2;

    tiles.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'mj-tile entering';
      el.style.color = t.color;
      el.style.width = tileW + 'px';
      el.style.height = tileH + 'px';
      el.style.fontSize = tileFontSize + 'px';
      el.style.left = (centerX - tileW / 2) + 'px';
      el.style.top = (centerY - tileH / 2) + 'px';

      const emojiEl = document.createElement('span');
      emojiEl.className = 'mj-tile-emoji';
      emojiEl.textContent = TILE_EMOJIS[(Math.random() * TILE_EMOJIS.length) | 0];
      el.appendChild(emojiEl);

      const wordEl = document.createElement('span');
      wordEl.className = 'mj-tile-word';
      wordEl.textContent = t.word;
      el.appendChild(wordEl);

      t.el = el;
      t.wordEl = wordEl; // ให้ shuffle() แก้เฉพาะข้อความ ไม่ทับอิโมจิ/สีทิ้ง
      dom.mahjongBoard.appendChild(el);
    });

    fitWordFontSize(); // ลดฟอนต์ทั้งชุดถ้าคำยาวสุดในรอบนี้ล้นขอบไพ่ (ข้อ 1)

    requestAnimationFrame(() => {
      tiles.forEach((t, i) => {
        schedule(() => {
          t.el.classList.remove('entering');
          positionTileOnBoard(t);
          audio.sfx('card_deal'); // ไพ่เรียงตัวเข้าที่ทีละใบตอนเริ่มมาตรา (ข้อ 3)
        }, i * 45);
      });
    });
  }

  // ลดฟอนต์ไพ่ทั้งชุดเท่ากันทุกใบ (ให้ดูสม่ำเสมอ ไม่ใช่ลดเฉพาะใบที่ยาว) ถ้าคำที่ยาว
  // ที่สุดในรอบนี้ล้นขอบไพ่ — เกิดกับคำสระประกอบหน้า-หลังพยัญชนะ (เช่นสระแอะ "แพะ",
  // สระเอาะ "เกาะ") ที่ยาวกว่าคำ 2 ตัวอักษรทั่วไปอย่างเห็นได้ชัด วัดจริงจาก DOM
  // (scrollWidth) แม่นกว่าประมาณจากจำนวนตัวอักษร เพราะความกว้างสระ/วรรณยุกต์แต่ละ
  // ตัวไม่เท่ากัน (บั๊กที่เจอจริง ข้อ 1) — เรียกครั้งเดียวตอน renderBoard พอ เพราะ
  // shuffle() แค่สลับคำเดิมไปมา ไม่ได้เปลี่ยนชุดคำที่ใช้ ความยาวสุดจึงไม่เปลี่ยน
  function fitWordFontSize() {
    if (!tiles.length) return;
    const maxTextW = tileW - 10; // เผื่อ padding ของ .mj-tile (4px ทั้งสองฝั่ง) + กันชนขอบ
    let widest = 0;
    tiles.forEach((t) => {
      if (t.wordEl && t.wordEl.scrollWidth > widest) widest = t.wordEl.scrollWidth;
    });
    if (widest > maxTextW && widest > 0) {
      const scale = maxTextW / widest;
      tileFontSize = Math.max(12, Math.floor(tileFontSize * scale));
      tiles.forEach((t) => { if (t.el) t.el.style.fontSize = tileFontSize + 'px'; });
    }
  }

  function refreshFreeStates() {
    tiles.forEach((t) => {
      if (t.state !== 'board') return;
      t.el.classList.toggle('free', isTileFree(t, tiles));
    });
    updateStuckIndicator();
  }

  // ติดขัด (ต้องกดสลับป้ายเท่านั้นถึงจะไปต่อได้) มี 2 กรณี:
  // 1) ถาดเต็ม (5/5) — ไพ่ในถาดไม่มีทางซ้ำกันเองอยู่แล้ว (processTrayMatches
  //    เคลียร์คู่ซ้ำทันทีทุกครั้งที่มีไพ่เข้าถาดใหม่) และ onPick ก็ปฏิเสธไพ่ใหม่ทันที
  //    เมื่อถาดเต็ม ต่อให้บนกระดานมีคู่ซ้ำมองเห็นอยู่ก็หยิบเข้าถาดไม่ได้จริงอยู่ดี
  // 2) ไม่มีไพ่ "หยิบได้" เหลือบนกระดานเลยสักใบ (ทั้งที่ถาดยังไม่เต็ม) — เป็นไปได้
  //    จริงตามโครงสร้างปิรามิด (ลำดับที่ไพ่ถูกหยิบออกไปก่อนหน้าทำให้ไพ่ที่เหลือ
  //    บังกันเองพอดี ไม่ใช่บั๊กจากข้อมูล/ลำดับมาตรา) เจอบ่อยขึ้นเมื่อบอร์ดแคบลง
  //    (คอลัมน์น้อยลงจากขนาดไพ่คงที่ ข้อ 5) เดิมเช็คแค่กรณี 1 ทำให้ผู้เล่นติดขัด
  //    จริงแต่ปุ่มสลับป้ายไม่กระพริบเตือนเลย (บั๊กที่เจอจริงตอนทดสอบ)
  function updateStuckIndicator() {
    const anyFreeOnBoard = tiles.some((t) => t.state === 'board' && isTileFree(t, tiles));
    const anyOnBoard = tiles.some((t) => t.state === 'board');
    const stuck = tray.length >= TRAY_CAPACITY || (anyOnBoard && !anyFreeOnBoard);
    if (dom.mahjongShuffleBtn) dom.mahjongShuffleBtn.classList.toggle('pulse', stuck);
    if (stuck && !_stuckVoicePlayed) {
      _stuckVoicePlayed = true;
      audio.voice('mahjong_stuck', { onText: witchSay });
    } else if (!stuck) {
      _stuckVoicePlayed = false;
    }
  }

  // ---------- tray ----------
  function positionTileAtTraySlot(t, slotIndex) {
    if (!dom.mahjongTray) return;
    const slotEl = dom.mahjongTray.children[slotIndex];
    if (!slotEl) return;
    const slotRect = slotEl.getBoundingClientRect();
    const boardRect = dom.mahjongBoard.getBoundingClientRect();
    t.el.style.left = (slotRect.left - boardRect.left) + 'px';
    t.el.style.top = (slotRect.top - boardRect.top) + 'px';
    t.el.style.zIndex = String(2000 + slotIndex);
  }

  function reflowTraySlots() {
    tray.forEach((t, i) => positionTileAtTraySlot(t, i));
  }

  function shakeTray() {
    if (!dom.mahjongTray) return;
    dom.mahjongTray.classList.remove('shake');
    void dom.mahjongTray.offsetWidth; // บังคับ reflow ให้ restart animation ได้ทุกครั้ง
    dom.mahjongTray.classList.add('shake');
  }

  // ไพ่ที่ถูกหนีบอยู่ (ทับจากชั้นบน หรือถูกบังทั้งซ้ายขวา — isTileFree()===false)
  // โดนพยายามหยิบ — สั่นตัวไพ่ใบนั้น + เสียง "ตึ๊ดๆ" บอกว่าหยิบไม่ได้ตอนนี้
  function shakeTile(tile) {
    if (!tile.el) return;
    tile.el.classList.remove('shake');
    void tile.el.offsetWidth; // บังคับ reflow ให้ restart animation ได้ทุกครั้ง
    tile.el.classList.add('shake');
    audio.sfx('tile_blocked');
  }

  function addScore(points) {
    app.totalScore += points;
    saveTotalScore(app.totalScore);
    if (dom.totalBadgeValue) dom.totalBadgeValue.textContent = app.totalScore;
    if (dom.totalBadge) {
      dom.totalBadge.classList.remove('bump');
      void dom.totalBadge.offsetWidth;
      dom.totalBadge.classList.add('bump');
    }
    showPointsPopup(points);
  }

  // ตัวเลขคะแนน (+20) โผล่กลางจอตอนจับคู่สำเร็จ (ข้อ 6) คู่กับผลึกแก้วแตก
  function showPointsPopup(points) {
    if (!dom.mahjongPointsPopup) return;
    dom.mahjongPointsPopup.textContent = `+${points}`;
    dom.mahjongPointsPopup.classList.remove('show');
    void dom.mahjongPointsPopup.offsetWidth;
    dom.mahjongPointsPopup.classList.add('show');
  }

  function scanTrayForFirstMatchPair() {
    for (let i = 0; i < tray.length; i++) {
      for (let j = i + 1; j < tray.length; j++) {
        if (tray[i].word === tray[j].word) return [tray[i], tray[j]];
      }
    }
    return null;
  }

  // โชว์คำตัวใหญ่ตรงถาด แล้วอ่านสะกดคำทีละพยางค์ (ใช้ word.spell เดิมจาก matra.js
  // ตัวเดียวกับที่เกมหยิบฟองใช้เฉลยสะกดคำ) — เรียก done() หลังอ่านจบ
  function showBigWord(wordObj, done) {
    if (!dom.mahjongBigWord) { done(); return; }
    // เขียนคำลง .mj-big-word-text (ลูกข้างใน) ไม่ใช่ตัว .mj-big-word เอง — แยก
    // element กันพื้นหลังบังตัวอักษร (ดูคอมเมนต์ .mj-big-word ใน styles.css)
    const textEl = dom.mahjongBigWord.querySelector('.mj-big-word-text') || dom.mahjongBigWord;
    textEl.textContent = wordObj.display;
    dom.mahjongBigWord.classList.remove('show');
    void dom.mahjongBigWord.offsetWidth;
    dom.mahjongBigWord.classList.add('show');
    if (wordObj.isEmoji) {
      // ไพ่อิโมจิ (ข้อ 7) — ไม่มีคำ/สะกดจริงให้อ่าน โชว์ตัวใหญ่แล้วชมด้วยเสียง
      // สุ่มแทน (ไม่ซ้ำคำชมเดิมติดกัน — ดู noRepeat ใน audio.voice) รอเสียงชมจบ
      // ก่อนไปต่อ เหมือนคำจริงที่รอ playSpellReveal จบ
      audio.voice('mahjong_emoji_match', {
        noRepeat: true,
        onEnd: () => { dom.mahjongBigWord.classList.remove('show'); done(); },
      });
      return;
    }
    audio.playSpellReveal({ spell: wordObj.spell }, () => {
      dom.mahjongBigWord.classList.remove('show');
      done();
    });
  }

  // เอฟเฟกต์ตอนจับคู่สำเร็จ (ข้อ 3): ไพ่ทั้งคู่ถอยห่างจากตำแหน่งเดิมนิดหน่อยก่อน
  // แล้ววิ่งเข้าหากันไปชนกึ่งกลาง จึงระเบิดเป็นเศษชิ้นส่วนสีขาวทึบ + เสียงแตก
  // แล้วค่อยโชว์คำตัวใหญ่ + อ่านสะกดคำ — เล่นทีละคู่ (matchQueue) กันเสียง/คำตัวใหญ่
  // ทับกันตอน shuffle บังเอิญเจอหลายคู่พร้อมกัน
  function playMatchEffect(a, b, done) {
    a.el.classList.add('pre-explode');
    b.el.classList.add('pre-explode');

    const boardRect = dom.mahjongBoard.getBoundingClientRect();
    const ra = a.el.getBoundingClientRect();
    const rb = b.el.getBoundingClientRect();
    const acx = (ra.left + ra.right) / 2, acy = (ra.top + ra.bottom) / 2;
    const bcx = (rb.left + rb.right) / 2, bcy = (rb.top + rb.bottom) / 2;
    const midX = (acx + bcx) / 2, midY = (acy + bcy) / 2;
    const dx = bcx - acx, dy = bcy - acy;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist; // ทิศจาก a ไป b
    const recoilPx = tileW * 0.4;

    const aLeft0 = ra.left - boardRect.left, aTop0 = ra.top - boardRect.top;
    const bLeft0 = rb.left - boardRect.left, bTop0 = rb.top - boardRect.top;

    // ขั้น 1: ถอยห่างออกจากกันนิดหน่อยจากตำแหน่งเดิม
    a.el.style.left = (aLeft0 - ux * recoilPx) + 'px';
    a.el.style.top = (aTop0 - uy * recoilPx) + 'px';
    b.el.style.left = (bLeft0 + ux * recoilPx) + 'px';
    b.el.style.top = (bTop0 + uy * recoilPx) + 'px';

    schedule(() => {
      // ขั้น 2: วิ่งเข้าหากันไปชนกึ่งกลางจุดเดิม
      const midLeft = midX - boardRect.left - tileW / 2;
      const midTop = midY - boardRect.top - tileH / 2;
      a.el.style.left = midLeft + 'px';
      a.el.style.top = midTop + 'px';
      b.el.style.left = midLeft + 'px';
      b.el.style.top = midTop + 'px';

      schedule(() => {
        // ขั้น 3: ชนกัน → ระเบิด
        a.el.classList.add('matched');
        b.el.classList.add('matched');
        particleFx.spawnGlassShards(midX, midY); // สีขาวทึบเสมอ (ค่า default ของ spawnGlassShards)
        ensureLoopRunning();
        audio.playGlassCrush();
        addScore(MATCH_POINTS);

        schedule(() => {
          a.el.remove();
          b.el.remove();
          reflowTraySlots(); // เลื่อนไพ่ที่เหลือในถาดมาชิดซ้าย — รอให้ระเบิดเสร็จก่อน (ข้อ 3)
          showBigWord(a.wordObj, done);
        }, MATCH_REMOVE_MS);
      }, PRE_EXPLODE_STEP_MS);
    }, PRE_EXPLODE_STEP_MS);
  }

  function runMatchQueue() {
    if (matchProcessing || matchQueue.length === 0) return;
    matchProcessing = true;
    const [a, b] = matchQueue.shift();
    playMatchEffect(a, b, () => {
      matchProcessing = false;
      // เช็ค matchQueue ว่างด้วย ไม่ใช่แค่ matchedPairs===totalPairs — เพราะ
      // processTrayMatches() นับ matchedPairs ของ "ทุกคู่ที่เจอ" ล่วงหน้าตอน
      // สแกนทีเดียว (เผื่อ shuffle() บังเอิญทำให้ 2 คู่สุดท้ายจับคู่พร้อมกัน) ถ้าเช็ค
      // แค่ matchedPairs ตอนคู่แรกในคิวเล่นจบ อาจนับว่า "จบด่านแล้ว" ทั้งที่ยังมีคู่
      // สุดท้ายจริงๆ ค้างอยู่ในคิว ยังไม่ได้อ่านคำเลย
      if (matchedPairs === totalPairs && matchQueue.length === 0) {
        onComplete(currentMatraId);
      } else {
        runMatchQueue();
      }
    });
  }

  function processTrayMatches() {
    let pair;
    while ((pair = scanTrayForFirstMatchPair())) {
      pair[0].state = 'matched';
      pair[1].state = 'matched';
      tray = tray.filter((t) => t !== pair[0] && t !== pair[1]);
      matchedPairs++;
      matchQueue.push(pair);
    }
    // reflowTraySlots() ย้ายไปเรียกใน playMatchEffect หลังระเบิดเสร็จแทน (ข้อ 3) —
    // ไม่งั้นไพ่ที่เหลือจะเลื่อนมาชิดซ้ายทันทีตั้งแต่ก่อนเอฟเฟกต์ระเบิดเริ่มเล่นด้วยซ้ำ
    updateStuckIndicator();
    runMatchQueue();
  }

  // ---------- pick → บินเข้าถาดทันที (ข้อ 1) ----------
  // แตะ/คลิก หรือจีบนิ้ว (AR) ที่ไพ่ที่หยิบได้ → ลอยเข้าถาดเองทันที ไม่ต้องลาก/ยก
  // ไปวางเองแบบที่เคยทำ (v148-v152) — พบว่าแตะตรงไปตรงมากว่าสำหรับเด็ก ย้าย
  // กลไกแม่เหล็ก-ระหว่างลากไปใช้กับเกมหยิบฟองแทน (ดู game.js, ข้อ 2)
  function flyToTray(tile, isAR) {
    tile.state = 'tray';
    const slotIndex = tray.length;
    tray.push(tile);
    tile.el.classList.remove('free');
    tile.el.classList.add('flying', 'in-tray'); // in-tray: เต็มสว่างชัดเจน (ข้อ 6) — .free เดิมหลุดไปตอนนี้
    // โหมด AR (ดีดนิ้ว) ใช้เสียง Cartoon Boing.mp3 จริง — สัมผัสจอปกติ (ไม่ใช่ AR)
    // ใช้เสียงสังเคราะห์ synth 'pick' เดิมแทน (ข้อ: เสียงเลือกไพ่ต่างกันตามโหมด)
    if (isAR) audio.playCartoonBoing(); else audio.sfx('pick');
    positionTileAtTraySlot(tile, slotIndex);
    schedule(() => {
      tile.el.classList.remove('flying');
      audio.sfx('card_place'); // ไพ่วางลงถาดแล้ว (ข้อ 3) — ต่างจาก 'pick' ตอนเริ่มลอย
      // เช็คจับคู่ก่อน refreshFreeStates() เสมอ (ข้อ 2) — ถ้าใบล่าสุดที่เพิ่งเข้ามา
      // คือคู่ที่จับได้พอดีตอนถาดเต็ม (5/5) เดิมลำดับสลับกันทำให้ updateStuckIndicator
      // (เรียกจาก refreshFreeStates) เห็นถาดเต็มก่อนที่ processTrayMatches จะทันเอา
      // คู่ที่จับได้ออกไป กลายเป็นคำเตือน "เต็มถาดแล้วจ้ะ ลองสลับป้าย" หลอกเด็กทั้งที่
      // กำลังจะจับคู่สำเร็จอยู่แล้ว (บั๊กที่เจอจริง) — สลับให้จับคู่ก่อนเสมอ ถ้าเต็ม
      // จริงๆ (ไม่มีคู่) ค่อยเตือนตามปกติ
      processTrayMatches();
      refreshFreeStates(); // ไพ่ข้างใต้/ข้างๆ อาจหยิบได้แล้วตอนนี้
    }, FLY_MS);
  }

  // ---------- public API ----------

  function startMatra(matra, curriculumIndex, totalCount) {
    clearPendingTimers(); // กันเศษ timer ค้างจากรอบก่อนหน้า (ปกติ stop() เคลียร์ไปแล้ว)
    // เคลียร์ #fxCanvas ทันที (ไม่รอ particle loop ซึ่งทำงานแบบ reactive เท่านั้น
    // — ไม่ได้วิ่งทุกเฟรมเหมือน game.js) กันเฟรมสุดท้ายของฟองสบู่จากเกมหยิบฟอง
    // (แชร์ fxCanvas เดียวกัน) ค้างอยู่บนจอจนกว่าจะมีการจับคู่ไพ่ครั้งแรก — เดิม
    // มองไม่เห็นเพราะ fxCanvas เคยถูกบังอยู่หลัง #mahjongScreen แต่หลังแก้ z-index
    // (v158) ให้ fxCanvas ลอยเหนือ UI แล้ว ฟองสบู่ค้างนี้เลยโผล่ให้เห็นจริง (บั๊กที่เจอ)
    scene.clearFx();
    currentMatraId = matra.id;
    const { pairCount, layerCount } = deriveDifficulty(matra, curriculumIndex);
    totalPairs = pairCount;
    matchedPairs = 0;
    tray = [];
    matchQueue = [];
    matchProcessing = false;
    _stuckVoicePlayed = false;
    if (dom.mahjongShuffleBtn) dom.mahjongShuffleBtn.classList.remove('pulse');
    if (dom.mahjongBigWord) dom.mahjongBigWord.classList.remove('show');
    if (dom.mahjongPointsPopup) dom.mahjongPointsPopup.classList.remove('show');
    hideHandCursor();

    // ขนาดไพ่คงที่ตามความกว้างจอก่อน (ข้อ 5) แล้วค่อยคำนวณว่าฐานปิรามิดใช้ได้กี่
    // คอลัมน์ที่ขนาดนี้ — สลับลำดับจากเดิม (เดิมจัด layout ก่อนแล้วย่อไพ่ให้พอดี)
    // ส่ง #mahjongScreen (ผู้ปกครองของ mahjongBoard) เข้าไปวัด padding จริง กันล้นจอ
    const screenEl = dom.mahjongBoard && dom.mahjongBoard.parentElement;
    const size = computeTileSize(screenEl);
    tileW = size.w;
    tileH = size.h;
    tileFontSize = size.fontSize;
    const maxBoardCols = computeMaxBoardCols(tileW, screenEl);
    const slots = buildPyramidLayout(pairCount, layerCount, maxBoardCols);

    // คำจริงไม่พอ pairCount ที่มาตรานี้ต้องการ (ข้อ 7) → เติมด้วยไพ่อิโมจิแทน
    // (isEmoji:true, ไม่มี .spell) จับคู่กันแล้วไม่อ่านคำ/สะกด แต่ได้ยินเสียงชม
    // แบบสุ่มแทน (ดู playMatchEffect/showBigWord)
    const realWords = shuffleArray(matra.words);
    const realCount = Math.min(pairCount, realWords.length);
    const emojiCount = pairCount - realCount;
    const emojiWords = shuffleArray(WORD_EMOJIS)
      .slice(0, emojiCount)
      .map((e) => ({ display: e, isEmoji: true }));
    const wordPool = [...realWords.slice(0, realCount), ...emojiWords];
    // คำเดียวกัน = สีเดียวกันเสมอ (ข้อ 2) — จับคู่คำ<->สีไว้ล่วงหน้าตามลำดับคำ
    // ในกองนี้ (ไม่ใช่ตามลำดับไพ่บนกระดาน) กันสีซ้ำโดยไม่ได้ตั้งใจระหว่างคำต่างกัน
    wordColorMap = new Map();
    wordPool.forEach((w, i) => wordColorMap.set(w.display, TILE_TEXT_COLORS[i % TILE_TEXT_COLORS.length]));

    const wordAssignment = shuffleArray([...wordPool, ...wordPool]);
    tiles = slots.map((s, i) => ({
      id: `mj${i}`,
      word: wordAssignment[i].display,
      wordObj: wordAssignment[i],
      color: wordColorMap.get(wordAssignment[i].display),
      x: s.x, y: s.y, layer: s.layer, state: 'board', el: null,
    }));

    if (dom.mahjongTitle) dom.mahjongTitle.textContent = matra.name;
    sizeTraySlots();
    renderBoard();
    refreshFreeStates();
  }

  // slop มีค่า (ตัวเลข) เฉพาะตอนมาจาก AR (handpinch.js ส่ง GRAB_SLOP มาเสมอ) —
  // pointer.js (แตะจอ/เมาส์) เรียก onPick(x,y) แค่ 2 argument ไม่มี slop เลย ใช้
  // เป็นสัญญาณแยกโหมด AR vs สัมผัสจอปกติ โดยไม่ต้องเพิ่ม state/plumbing ใหม่
  // (ข้อ: เสียงเลือกไพ่ต่างกันตามโหมด)
  function onPick(x, y, slop) {
    // กันหยิบซ้อน: touch กับ AR pinch เปิดพร้อมกันได้ (ทั้งคู่เรียก onPick) — ถ้า
    // นิ้วจริงกับจุดที่กล้องตรวจจับไม่ตรงเป๊ะกัน อาจยิง onPick 2 ครั้งคนละพิกัด
    // จากท่าเดียว จนได้ไพ่คนละใบ (บั๊กที่เจอจริง v146) เช็คว่ามีไพ่กำลังบินอยู่ไหม
    // (ช่วงสั้นๆ FLY_MS) กันไว้ — ไพ่ที่บินไปแล้วเปลี่ยน state ทันทีแบบ sync อยู่แล้ว
    // จึงกันการหยิบซ้ำใบเดิมได้ในตัว ไม่ต้องมี flag แยกอีก
    if (!tiles.length || tiles.some((t) => t.el.classList.contains('flying'))) return;
    const el = document.elementFromPoint(x, y);
    const tileEl = el && el.closest && el.closest('.mj-tile');
    if (!tileEl) return;
    const tile = tiles.find((t) => t.el === tileEl);
    if (!tile || tile.state !== 'board') return;
    if (!isTileFree(tile, tiles)) { shakeTile(tile); return; } // ถูกหนีบอยู่ — หยิบไม่ได้ตอนนี้
    if (tray.length >= TRAY_CAPACITY) { shakeTray(); return; }
    flyToTray(tile, slop != null);
  }

  // ไม่ใช้ลากอีกต่อไป (ข้อ 1) แต่ยังต้องมี no-op ไว้ในหน้า public API เพราะ
  // pointer.js/handpinch.js เรียกทั้ง 3 ตัวเสมอโดยไม่รู้ว่าปลายทางใช้หรือไม่
  function onMove() {}
  function onRelease() {}

  // ---------- AR hand cursor (ข้อ 10) — ไม่ซ้อนภาพกล้องจริง ใช้ภาพมือแทน
  // ตำแหน่งที่ mediapipe ติดตามได้ — pointer.js ไม่เรียก onHandFrame เลย (เฉพาะ
  // handpinch.js) จึงใช้เป็นสัญญาณ "AR กำลังทำงานอยู่" ได้ตรงๆ ----------
  let _lastHandOpen = null; // กันเซ็ต .src ซ้ำทุกเฟรม (~30fps) ตอนสถานะไม่เปลี่ยน
  function onHandFrame(frame) {
    if (!dom.mahjongHandCursor) return;
    if (!frame) { hideHandCursor(); _lastHandOpen = null; return; }
    dom.mahjongHandCursor.classList.remove('hidden');
    // ใช้ตำแหน่งปลายนิ้วโป้ง (tx,ty) แทนนิ้วชี้ (ข้อ 2) — ให้ตรงกับตำแหน่งลาก/วางไพ่จริง
    // ที่ onPick/onMove/onRelease ใช้ (ดู inputHandlers ใน main.js) ตกกรณี frame เก่า
    // ที่ไม่มี tx/ty (ไม่ควรเกิดแล้ว แต่กันไว้) จึง fallback เป็น x/y
    const hx = frame.tx != null ? frame.tx : frame.x;
    const hy = frame.ty != null ? frame.ty : frame.y;
    dom.mahjongHandCursor.style.left = hx + 'px';
    dom.mahjongHandCursor.style.top = hy + 'px';
    if (frame.open !== _lastHandOpen) {
      _lastHandOpen = frame.open;
      // มือกาง (ยังไม่จีบ) = Hand click.png, มือจีบหยิบ = Hand click2.png
      dom.mahjongHandCursor.src = frame.open
        ? 'public/assets/images/Hand%20click.png'
        : 'public/assets/images/Hand%20click2.png';
    }
  }

  // เช็คว่าการสุ่มจับคู่คำรอบนี้ (wordObjs ตามลำดับเดียวกับ pool) ทำให้ไพ่ที่อยู่
  // ในถาดได้คำซ้ำกันอย่างน้อย 1 คู่ไหม — ไม่นับไพ่บนกระดาน เพราะ shuffle ไม่ได้
  // ย้ายไพ่ระหว่างถาด/กระดาน แค่เปลี่ยนคำที่แสดงเท่านั้น (ดู processTrayMatches
  // ที่ทำงานกับ tray array ล้วนๆ)
  function trayHasMatch(pool, wordObjs) {
    const trayIdx = new Set(tray.map((t) => t.id));
    const trayWords = [];
    pool.forEach((t, i) => { if (trayIdx.has(t.id)) trayWords.push(wordObjs[i].display); });
    const seen = new Set();
    for (const w of trayWords) {
      if (seen.has(w)) return true;
      seen.add(w);
    }
    return false;
  }

  function applyWordAssignment(pool, wordObjs) {
    pool.forEach((t, i) => {
      t.wordObj = wordObjs[i];
      t.word = wordObjs[i].display;
      t.color = wordColorMap.get(t.word); // สีตามคำใหม่ (คำเดียวกันสีเดียวกันเสมอ)
      if (t.wordEl) t.wordEl.textContent = t.word;
      if (t.el) t.el.style.color = t.color;
    });
  }

  // สลับป้าย — หาผลลัพธ์สุดท้าย (วนสุ่มในหน่วยความจำจนกว่าจะได้คำซ้ำกันในถาดจริง
  // ผู้เล่นกดครั้งเดียวจบ ไม่ต้องกดซ้ำๆ เอง) ไว้ก่อน แล้วค่อยโชว์การหมุนสุ่มให้
  // เห็นเป็นรอบๆ (SHUFFLE_SPIN_CYCLES ครั้ง) ก่อนจบที่ผลลัพธ์จริงในรอบสุดท้าย —
  // ถาดมีไพ่น้อยกว่า 2 ใบ ไม่มีทางเกิดคู่ในถาดได้เลยไม่ว่าสุ่มกี่ครั้ง (ข้ามการวน
  // เช็คไปเลยในกรณีนั้น) MAX_SHUFFLE_ATTEMPTS กันลูปค้างในกรณีสุดโต่งที่ไม่น่า
  // เกิดขึ้นจริง (pigeonhole รับประกันว่าถ้ายังมีคู่เหลืออยู่จริง โอกาสเกิดคู่ใน
  // ถาดต่อการสุ่ม 1 ครั้งไม่เคยเป็นศูนย์)
  const MAX_SHUFFLE_ATTEMPTS = 300;
  const SHUFFLE_SPIN_CYCLES = 5;
  const SHUFFLE_SPIN_INTERVAL_MS = 110;
  let _shuffling = false; // กันกดซ้ำ/เรียกซ้อนระหว่างกำลังหมุนสุ่มอยู่
  function shuffle() {
    if (_shuffling) return;
    const pool = tiles.filter((t) => t.state !== 'matched');
    if (!pool.length) return;
    const canFormTrayMatch = tray.length >= 2;

    let finalWordObjs;
    let attempt = 0;
    do {
      finalWordObjs = shuffleArray(pool.map((t) => t.wordObj));
      attempt++;
    } while (canFormTrayMatch && attempt < MAX_SHUFFLE_ATTEMPTS && !trayHasMatch(pool, finalWordObjs));

    _shuffling = true;
    if (dom.mahjongShuffleBtn) dom.mahjongShuffleBtn.disabled = true;
    let cycle = 0;
    const spinTick = () => {
      cycle++;
      const isLast = cycle >= SHUFFLE_SPIN_CYCLES;
      applyWordAssignment(pool, isLast ? finalWordObjs : shuffleArray(pool.map((t) => t.wordObj)));
      audio.sfx('card_deal'); // เสียงเดียวกับตอนไพ่เรียงตัว ให้ความรู้สึกกำลังสับ/หมุน
      if (!isLast) {
        schedule(spinTick, SHUFFLE_SPIN_INTERVAL_MS);
      } else {
        _shuffling = false;
        if (dom.mahjongShuffleBtn) dom.mahjongShuffleBtn.disabled = false;
        processTrayMatches();
      }
    };
    spinTick();
  }

  function relayout() {
    if (!tiles.length) return;
    const screenEl = dom.mahjongBoard && dom.mahjongBoard.parentElement;
    const size = computeTileSize(screenEl);
    tileW = size.w;
    tileH = size.h;
    tileFontSize = size.fontSize;
    sizeTraySlots();
    tiles.forEach((t) => {
      if (t.el) t.el.style.fontSize = tileFontSize + 'px';
      if (t.state === 'board') positionTileOnBoard(t);
    });
    sizeBoardContainer();
    tray.forEach((t, i) => positionTileAtTraySlot(t, i));
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    clearPendingTimers();
    particleFx.clear();
    if (dom.mahjongBoard) dom.mahjongBoard.innerHTML = '';
    if (dom.mahjongShuffleBtn) { dom.mahjongShuffleBtn.classList.remove('pulse'); dom.mahjongShuffleBtn.disabled = false; }
    if (dom.mahjongBigWord) dom.mahjongBigWord.classList.remove('show');
    if (dom.mahjongPointsPopup) dom.mahjongPointsPopup.classList.remove('show');
    hideHandCursor();
    _lastHandOpen = null;
    tiles = [];
    tray = [];
    matchQueue = [];
    matchProcessing = false;
    matchedPairs = 0;
    totalPairs = 0;
    _stuckVoicePlayed = false;
    // clearPendingTimers() ด้านบนตัดห่วง spinTick ที่ค้างอยู่แล้ว แต่ _shuffling
    // ไม่ถูกรีเซ็ตเองถ้าออกจากหน้ากลางคันตอนกำลังหมุนสุ่ม — ต้องเคลียร์ตรงนี้ด้วย
    // ไม่งั้นปุ่มสลับป้ายจะกดไม่ติดตลอดไปตั้งแต่รอบถัดไป
    _shuffling = false;
  }

  return {
    startMatra,
    onPick,
    onMove,
    onRelease,
    onHandFrame,
    shuffle,
    relayout,
    stop,
  };
}
