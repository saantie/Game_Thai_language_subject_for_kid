// ui/levelSelect.js — หน้าเลือกมาตรา สร้างจาก data โดยตรง (ไม่ฮาร์ดโค้ด)

import { MATRA } from '../data/matra.js';

// progress: { [matraId]: stars(0-3) } เก็บใน app state กลาง
export function isUnlocked(app, index) {
  if (index === 0) return true;
  const prev = MATRA[index - 1];
  return (app.progress[prev.id] || 0) >= 1; // ผ่านมาตราก่อนหน้า (≥1 ดาว) จึงปลดล็อก
}

export function getStars(app, matraId) {
  return app.progress[matraId] || 0;
}

export function buildLevelSelect(container, app, onPick) {
  container.innerHTML = '';
  MATRA.forEach((m, i) => {
    const unlocked = isUnlocked(app, i);
    const stars = getStars(app, m.id);
    const card = document.createElement('button');
    card.className = 'level-card' + (unlocked ? '' : ' locked');
    card.disabled = !unlocked;
    card.innerHTML = `
      <span class="lv-icon">${unlocked ? '🪄' : '🔒'}</span>
      <span class="lv-name">${m.name}</span>
      <span class="lv-stars">${starString(stars)}</span>`;
    card.onclick = () => unlocked && onPick(m.id);
    container.appendChild(card);
  });
}

function starString(n) {
  let s = '';
  for (let i = 0; i < 3; i++) s += i < n ? '⭐' : '☆';
  return s;
}
