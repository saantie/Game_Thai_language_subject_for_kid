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

// สกิล 4 อย่าง × 3 ระดับ = 12 แต้ม (≈ 60 คำ perfect) — เกมมี 171 คำ เล่นครบทุกมาตราได้เต็มพอดี
// levels[rank] : rank 0 = ค่าเริ่มต้นของเกม (ตรงกับค่าคงที่เดิมใน worldMap.js)
export const SKILLS = [
  {
    id: 'power', icon: '⚔️', name: 'ไม้กายสิทธิ์',
    desc: 'เหวี่ยงไม้ได้ถี่ขึ้น ตีลูกสมุนรัวขึ้น',
    // เฟรม cooldown ระหว่างเหวี่ยง — ยิ่งน้อยยิ่งตีถี่
    // (เลือกลด cooldown แทนเพิ่มดาเมจ เพราะ dmg+1 = ลูกสมุนตายทีเดียวตั้งแต่ระดับ 1 → พังบาลานซ์)
    levels: [26, 21, 16, 12],
    label: (v) => 'ตีทุก ' + (v / 60).toFixed(2) + ' วินาที',
  },
  {
    id: 'speed', icon: '👟', name: 'รองเท้าวิเศษ',
    desc: 'แม่มดน้อยเดินเร็วขึ้น หนีลูกสมุนทัน',
    // px ต่อเฟรม — ***ทุกระดับต้องมากกว่าความเร็วไล่ของลูกสมุนสูงสุด (2.1)*** ไม่งั้นหนีไม่ได้
    levels: [2.6, 3.0, 3.4, 3.8],
    label: (v) => 'ความเร็ว ' + v.toFixed(1),
  },
  {
    id: 'vigor', icon: '❤️', name: 'หัวใจนักสู้',
    desc: 'พลังหัวใจเพิ่ม โดนกัดได้หลายครั้งขึ้น',
    levels: [5, 6, 7, 8],
    label: (v) => v + ' หัวใจ',
  },
  {
    id: 'guard', icon: '🛡️', name: 'โล่มนตรา',
    desc: 'หลังโดนกัด อยู่ยงคงกระพันนานขึ้น',
    levels: [46, 70, 94, 118], // เฟรมอมตะหลังโดนกัด
    label: (v) => 'กันกัด ' + (v / 60).toFixed(1) + ' วินาที',
  },
];

export const MAX_RANK = 3;

// state ในหน่วยความจำ — โหลดครั้งเดียวตอน import, บันทึกทุกครั้งที่เปลี่ยน
let _state = normalize(loadRpg());

function normalize(raw) {
  const s = { xp: 0, spent: 0, skills: {} };
  if (raw && typeof raw === 'object') {
    s.xp = Math.max(0, parseInt(raw.xp, 10) || 0);
    if (raw.skills) {
      for (const sk of SKILLS) {
        s.skills[sk.id] = Math.max(0, Math.min(MAX_RANK, parseInt(raw.skills[sk.id], 10) || 0));
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
  if (cur >= MAX_RANK) return false;
  if (getRpg().pointsLeft < 1) return false;
  _state.skills[id] = cur + 1;
  _state.spent++;
  persist();
  return true;
}

// ค่าที่เกมใช้จริง — worldMap.js เรียกทุกครั้งที่ enter() (สกิลเปลี่ยนกลางคันได้)
export function getSkillEffects() {
  const r = _state.skills;
  return {
    attackCd: SKILLS[0].levels[r.power || 0],
    heroSpeed: SKILLS[1].levels[r.speed || 0],
    maxHp:     SKILLS[2].levels[r.vigor || 0],
    invuln:    SKILLS[3].levels[r.guard || 0],
  };
}

// ล้างทั้งหมด (ปุ่มรีเซ็ตเกม) — เรียกคู่กับ clearRpg() ใน storage
export function resetRpg() {
  _state = normalize(null);
  persist();
}
