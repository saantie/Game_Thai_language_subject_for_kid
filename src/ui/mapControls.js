// ui/mapControls.js — จอยสติ๊กโปร่งใส + ปุ่มแอคชัน บนหน้าแผนที่ RPG
//
// จอยสติ๊ก (ซ้ายล่าง): ลาก → worldMap.setJoystick(x,y) เวกเตอร์ -1..1 · ปล่อย → (0,0)
// ปุ่ม 4 อัน (ขวาล่าง): ⚔️ตี / 🧹บิน / 🦘กระโดด / ✨ยิงแสง → worldMap.doAction(name)
//   บิน/กระโดด/ยิงแสง = สกิลที่ต้องอัปด้วยแต้ม → เกรย์ถ้ายังไม่มี (refresh() เช็คใหม่)
// แตะพื้น/แตะบ้านเดิมยังใช้ได้ — จอยแค่ override ตอนเอียงเกิน deadzone

const ACTIONS = [
  { name: 'attack', icon: '⚔️', label: 'ตี', skill: null },
  { name: 'jump', icon: '🦘', label: 'กระโดด', skill: 'jump' },
  { name: 'fly', icon: '🧹', label: 'บิน', skill: 'fly' },
  { name: 'beam', icon: '✨', label: 'ยิงแสง', skill: 'beam' },
];

export function createMapControls({ joystickEl, actionsEl, worldMap }) {
  // ---- จอยสติ๊ก ----
  joystickEl.innerHTML = '<div class="joy-knob"></div>';
  const knob = joystickEl.querySelector('.joy-knob');
  let activeId = null;

  function centerOf() {
    const r = joystickEl.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, rad: r.width / 2 };
  }
  function apply(px, py) {
    const { cx, cy, rad } = centerOf();
    let dx = px - cx, dy = py - cy;
    const d = Math.hypot(dx, dy);
    const max = rad * 0.72;
    if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
    knob.style.transform = 'translate(' + dx.toFixed(0) + 'px,' + dy.toFixed(0) + 'px)';
    worldMap.setJoystick(dx / max, dy / max); // -1..1
  }
  function release() {
    activeId = null;
    knob.style.transform = 'translate(0,0)';
    worldMap.setJoystick(0, 0);
  }
  joystickEl.addEventListener('pointerdown', (e) => {
    activeId = e.pointerId;
    try { joystickEl.setPointerCapture(e.pointerId); } catch (err) {}
    apply(e.clientX, e.clientY);
    e.preventDefault();
  });
  joystickEl.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    apply(e.clientX, e.clientY);
  });
  joystickEl.addEventListener('pointerup', (e) => { if (e.pointerId === activeId) release(); });
  joystickEl.addEventListener('pointercancel', (e) => { if (e.pointerId === activeId) release(); });

  // ---- ปุ่มแอคชัน ----
  const btnEls = {};
  ACTIONS.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-act-btn' + (a.skill ? ' locked' : '');
    b.dataset.act = a.name;
    b.title = a.label;
    b.textContent = a.icon;
    // pointerdown ไม่ใช่ click — ตอบสนองไว + ไม่โดน 300ms tap delay
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (b.classList.contains('locked')) return;
      worldMap.doAction(a.name);
    });
    actionsEl.appendChild(b);
    btnEls[a.name] = b;
  });

  function refresh() {
    const st = worldMap.skillState();
    ACTIONS.forEach((a) => {
      if (!a.skill) return; // ตี = ปลดล็อกเสมอ
      btnEls[a.name].classList.toggle('locked', !st[a.skill]);
    });
  }
  refresh();

  return { refresh, release };
}
