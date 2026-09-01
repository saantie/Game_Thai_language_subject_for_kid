// ui/skillPage.js — หน้าอัปสกิล (เปิดจากปุ่ม ⚔️ บนแผนที่มนตรา)
//
// สร้างจาก SKILLS ใน rpg.js โดยตรง ไม่ฮาร์ดโค้ด — เพิ่มสกิลใหม่ที่ rpg.js แล้วหน้านี้ขึ้นเอง
// แถบ XP อยู่ที่นี่ (ไม่ใช่บน HUD แผนที่) พร้อมข้อความ "อ่านอีก N คำ" ทำหน้าที่จูงใจ

import { SKILLS, MAX_RANK, XP_PERFECT, XP_PER_LEVEL, getRpg, upgradeSkill } from '../rpg.js';
import { audio } from '../audio.js';

export function buildSkillPage(container) {
  const r = getRpg();
  const pct = Math.round((r.xpInLevel / XP_PER_LEVEL) * 100);
  // อ่านถูกรอบเดียวได้ XP_PERFECT — ปัดขึ้นเป็นจำนวนคำที่ต้องอ่านอีก
  const wordsToNext = Math.max(1, Math.ceil(r.xpToNext / XP_PERFECT));

  container.innerHTML = `
    <button id="skillBackBtn" class="btn-back" title="กลับแผนที่">
      <img src="public/assets/images/Arrow.png" alt="กลับ" class="back-arrow-img" />
    </button>
    <h2>&#9876;&#65039; สกิลแม่มดน้อย</h2>

    <div class="skill-head">
      <div class="skill-lv">Lv.<span class="skill-lv-num">${r.level}</span></div>
      <div class="skill-xp">
        <div class="skill-xp-track"><div class="skill-xp-fill" style="width:${pct}%"></div></div>
        <div class="skill-xp-text">${r.xpInLevel} / ${XP_PER_LEVEL} XP</div>
      </div>
      <div class="skill-points ${r.pointsLeft > 0 ? 'has' : ''}">
        <span class="sp-label">แต้มสกิล</span>
        <span class="sp-num">${r.pointsLeft}</span>
      </div>
    </div>

    <div class="skill-nudge">
      ${r.pointsLeft > 0
        ? '&#127881; มีแต้มสกิลว่าง! กดปุ่ม <b>อัป</b> ที่สกิลที่อยากเก่งขึ้นได้เลย'
        : `&#128214; อ่านสะกดคำให้ถูกอีก <b>${wordsToNext}</b> คำ จะได้แต้มสกิลเพิ่ม!`}
    </div>

    <div class="skill-grid">${SKILLS.map((sk) => cardHtml(sk, r)).join('')}</div>
  `;

  // ปุ่มอัป — อัปสำเร็จแล้ว re-render ทั้งหน้า (state เดียว ไม่ต้อง sync DOM ทีละจุด)
  container.querySelectorAll('.skill-up-btn').forEach((btn) => {
    btn.onclick = () => {
      if (upgradeSkill(btn.dataset.skill)) {
        audio.sfx('star');
        buildSkillPage(container);
        container.querySelector('#skillBackBtn').onclick = _onBack;
        const card = container.querySelector(`[data-card="${btn.dataset.skill}"]`);
        if (card) { card.classList.add('just-up'); setTimeout(() => card.classList.remove('just-up'), 600); }
      } else {
        audio.sfx('tile_blocked');
      }
    };
  });
}

// เก็บ callback ปุ่มกลับไว้ เพราะ re-render หลังอัปสกิลจะสร้าง element ใหม่
let _onBack = null;
export function setSkillPageBack(container, cb) {
  _onBack = cb;
  const b = container.querySelector('#skillBackBtn');
  if (b) b.onclick = cb;
}

function cardHtml(sk, r) {
  const rank = r.skills[sk.id] || 0;
  const maxed = rank >= MAX_RANK;
  const canUp = !maxed && r.pointsLeft > 0;
  let pips = '';
  for (let i = 0; i < MAX_RANK; i++) pips += `<span class="pip ${i < rank ? 'on' : ''}"></span>`;
  const now = sk.label(sk.levels[rank]);
  const next = maxed ? '' : `<span class="skill-next">&#8594; ${sk.label(sk.levels[rank + 1])}</span>`;
  return `
    <div class="skill-card ${maxed ? 'maxed' : ''}" data-card="${sk.id}">
      <div class="skill-icon">${sk.icon}</div>
      <div class="skill-body">
        <div class="skill-name">${sk.name}</div>
        <div class="skill-desc">${sk.desc}</div>
        <div class="skill-pips">${pips}</div>
        <div class="skill-val">${now}${next}</div>
      </div>
      <button class="skill-up-btn ${canUp ? '' : 'off'}" data-skill="${sk.id}" ${canUp ? '' : 'disabled'}>
        ${maxed ? 'เต็มแล้ว' : 'อัป'}
      </button>
    </div>`;
}
