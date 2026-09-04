// items.js — ไอเทมพลังวิเศษ 5 อย่าง เก็บสะสมจากลูกสมุนหล่น (โอกาสน้อย) ใช้แล้วหมดไป
// แหล่งความจริงเดียวเรื่อง data + inventory — worldMap.js (spawn/effect) และ main.js (แถบ UI ล่างจอ) อ่านผ่านนี่
//
// ***ห้ามฮาร์ดโค้ดไอคอน/ชื่อ/effect ที่อื่น*** — เพิ่ม/แก้ไอเทมที่ ITEM_TYPES ที่เดียว

import { loadItems, saveItems } from './storage.js';

export const MAX_STACK = 9; // กันแถบ badge ตัวเลขยาวเกิน

export const ITEM_TYPES = [
  {
    id: 'ring', icon: '💥', name: 'ระเบิดวงแหวน', color: '#ff9a4a',
    desc: 'ตีลูกสมุนทุกตัวที่อยู่ในจอพร้อมกัน แรงเท่าโดนตี 2 ครั้ง',
  },
  {
    id: 'invis', icon: '👻', name: 'หายตัว', color: '#9ad0ff',
    desc: 'ล่องหน 10 วินาที ลูกสมุนกัดไม่โดน',
  },
  {
    id: 'shield', icon: '🛡️', name: 'โล่วิเศษ', color: '#7fe6a0',
    desc: 'กันโดนกัดครั้งถัดไป 1 ครั้ง (ไม่เสียหัวใจ)',
  },
  {
    // ไอคอน 🌀 (ไม่ใช้ 🧲) — 🧲 เป็นอิโมจิรุ่นใหม่ (Unicode 11, 2018) บางฟอนต์/มือถือรุ่นเก่า
    // แสดงเป็นกล่องเทาว่าง (ทดสอบเจอใน headless Chromium) 🌀 รุ่นเก่ากว่ามาก รองรับกว้างกว่า
    id: 'magnet', icon: '🌀', name: 'แม่เหล็กเวทมนตร์', color: '#ff6ea0',
    desc: 'ดูดพลอย/เหรียญที่อยู่ในจอมาเก็บทันที',
  },
  {
    id: 'giant', icon: '⚡', name: 'พลังยักษ์ทลาย', color: '#ffe066',
    desc: 'ตัวใหญ่ยักษ์ 8 วินาที เดินชนลูกสมุนก็ล้มเลย ไม่ต้องตี',
  },
];

let _inv = normalize(loadItems());

function normalize(raw) {
  const s = {};
  for (const it of ITEM_TYPES) {
    s[it.id] = Math.max(0, Math.min(MAX_STACK, parseInt(raw && raw[it.id], 10) || 0));
  }
  return s;
}

function persist() {
  saveItems(_inv);
}

// ก็อปปี้ออกไป — ห้ามแก้ object ที่ได้คืนตรงๆ (ต้องผ่าน addItem/useItem เพื่อ persist)
export function getInventory() {
  return Object.assign({}, _inv);
}

export function addItem(id) {
  if (!_inv.hasOwnProperty(id)) return;
  _inv[id] = Math.min(MAX_STACK, _inv[id] + 1);
  persist();
}

// คืน true ถ้าใช้สำเร็จ (มีของ) — false ถ้าของหมด (ปุ่มควรกดไม่ได้อยู่แล้วตอนเทาๆ)
export function useItem(id) {
  if (!_inv.hasOwnProperty(id) || _inv[id] <= 0) return false;
  _inv[id]--;
  persist();
  return true;
}

// สุ่มชนิดไอเทมตอนลูกสมุนหล่นของ (Math.random จริง — สุ่ม gameplay ต่อ event ไม่ใช่ layout ที่ต้อง deterministic)
export function randomItemId() {
  return ITEM_TYPES[(Math.random() * ITEM_TYPES.length) | 0].id;
}

export function itemDef(id) {
  return ITEM_TYPES.find((it) => it.id === id) || null;
}
