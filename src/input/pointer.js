// input/pointer.js — input layer ต้นแบบ (นิ้ว/เมาส์)
// ยิง event เดียวกับ handpinch.js (MediaPipe) เพื่อให้เกมไม่รู้ว่ามาจากไหน:
//   onPick(x,y) / onMove(x,y) / onRelease(x,y)  — พิกัดเป็น CSS px เทียบ canvas

export function createPointerInput(canvas, handlers) {
  const { onPick, onMove, onRelease } = handlers;
  let active = false;

  function toLocal(e) {
    const r = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }

  function down(e) {
    active = true;
    const { x, y } = toLocal(e);
    onPick && onPick(x, y);
  }
  function move(e) {
    if (!active) return;
    const { x, y } = toLocal(e);
    onMove && onMove(x, y);
    if (e.cancelable) e.preventDefault();
  }
  function up(e) {
    if (!active) return;
    active = false;
    // touchend ไม่มี touches → ใช้ตำแหน่งล่าสุดผ่าน changedTouches
    let pt;
    if (e.changedTouches && e.changedTouches[0]) {
      const r = canvas.getBoundingClientRect();
      pt = { x: e.changedTouches[0].clientX - r.left, y: e.changedTouches[0].clientY - r.top };
    } else {
      pt = toLocal(e);
    }
    onRelease && onRelease(pt.x, pt.y);
  }

  canvas.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  canvas.addEventListener('touchstart', down, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', up);

  return {
    destroy() {
      canvas.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      canvas.removeEventListener('touchstart', down);
      canvas.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    },
  };
}
