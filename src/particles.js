// particles.js — ระบบ particle pool (object pool) แยกออกจาก game.js เพื่อให้
// ใช้ร่วมกันได้ระหว่างเกมหลัก (หยิบฟอง) กับมินิเกมอุ่นเครื่อง (ไพ่จับคู่)
// ย้ายมาแบบคงพฤติกรรมเดิมทุกจุด (แรงโน้มถ่วง/decay/จำนวนอนุภาค/noGlow) —
// ไม่ใช่การรีดีไซน์ ดู src/game.js เดิมก่อน commit นี้เทียบพฤติกรรมได้

export function createParticleSystem(fx) {
  const particles = [];
  const particlePool = [];

  function acquire() {
    return particlePool.pop() || {};
  }

  function add(p) {
    particles.push(p);
  }

  function spawnExplosion(cx, cy) {
    for (let i = 0; i < 26; i++) {
      const p = acquire();
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      p.x = cx; p.y = cy;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 2;
      p.life = 1; p.r = 3 + Math.random() * 5;
      p.hue = 120 + Math.random() * 80; p.star = false; p.shard = false;
      p.fillStyle = `hsl(${p.hue},90%,60%)`; // cache สีไว้ตอน spawn — ไม่คำนวณ string ซ้ำทุกเฟรมใน drawParticle
      add(p);
    }
  }

  function spawnStars(cx, cy) {
    for (let i = 0; i < 32; i++) {
      const p = acquire();
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 7;
      p.x = cx; p.y = cy;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 4;
      p.life = 1;
      p.r = 10 + Math.random() * 14; // ⭐ ใหญ่ขึ้นเห็นชัด
      p.hue = 42 + Math.random() * 18;
      p.star = true; p.shard = false;
      p.fillStyle = `hsl(${p.hue},90%,60%)`;   // cache สีไว้ตอน spawn (ดู spawnExplosion)
      p.shadowStyle = `hsl(${p.hue},100%,70%)`;
      add(p);
    }
  }

  // ดาวระเบิดแบบประหยัดทรัพยากร — ตัด shadowBlur (glow) ออก เพราะเป็นต้นทุนแพงสุด
  // ต่ออนุภาคบน canvas (บังคับ browser ทำ blur pass) ชดเชยด้วยขนาดใหญ่ขึ้น +
  // กระจายมุมสม่ำเสมอ (แทนสุ่มล้วน) ให้ยังดูเป็น "ดาวกระจาย" ชัดแม้ประหยัดกว่าเดิมมาก
  // hueMin/hueRange เลือกธีมสีได้ (ค่า default = ทองเดิม ไม่กระทบ call site เดิม)
  function spawnCelebrationBurst(cx, cy, { hueMin = 42, hueRange = 18 } = {}) {
    const COUNT = 16;
    for (let i = 0; i < COUNT; i++) {
      const p = acquire();
      const a = (i / COUNT) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 2 + Math.random() * 6;
      p.x = cx; p.y = cy;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 3;
      p.life = 1;
      p.r = 12 + Math.random() * 12; // ใหญ่ขึ้นชดเชยที่ตัด glow ออก
      p.hue = hueMin + Math.random() * hueRange;
      p.star = true; p.shard = false;
      p.noGlow = true; // ★ ข้าม shadowBlur ใน drawParticle — ประหยัดสุด
      p.fillStyle = `hsl(${p.hue},95%,62%)`;
      add(p);
    }
  }

  // เศษไพ่แตกกระเด็นเบาๆ แล้วร่วงหล่นลง (ตอนจับคู่ไพ่สำเร็จ) — ต่างจาก
  // spawnCelebrationBurst ตรงไม่พุ่งขึ้น ใช้แรงกระเด็นต่ำ + tumble (rot/rotSpeed)
  // ให้ดูเหมือนเศษวัตถุแตกร่วงจริงๆ ไม่ใช่ดาวประทุ — สีชิ้นส่วนใช้สีของไพ่คู่ที่
  // จับได้เอง (ทึบแสงเต็มที่ ไม่ใช่สีขาวโปร่งแสงแบบแก้วเหมือนเดิม) ให้เห็นชัด
  // และเข้ากับสีคำที่จับคู่ (ดู wordColorMap ใน mahjong.js)
  function spawnGlassShards(cx, cy, color = '#ffffff') {
    const COUNT = 28; // เพิ่มอีก 2 เท่าจากเดิม (14) ให้ระเบิดดูอลังการชัดเจนขึ้น
    for (let i = 0; i < COUNT; i++) {
      const p = acquire();
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3.5;
      p.x = cx + (Math.random() - 0.5) * 12;
      p.y = cy + (Math.random() - 0.5) * 12;
      p.vx = Math.cos(a) * sp * 0.8;
      p.vy = Math.sin(a) * sp * 0.5 - 1.6; // กระเด็นออกชัดเจนขึ้นก่อนโน้มถ่วงดึงลง
      p.life = 1;
      p.decay = 0.011; // อยู่นานกว่าอนุภาคดาวปกติ ให้เห็นร่วงตกชัดเจน
      p.r = 8 + Math.random() * 10; // ใหญ่ขึ้นชัดเจนจากเดิม (3-8px) ให้เห็นง่ายกว่าเดิม
      p.rot = Math.random() * Math.PI * 2;
      p.rotSpeed = (Math.random() - 0.5) * 0.35;
      p.shard = true;
      p.fillStyle = color; // ทึบแสงเต็มที่ (ไม่ใช้ rgba โปร่งแสงแบบเดิม)
      add(p);
    }
  }

  function update() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.22;
      if (p.rotSpeed) p.rot += p.rotSpeed;
      p.life -= p.decay || 0.018;
      if (p.life <= 0) { particles.splice(i, 1); particlePool.push(p); }
    }
  }

  function drawParticle(p) {
    fx.save();
    fx.globalAlpha = Math.max(0, p.life);
    fx.fillStyle = p.fillStyle; // cache ไว้ตอน spawn — เลี่ยงสร้าง string ใหม่ทุกเฟรม/ทุกอนุภาค
    if (p.shard) {
      // เศษผลึกแก้ว — สี่เหลี่ยมเล็กหมุน tumble ตกลง (ดู spawnGlassShards)
      fx.translate(p.x, p.y);
      fx.rotate(p.rot || 0);
      fx.fillRect(-p.r, -p.r * 0.4, p.r * 2, p.r * 0.8);
    } else if (p.star) {
      // ขอบเรืองให้เห็นชัด — ข้ามได้ถ้า noGlow (shadowBlur แพงสุดต่ออนุภาคบน canvas,
      // ใช้กับ burst ที่มีอนุภาคเยอะๆ พร้อมกันเท่านั้น ดู spawnCelebrationBurst)
      if (!p.noGlow) {
        fx.shadowColor = p.shadowStyle;
        fx.shadowBlur = p.r * 0.8;
      }
      drawStar(fx, p.x, p.y, p.r, p.r * 0.45, 5);
    } else {
      fx.beginPath();
      fx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      fx.fill();
    }
    fx.restore();
  }

  function draw() {
    particles.forEach(drawParticle);
  }

  function clear() {
    while (particles.length) particlePool.push(particles.pop());
  }

  return {
    acquire,
    add,
    spawnExplosion,
    spawnStars,
    spawnCelebrationBurst,
    spawnGlassShards,
    update,
    draw,
    clear,
    get count() { return particles.length; },
  };
}

function drawStar(ctx, cx, cy, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / points - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
