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
