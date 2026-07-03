// storage.js — บันทึก/โหลด progress ผ่าน localStorage
const KEY = 'witch_progress';

export function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch (e) {
    return {};
  }
}

export function saveProgress(progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch (e) {}
}

export function clearProgress() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {}
}

// ---- setting: โหมด AR (ปุ่มเปิด/ปิดหน้าแรก) — default เปิด ----
const AR_KEY = 'witch_ar_enabled';

export function loadArEnabled() {
  try {
    return localStorage.getItem(AR_KEY) !== '0';
  } catch (e) {
    return true;
  }
}

export function saveArEnabled(on) {
  try {
    localStorage.setItem(AR_KEY, on ? '1' : '0');
  } catch (e) {}
}
