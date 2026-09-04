// rpg.js — ระบบเลเวล + สกิล (แหล่งความจริงเดียว)
//
// ลูปหลัก: อ่านสะกดคำถูก → ได้ XP → เลเวลขึ้น → ได้แต้มสกิล → อัปสกิลใช้บนแผนที่มนตรา
//   game.js เรียก addXp() ตอนอ่านถูก · skillPage.js แสดง/อัป · worldMap.js อ่าน getSkillEffects()
//
// ***ห้ามฮาร์ดโค้ดค่าสกิลที่อื่น*** — worldMap ต้องอ่านผ่าน getSkillEffects() เท่านั้น
// (เคยพลาดแบบนี้มาแล้วกับค่าที่เขียนซ้ำ 2 ที่ แล้วแก้ที่เดียว)

import { loadRpg, saveRpg } from './storage.js';

export const XP_PERFECT = 10; // อ่านถูกรอบเดียว
export const XP_RETRY   = 4;  // อ่านถูกหลังลองใหม่ (ยังได้ แต่น้อยกว่า → จูงใจให้ตั้งใจรอบเดียว)
export const XP_PER_LEVEL = 50; // ≈ 5 คำ perfect ต่อเลเวล

// สกิล 10 อย่าง — 4 อันแรกปรับสเตตัสแม่มด, 5–10 เป็นความสามารถต่อสู้ (เตรียมระบบไว้ GIF ทีหลัง)
// levels[rank] : rank 0 = ค่าเริ่มต้น (ตรงค่าคงที่เดิมใน worldMap.js) · sk.maxRank กี่ระดับ (ปกติ 3)
// งบแต้มรวม = 3×9 + 5 = 32 (≈ 160 คำ perfect · เกมมี 171 คำ → เป้าหมายปลายเกมพอดี)
export const SKILLS = [
  {
    id: 'power', icon: '⚔️', name: 'ไม้กายสิทธิ์',
    desc: 'เหวี่ยงไม้ได้ถี่ขึ้น ตีลูกสมุนรัวขึ้น',
    // เฟรม cooldown ระหว่างเหวี่ยง — ยิ่งน้อยยิ่งตีถี่
    // (เลือกลด cooldown แทนเพิ่มดาเมจ เพราะ dmg+1 = ลูกสมุนตายทีเดียวตั้งแต่ระดับ 1 → พังบาลานซ์)
    maxRank: 3, levels: [26, 21, 16, 12],
    label: (v) => 'ตีทุก ' + (v / 60).toFixed(2) + ' วินาที',
  },
  {
    id: 'speed', icon: '👟', name: 'รองเท้าวิเศษ',
    desc: 'แม่มดน้อยเดินเร็วขึ้น หนีลูกสมุนทัน',
    // px ต่อเฟรม — ***ทุกระดับต้องมากกว่าความเร็วไล่ของลูกสมุนสูงสุด (2.1)*** ไม่งั้นหนีไม่ได้
    maxRank: 3, levels: [2.6, 3.0, 3.4, 3.8],
    label: (v) => 'ความเร็ว ' + v.toFixed(1),
  },
  {
    id: 'vigor', icon: '❤️', name: 'หัวใจนักสู้',
    desc: 'พลังหัวใจเพิ่ม โดนกัดได้หลายครั้งขึ้น',
    maxRank: 3, levels: [5, 6, 7, 8],
    label: (v) => v + ' หัวใจ',
  },
  {
    id: 'guard', icon: '🛡️', name: 'โล่มนตรา',
    desc: 'หลังโดนกัด อยู่ยงคงกระพันนานขึ้น',
    maxRank: 3, levels: [46, 70, 94, 118], // เฟรมอมตะหลังโดนกัด
    label: (v) => 'กันกัด ' + (v / 60).toFixed(1) + ' วินาที',
  },
  {
    id: 'jump', icon: '🦘', name: 'กระโดดไกล',
    desc: 'แตะพื้นไกล ๆ = พุ่งกระโดดข้ามไปเร็วช่วงแรก',
    maxRank: 3, levels: [0, 3.2, 4.4, 5.6], // ตัวคูณความเร็วช่วงพุ่ง (0 = ยังไม่มี)
    label: (v) => (v ? 'พุ่งเร็ว ×' + v.toFixed(1) : 'ยังไม่มี'),
  },
  {
    id: 'broom', icon: '🧹', name: 'ขี่ไม้กวาดลอย',
    desc: 'โดนกัดแล้วลอยหนีชั่วครู่ ลูกสมุนพื้นกัดไม่โดน',
    maxRank: 3, levels: [0, 90, 150, 220], // เฟรมลอยหลังโดนกัด (0 = ยังไม่มี)
    label: (v) => (v ? 'ลอย ' + (v / 60).toFixed(1) + ' วินาที' : 'ยังไม่มี'),
  },
  {
    id: 'spin', icon: '🌀', name: 'ตีหมุนรอบตัว',
    desc: 'เหวี่ยงทีเดียวโดนลูกสมุนรอบตัวพร้อมกัน',
    maxRank: 3, levels: [0, 46, 60, 76], // รัศมี AoE (0 = ยังไม่มี)
    label: (v) => (v ? 'รัศมี ' + v : 'ยังไม่มี'),
  },
  {
    id: 'spinWide', icon: '💫', name: 'หมุนพลังกว้าง',
    desc: 'ตีหมุนวงกว้างขึ้น + ถีบกระเด็นแรง',
    maxRank: 3, levels: [0, 88, 116, 148],
    label: (v) => (v ? 'รัศมี ' + v : 'ยังไม่มี'),
  },
  {
    id: 'beam', icon: '✨', name: 'ยิงแสงเวทมนต์',
    desc: 'แตะลูกสมุนไกล ๆ = ยิงแสงใส่จากระยะไกล',
    maxRank: 3, levels: [0, 190, 270, 360], // ระยะยิง (0 = ยังไม่มี)
    label: (v) => (v ? 'ระยะ ' + v : 'ยังไม่มี'),
  },
  {
    id: 'helpers', icon: '🧚', name: 'สมุนผู้ช่วย',
    desc: 'มีผู้ช่วยสู้อัตโนมัติ ค่อย ๆ เพิ่มทีละตัว (สูงสุด 5)',
    maxRank: 5, levels: [0, 1, 2, 3, 4, 5], // จำนวนผู้ช่วย
    label: (v) => (v ? v + ' ตัว' : 'ยังไม่มี'),
  },
];

export const MAX_RANK = 3; // ค่า default — สกิลที่ต่างไปกำหนด sk.maxRank เอง

// state ในหน่วยความจำ — โหลดครั้งเดียวตอน import, บันทึกทุกครั้งที่เปลี่ยน
let _state = normalize(loadRpg());

function normalize(raw) {
  const s = { xp: 0, spent: 0, skills: {} };
  if (raw && typeof raw === 'object') {
    s.xp = Math.max(0, parseInt(raw.xp, 10) || 0);
    if (raw.skills) {
      for (const sk of SKILLS) {
        s.skills[sk.id] = Math.max(0, Math.min(sk.maxRank || MAX_RANK, parseInt(raw.skills[sk.id], 10) || 0));
      }
    }
  }
  for (const sk of SKILLS) if (s.skills[sk.id] == null) s.skills[sk.id] = 0;
  // spent คำนวณจาก rank จริง ไม่เก็บแยก — กันค่าเพี้ยนถ้า localStorage โดนแก้มือ
  s.spent = SKILLS.reduce((a, sk) => a + s.skills[sk.id], 0);
  // invariant: ใช้แต้มเกินที่เลเวลให้ไม่ได้ (เจอตอนทดสอบ: แก้ localStorage ให้ rank สูง
  // เกินเลเวล แล้วได้สกิลเต็มฟรี) — ตัด rank ลงจากสกิลท้ายสุดจนกว่าจะพอดี
  const budget = Math.max(0, Math.floor(s.xp / XP_PER_LEVEL));
  for (let i = SKILLS.length - 1; i >= 0 && s.spent > budget; i--) {
    const id = SKILLS[i].id;
    const cut = Math.min(s.skills[id], s.spent - budget);
    s.skills[id] -= cut;
    s.spent -= cut;
  }
  return s;
}

function persist() {
  saveRpg({ xp: _state.xp, skills: _state.skills });
}

export function getRpg() {
  const level = getLevel();
  return {
    xp: _state.xp,
    level,
    xpInLevel: _state.xp % XP_PER_LEVEL,
    xpToNext: XP_PER_LEVEL - (_state.xp % XP_PER_LEVEL),
    skills: Object.assign({}, _state.skills),
    pointsTotal: level - 1,                       // เลเวล 1 = 0 แต้ม, ทุกเลเวลถัดไป +1
    pointsLeft: Math.max(0, (level - 1) - _state.spent),
  };
}

export function getLevel() {
  return Math.floor(_state.xp / XP_PER_LEVEL) + 1;
}

// คืน { gained, leveledUp, level } — game.js ใช้ตัดสินใจว่าจะโชว์เอฟเฟกต์เลเวลอัปไหม
export function addXp(amount) {
  const before = getLevel();
  _state.xp += Math.max(0, amount | 0);
  persist();
  const after = getLevel();
  return { gained: amount, leveledUp: after > before, level: after };
}

// อัปสกิล 1 ระดับ — คืน true ถ้าสำเร็จ (มีแต้มพอ + ยังไม่เต็ม)
export function upgradeSkill(id) {
  const sk = SKILLS.find((s) => s.id === id);
  if (!sk) return false;
  const cur = _state.skills[id] || 0;
  if (cur >= (sk.maxRank || MAX_RANK)) return false;
  if (getRpg().pointsLeft < 1) return false;
  _state.skills[id] = cur + 1;
  _state.spent++;
  persist();
  return true;
}

// ค่าที่เกมใช้จริง — worldMap.js เรียกทุกครั้งที่ enter() (สกิลเปลี่ยนกลางคันได้)
export function getSkillEffects() {
  const r = _state.skills;
  const lv = (id) => {
    const sk = SKILLS.find((s) => s.id === id);
    return sk.levels[r[id] || 0];
  };
  return {
    attackCd:  lv('power'),
    heroSpeed: lv('speed'),
    maxHp:     lv('vigor'),
    invuln:    lv('guard'),
    jump:      lv('jump'),      // ตัวคูณความเร็วช่วงพุ่ง (0 = ปิด)
    broom:     lv('broom'),     // เฟรมลอยหลังโดนกัด (0 = ปิด)
    spin:      lv('spin'),      // รัศมี AoE เหวี่ยง (0 = ปิด)
    spinWide:  lv('spinWide'),  // รัศมี AoE กว้าง + ถีบแรง (0 = ปิด)
    beam:      lv('beam'),      // ระยะยิงแสง (0 = ปิด)
    helpers:   lv('helpers'),   // จำนวนผู้ช่วย
  };
}

// ล้างทั้งหมด (ปุ่มรีเซ็ตเกม) — เรียกคู่กับ clearRpg() ใน storage
export function resetRpg() {
  _state = normalize(null);
  persist();
}
