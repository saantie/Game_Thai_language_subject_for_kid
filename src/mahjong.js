// mahjong.js — มินิเกม "ไพ่นกกระจอกจับคู่คำไทย" ด่านอุ่นเครื่องก่อนเกมหยิบฟอง
// เล่นครั้งแรกที่ปลดล็อกแต่ละมาตราเท่านั้น (คุมจาก main.js ผ่าน app.mahjongSeen)
//
// กลไก: ไพ่วางซ้อนเป็นชั้นปิรามิด (พอร์ตอัลกอริทึมจาก prototypes/thai-mahjong-
// prototype.html) — จับไพ่ที่ "หยิบได้" (ไม่ถูกทับ + เปิดข้างซ้ายหรือขวา) แล้วลาก
// ไปวางในถาดพัก 5 ช่อง (มีแม่เหล็กดูดเข้าถาดตอนลากมาซ้อนทับ ไม่ต้องรอปล่อยมือ)
// พอในถาดมีคำซ้ำกัน 2 ใบจึงจับคู่หายไป — ไม่มีเงื่อนไขแพ้/ตัวจับเวลา ถาดเต็มไม่มี
// คู่ = ปุ่มสลับป้าย (สุ่มคำใหม่ทั่วถาด+กระดาน) เท่านั้น

import { createParticleSystem } from './particles.js';
import { saveTotalScore } from './storage.js';

const TRAY_CAPACITY = 5;
const FLY_MS = 350;
const MATCH_REMOVE_MS = 320;
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

// ---------- pure logic (พอร์ตจาก prototype, export ไว้เทสต์แยกได้) ----------

// จัดวางไพ่เป็นชั้นปิรามิด — สัดส่วนต่อชั้น [0.45,0.3,0.17,0.08] (ชั้น 0 = ฐาน
// กว้างสุด) layerCount ห้ามเกิน 4 เพราะตารางสัดส่วนนี้มีแค่ 4 ค่า
export function buildPyramidLayout(pairCount, layerCount) {
  const total = pairCount * 2;
  const weights = [0.45, 0.3, 0.17, 0.08].slice(0, layerCount);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.max(2, Math.round((w / wsum) * total)));
  const diff = total - counts.reduce((a, b) => a + b, 0);
  counts[0] += diff;

  const slots = [];
  const layer0Rows = 2;
  const layer0Cols = Math.ceil(counts[0] / layer0Rows);
  const baseWidth = layer0Cols;

  for (let L = 0; L < layerCount; L++) {
    const count = counts[L];
    const rows = L === 0 ? layer0Rows : Math.max(1, Math.round(Math.sqrt(count / (layer0Cols / layer0Rows))));
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

// เช็คว่ามีคู่คำซ้ำ "มองเห็นได้" ตอนนี้ไหม (ไพ่หยิบได้บนกระดาน + ไพ่ในถาด) —
// ไม่ใช่ตัวเช็ค deadlock จริง (ไม่จำลองว่าทั้งกระดานแก้ได้ไหม) ใช้จุดชนวน
// ไฮไลต์ปุ่มสลับป้าย/เสียงให้กำลังใจเท่านั้น
export function hasVisibleMatch(freeBoardTiles, trayTiles) {
  const seen = new Set();
  for (const t of [...freeBoardTiles, ...trayTiles]) {
    if (seen.has(t.word)) return true;
    seen.add(t.word);
  }
  return false;
}

// ความยากอิงลำดับ 26 มาตราปัจจุบัน (v143, ดูคอมเมนต์หัวไฟล์ data/matra.js) —
// เพดาน pairCount/layerCount ตาม tier แล้ว cap ด้วยจำนวนคำจริงของมาตรานั้น
// (กันมาตราคำน้อยเช่นสระแอะ/เอะ ได้บอร์ดใหญ่เกินจำนวนคำที่มี)
// tier0 (kaka) ตั้งใจให้ 6 คู่ (12 ใบ) ตามที่ขอ — สูงกว่า tier1-2 โดยตั้งใจ
// เพราะ kaka เป็นมาตราที่เล่นบ่อยสุด/มีคำให้เลือกเยอะสุด (18 คำ)
const TIER_BOUNDARIES = [1, 10, 13, 16, 18]; // idx < boundary[i] → tier i, เกินหมด → tier สุดท้าย
const TIERS = [
  { pairs: 6, layers: 3 }, // tier0: kaka — เริ่มต้น 12 ใบ
  { pairs: 4, layers: 2 }, // tier1: กลุ่ม1 สระเดี่ยวคู่สั้น-ยาว
  { pairs: 4, layers: 3 }, // tier2: กลุ่ม2 สระเดี่ยวไม่มีคู่
  { pairs: 5, layers: 3 }, // tier3: กลุ่ม3 สระประสม
  { pairs: 5, layers: 4 }, // tier4: กลุ่ม4 สระเกิน
  { pairs: 5, layers: 4 }, // tier5: มาตราตัวสะกดจริง (กด ยากสุด) — เท่า tier4
                           // โดยตั้งใจ เพราะถาด 5 ช่อง + เพดานชั้น generator (4)
                           // ไม่เหลือช่องบีบยากกว่านี้ด้วยตัวแปรสองตัวนี้
];
export function deriveDifficulty(matra, curriculumIndex) {
  let tier = TIER_BOUNDARIES.findIndex((b) => curriculumIndex < b);
  if (tier === -1) tier = TIERS.length - 1;
  const t = TIERS[tier];
  const pairCount = Math.max(2, Math.min(t.pairs, matra.words.length));
  return { pairCount, layerCount: t.layers };
}

// ขนาดไพ่ตอบสนองตามหน้าจอ — คำนวณจากทั้งถาด (คงที่ 5 ช่องต้องพอดีความกว้างจอ
// เสมอ ชิดกันไม่มีช่องว่าง) และกระดาน (คอลัมน์กว้างสุดที่ layout จริงใช้ + กันชน
// สำหรับการเยื้องต่อชั้น) เอาค่าที่เล็กกว่าเพื่อให้ไม่ล้นจอทั้งสองส่วน
function computeTileSize(maxBoardCols) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
  const usableW = vw * 0.94;
  const colsNeeded = Math.max(TRAY_CAPACITY, maxBoardCols + 1);
  let w = Math.floor(usableW / colsNeeded);
  w = Math.max(34, Math.min(DEFAULT_TILE_W, w));
  const h = Math.round(w * TILE_ASPECT);
  return { w, h };
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
  let held = null;           // ไพ่ที่กำลังถูกจับ/ลากอยู่ (null = ไม่มี) — ดู grabTile/onMove/onRelease
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
  let maxLayerInBoard = 0; // ใช้คำนวณ baseShiftX กันไพ่ชั้นบนหลุดพิกัดติดลบ (ดู positionTileOnBoard)
  let wordColorMap = new Map(); // word.display -> สี — คู่คำเดียวกันได้สีเดียวกันเสมอ (ข้อ 2)

  // ตัว setTimeout ของ dropIntoTray/returnToBoard/playMatchEffect ต้องถูกยกเลิกใน stop() —
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

    requestAnimationFrame(() => {
      tiles.forEach((t, i) => {
        schedule(() => {
          t.el.classList.remove('entering');
          positionTileOnBoard(t);
        }, i * 45);
      });
    });
  }

  function refreshFreeStates() {
    tiles.forEach((t) => {
      if (t.state !== 'board') return;
      t.el.classList.toggle('free', isTileFree(t, tiles));
    });
    updateStuckIndicator();
  }

  function updateStuckIndicator() {
    const freeBoard = tiles.filter((t) => isTileFree(t, tiles));
    const stuck = tray.length >= TRAY_CAPACITY && !hasVisibleMatch(freeBoard, tray);
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
    if (!dom.mahjongBigWord || !wordObj.spell) { done(); return; }
    dom.mahjongBigWord.textContent = wordObj.display;
    dom.mahjongBigWord.classList.remove('show');
    void dom.mahjongBigWord.offsetWidth;
    dom.mahjongBigWord.classList.add('show');
    audio.playSpellReveal({ spell: wordObj.spell }, () => {
      dom.mahjongBigWord.classList.remove('show');
      done();
    });
  }

  // เอฟเฟกต์ตอนจับคู่สำเร็จ: ผลึกแก้วสีขาวระเบิดร่วงหล่น + เสียงแตก แล้วค่อยโชว์
  // คำตัวใหญ่ + อ่านสะกดคำ — เล่นทีละคู่ (matchQueue) กันเสียง/คำตัวใหญ่ทับกัน
  // ตอน shuffle บังเอิญเจอหลายคู่พร้อมกัน
  function playMatchEffect(a, b, done) {
    a.el.classList.add('matched');
    b.el.classList.add('matched');

    const ra = a.el.getBoundingClientRect();
    const rb = b.el.getBoundingClientRect();
    const cx = (ra.left + ra.right + rb.left + rb.right) / 4;
    const cy = (ra.top + ra.bottom + rb.top + rb.bottom) / 4;
    particleFx.spawnGlassShards(cx, cy);
    ensureLoopRunning();
    audio.playGlassCrush();
    addScore(MATCH_POINTS);

    schedule(() => {
      a.el.remove();
      b.el.remove();
      showBigWord(a.wordObj, done);
    }, MATCH_REMOVE_MS);
  }

  function runMatchQueue() {
    if (matchProcessing || matchQueue.length === 0) return;
    matchProcessing = true;
    const [a, b] = matchQueue.shift();
    playMatchEffect(a, b, () => {
      matchProcessing = false;
      if (matchedPairs === totalPairs) {
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
    reflowTraySlots();
    updateStuckIndicator();
    runMatchQueue();
  }

  // ---------- pick / drag / magnet-drop (ข้อ 4) ----------
  // มือ (AR) หรือนิ้ว (touch/mouse) หยิบไพ่ยกไปวางในถาดจริง — ไม่ใช่แตะแล้วบิน
  // เข้าถาดทันทีเหมือนเดิม มีแม่เหล็ก: พอลากไพ่มาซ้อนทับถาด (แม้ยังไม่ปล่อยมือ)
  // ก็ดูดเข้าถาดให้เองทันที ปล่อยนอกถาด = ไพ่ลอยกลับที่เดิมบนกระดาน
  //
  // heldBoardRect/heldTrayRect: cache ตำแหน่งกล่องไว้ตอนเริ่มจับ (grabTile) แทน
  // เรียก getBoundingClientRect() ทุกครั้งใน onMove — onMove ยิงถี่มากระหว่างลาก
  // (ทุก touchmove/mousemove ไม่ใช่แค่ทุกเฟรม) การอ่าน rect สลับกับเขียน
  // style.left/top ของไพ่ที่ถืออยู่ในฟังก์ชันเดียวกันจะบังคับ browser ทำ
  // synchronous layout reflow ทุกครั้ง (layout thrashing) กระดาน/ถาดไม่ขยับระหว่าง
  // ลากอยู่แล้วในทางปฏิบัติ จึง cache ไว้ครั้งเดียวปลอดภัย
  let heldBoardRect = null;
  let heldTrayRect = null;

  function boardRelativePoint(x, y) {
    const r = heldBoardRect || dom.mahjongBoard.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  }

  function isOverTray(x, y) {
    const r = heldTrayRect;
    if (!r) return false;
    const pad = 24; // รัศมีแม่เหล็ก — ใกล้ถาดพอประมาณก็ดูดเข้าได้ ไม่ต้องซ้อนเป๊ะ
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  function grabTile(tile) {
    held = tile;
    heldBoardRect = dom.mahjongBoard.getBoundingClientRect();
    heldTrayRect = dom.mahjongTray ? dom.mahjongTray.getBoundingClientRect() : null;
    tile.el.classList.remove('free');
    tile.el.classList.add('held');
    audio.sfx('pick'); // เสียงเดียวกับตอนหยิบฟองในเกมหลัก — ให้ feedback ตอนเริ่มจับไพ่
  }

  function dropIntoTray(tile) {
    tile.state = 'tray';
    const slotIndex = tray.length;
    tray.push(tile);
    tile.el.classList.remove('held');
    tile.el.classList.add('flying');
    positionTileAtTraySlot(tile, slotIndex);
    schedule(() => {
      tile.el.classList.remove('flying');
      refreshFreeStates(); // ไพ่ข้างใต้/ข้างๆ อาจหยิบได้แล้วตอนนี้
      processTrayMatches();
    }, FLY_MS);
  }

  function returnToBoard(tile) {
    tile.el.classList.remove('held');
    tile.el.classList.add('flying'); // reuse transition/จังหวะเดิมให้ลอยกลับนุ่มนวล
    positionTileOnBoard(tile);
    schedule(() => {
      tile.el.classList.remove('flying');
      refreshFreeStates();
    }, FLY_MS);
  }

  // ---------- public API ----------

  function startMatra(matra, curriculumIndex, totalCount) {
    clearPendingTimers(); // กันเศษ timer ค้างจากรอบก่อนหน้า (ปกติ stop() เคลียร์ไปแล้ว)
    currentMatraId = matra.id;
    const { pairCount, layerCount } = deriveDifficulty(matra, curriculumIndex);
    totalPairs = pairCount;
    matchedPairs = 0;
    held = null;
    tray = [];
    matchQueue = [];
    matchProcessing = false;
    _stuckVoicePlayed = false;
    if (dom.mahjongShuffleBtn) dom.mahjongShuffleBtn.classList.remove('pulse');
    if (dom.mahjongBigWord) dom.mahjongBigWord.classList.remove('show');
    if (dom.mahjongPointsPopup) dom.mahjongPointsPopup.classList.remove('show');
    hideHandCursor();

    const slots = buildPyramidLayout(pairCount, layerCount);
    const maxBoardCols = Math.max(...slots.map((s) => s.x)) + 1;
    const size = computeTileSize(maxBoardCols);
    tileW = size.w;
    tileH = size.h;

    const wordPool = shuffleArray(matra.words).slice(0, pairCount);
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

  function onPick(x, y) {
    // กันหยิบซ้อน: touch กับ AR pinch เปิดพร้อมกันได้ (ทั้งคู่เรียก onPick) —
    // ถ้านิ้วจริงกับจุดที่กล้องตรวจจับไม่ตรงเป๊ะกัน อาจยิง onPick 2 ครั้งคนละ
    // พิกัดจากท่าเดียว — เช็ค held ตัวเดียวพอ (คุมทั้งสองโหมด ครอบคลุมกว่าเช็ค
    // .flying แบบเดิม เพราะกันตั้งแต่จังหวะ "เริ่มจับ" ไม่ใช่แค่ตอน "กำลังบิน")
    if (!tiles.length || held) return;
    const el = document.elementFromPoint(x, y);
    const tileEl = el && el.closest && el.closest('.mj-tile');
    if (!tileEl) return;
    const tile = tiles.find((t) => t.el === tileEl);
    if (!tile || tile.state !== 'board' || !isTileFree(tile, tiles)) return;
    grabTile(tile);
  }

  function onMove(x, y) {
    if (!held) return;
    const rel = boardRelativePoint(x, y);
    held.el.style.left = (rel.x - tileW / 2) + 'px';
    held.el.style.top = (rel.y - tileH / 2) + 'px';
    if (isOverTray(x, y)) {
      if (tray.length < TRAY_CAPACITY) {
        const tile = held;
        held = null;
        heldBoardRect = null;
        heldTrayRect = null;
        dropIntoTray(tile); // แม่เหล็ก — ซ้อนถาดปุ๊บดูดเข้าเลย ไม่ต้องรอปล่อยมือ (ข้อ 4)
      } else {
        shakeTray();
      }
    }
  }

  function onRelease(x, y) {
    if (!held) return;
    const tile = held;
    held = null;
    const wasOverTray = isOverTray(x, y);
    heldBoardRect = null;
    heldTrayRect = null;
    if (wasOverTray && tray.length < TRAY_CAPACITY) {
      dropIntoTray(tile);
    } else {
      returnToBoard(tile);
    }
  }

  // ---------- AR hand cursor (ข้อ 10) — ไม่ซ้อนภาพกล้องจริง ใช้ภาพมือแทน
  // ตำแหน่งที่ mediapipe ติดตามได้ — pointer.js ไม่เรียก onHandFrame เลย (เฉพาะ
  // handpinch.js) จึงใช้เป็นสัญญาณ "AR กำลังทำงานอยู่" ได้ตรงๆ ----------
  let _lastHandOpen = null; // กันเซ็ต .src ซ้ำทุกเฟรม (~30fps) ตอนสถานะไม่เปลี่ยน
  function onHandFrame(frame) {
    if (!dom.mahjongHandCursor) return;
    if (!frame) { hideHandCursor(); _lastHandOpen = null; return; }
    dom.mahjongHandCursor.classList.remove('hidden');
    dom.mahjongHandCursor.style.left = frame.x + 'px';
    dom.mahjongHandCursor.style.top = frame.y + 'px';
    if (frame.open !== _lastHandOpen) {
      _lastHandOpen = frame.open;
      // มือกาง (ยังไม่จีบ) = Hand click.png, มือจีบหยิบ = Hand click2.png
      dom.mahjongHandCursor.src = frame.open
        ? 'public/assets/images/Hand%20click.png'
        : 'public/assets/images/Hand%20click2.png';
    }
  }

  function shuffle() {
    const pool = tiles.filter((t) => t.state !== 'matched');
    if (!pool.length) return;
    const wordObjs = shuffleArray(pool.map((t) => t.wordObj));
    pool.forEach((t, i) => {
      t.wordObj = wordObjs[i];
      t.word = wordObjs[i].display;
      t.color = wordColorMap.get(t.word); // สีตามคำใหม่ (คำเดียวกันสีเดียวกันเสมอ)
      if (t.wordEl) t.wordEl.textContent = t.word;
      if (t.el) t.el.style.color = t.color;
    });
    processTrayMatches();
  }

  function relayout() {
    if (!tiles.length) return;
    const maxBoardCols = Math.max(...tiles.map((t) => t.x)) + 1;
    const size = computeTileSize(maxBoardCols);
    tileW = size.w;
    tileH = size.h;
    sizeTraySlots();
    tiles.forEach((t) => { if (t.state === 'board') positionTileOnBoard(t); });
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
    if (dom.mahjongShuffleBtn) dom.mahjongShuffleBtn.classList.remove('pulse');
    if (dom.mahjongBigWord) dom.mahjongBigWord.classList.remove('show');
    if (dom.mahjongPointsPopup) dom.mahjongPointsPopup.classList.remove('show');
    hideHandCursor();
    _lastHandOpen = null;
    held = null; // ทิ้งไพ่ที่กำลังลากค้างอยู่ (ถ้ามี) ไปพร้อมกัน — DOM ถูกล้างไปแล้วข้างบน
    heldBoardRect = null;
    heldTrayRect = null;
    tiles = [];
    tray = [];
    matchQueue = [];
    matchProcessing = false;
    matchedPairs = 0;
    totalPairs = 0;
    _stuckVoicePlayed = false;
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
