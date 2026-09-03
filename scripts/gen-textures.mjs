// scripts/gen-textures.mjs — สร้าง texture พื้นหญ้า + ถนนดิน (seamless tile) เป็น PNG
// รันซ้ำได้: node scripts/gen-textures.mjs   (ไม่มี dependency — เขียน PNG เอง)
//
// ทำไมไม่ใช้ไฟล์ AI: ต้องการ tile ที่ต่อขอบไร้รอยต่อจริง (createPattern ใน worldMap.js)
// value-noise แบบ lattice wrap รอบ period → ขอบซ้าย=ขอบขวา, บน=ล่าง เป๊ะ
// ผู้ใช้แทนด้วยภาพ AI ทีหลังได้ ถ้าทำ tile ให้ต่อขอบเองและคงขนาด 256x256

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../public/assets/images');
const SIZE = 256;

// ---------- PNG writer (RGB, 8-bit, ไม่มี dependency) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function writePNG(path, size, rgb /* Uint8Array size*size*3 */) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type 2 = RGB
  // 10,11,12 = compression/filter/interlace = 0
  // raw scanlines: filter byte 0 + row
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const ro = y * (size * 3 + 1);
    raw[ro] = 0;
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 3;
      const di = ro + 1 + x * 3;
      raw[di] = rgb[si];
      raw[di + 1] = rgb[si + 1];
      raw[di + 2] = rgb[si + 2];
    }
  }
  const png = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return png.length;
}

// ---------- helpers ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const smooth = (t) => t * t * (3 - 2 * t);

// value noise ที่ wrap รอบ period → ต่อขอบ tile ไร้รอยต่อ
function makeNoise(period, rng) {
  const g = new Float64Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const cell = SIZE / period;
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const xa = ((x0 % period) + period) % period;
    const xb = (xa + 1) % period;
    const ya = ((y0 % period) + period) % period;
    const yb = (ya + 1) % period;
    const v00 = g[ya * period + xa], v10 = g[ya * period + xb];
    const v01 = g[yb * period + xa], v11 = g[yb * period + xb];
    return (
      (v00 * (1 - tx) + v10 * tx) * (1 - ty) +
      (v01 * (1 - tx) + v11 * tx) * ty
    );
  };
}
// fractal (fbm) จากหลาย octave — ทุก octave wrap เอง → ผลรวมก็ยัง seamless
function makeFbm(periods, rng) {
  const octs = periods.map((p) => makeNoise(p, rng));
  let ampSum = 0;
  const amps = periods.map((_, i) => { const a = 1 / (i + 1); ampSum += a; return a; });
  return (x, y) => {
    let s = 0;
    for (let i = 0; i < octs.length; i++) s += octs[i](x, y) * amps[i];
    return s / ampSum; // 0..1
  };
}

// วาดจุด/รอยแบบ wrap ขอบ (จุดใกล้ขอบโผล่อีกฝั่ง → tile ต่อเนื่อง)
function stamp(buf, cx, cy, r, fn) {
  const R = Math.ceil(r) + 1;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const x = ((cx + dx) % SIZE + SIZE) % SIZE;
      const y = ((cy + dy) % SIZE + SIZE) % SIZE;
      const i = (y * SIZE + x) * 3;
      fn(buf, i, d / r, dx, dy);
    }
  }
}

// ---------- พื้นหญ้า ----------
function makeGrass() {
  const rng = mulberry32(20260903);
  const patch = makeFbm([4, 8, 16], rng);   // หย่อมสี เขียวเข้ม/อ่อน
  const fine = makeFbm([32, 64], rng);      // ลายละเอียด
  const buf = new Uint8Array(SIZE * SIZE * 3);
  // โทนหญ้า: เขียวกลาง ปรับ ±lightness ตาม noise
  const BASE = [96, 143, 60];
  const DARK = [60, 100, 38];
  const LIGHT = [128, 176, 84];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const p = patch(x, y);            // 0..1
      const f = fine(x, y) - 0.5;       // -0.5..0.5
      let mix;
      if (p < 0.5) mix = lerp3(DARK, BASE, p * 2);
      else mix = lerp3(BASE, LIGHT, (p - 0.5) * 2);
      const grain = (rng() - 0.5) * 8 + f * 24;
      const i = (y * SIZE + x) * 3;
      buf[i] = clamp8(mix[0] + grain * 0.7);
      buf[i + 1] = clamp8(mix[1] + grain);
      buf[i + 2] = clamp8(mix[2] + grain * 0.5);
    }
  }
  // ใบหญ้าสั้น ๆ — ขีดแนวตั้ง 3–6px เข้ม/อ่อนสลับ ให้รู้สึกเป็นพงหญ้า
  for (let n = 0; n < 900; n++) {
    const x = (rng() * SIZE) | 0;
    const y0 = (rng() * SIZE) | 0;
    const h = 3 + (rng() * 4 | 0);
    const up = rng() < 0.5;
    const shade = up ? 22 : -26;
    for (let k = 0; k < h; k++) {
      const y = ((y0 - k) % SIZE + SIZE) % SIZE;
      const i = (y * SIZE + x) * 3;
      buf[i] = clamp8(buf[i] + shade * 0.5);
      buf[i + 1] = clamp8(buf[i + 1] + shade);
      buf[i + 2] = clamp8(buf[i + 2] + shade * 0.4);
    }
  }
  // ดอกไม้จิ๋ว/โคลเวอร์ กระจายบาง ๆ
  const FLOWERS = [[250, 240, 180], [245, 250, 250], [250, 210, 120]];
  for (let n = 0; n < 10; n++) {
    const c = FLOWERS[(rng() * FLOWERS.length) | 0];
    stamp(buf, (rng() * SIZE) | 0, (rng() * SIZE) | 0, 1.4 + rng(), (b, i, t) => {
      const a = (1 - t) * 0.9;
      b[i] = clamp8(b[i] * (1 - a) + c[0] * a);
      b[i + 1] = clamp8(b[i + 1] * (1 - a) + c[1] * a);
      b[i + 2] = clamp8(b[i + 2] * (1 - a) + c[2] * a);
    });
  }
  return buf;
}

// ---------- ถนนดิน ----------
function makeDirt() {
  const rng = mulberry32(555123);
  const patch = makeFbm([4, 8, 16], rng);
  const fine = makeFbm([32, 64], rng);
  const buf = new Uint8Array(SIZE * SIZE * 3);
  const BASE = [146, 108, 72];
  const DARK = [95, 68, 44];
  const LIGHT = [178, 142, 100];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const p = patch(x, y);
      const f = fine(x, y) - 0.5;
      let mix;
      if (p < 0.5) mix = lerp3(DARK, BASE, p * 2);
      else mix = lerp3(BASE, LIGHT, (p - 0.5) * 2);
      const grain = (rng() - 0.5) * 10 + f * 28;
      const i = (y * SIZE + x) * 3;
      buf[i] = clamp8(mix[0] + grain);
      buf[i + 1] = clamp8(mix[1] + grain * 0.85);
      buf[i + 2] = clamp8(mix[2] + grain * 0.7);
    }
  }
  // ก้อนกรวด — น้ำตาลอมเทา (ไม่ให้ออกฟ้าตัดกับดิน) ไฮไลต์บน เงาล่าง
  for (let n = 0; n < 18; n++) {
    const gx = (rng() * SIZE) | 0, gy = (rng() * SIZE) | 0;
    const r = 1.5 + rng() * 2.4;
    const tone = 132 + (rng() * 34 | 0);
    stamp(buf, gx, gy, r, (b, i, t, dx, dy) => {
      const a = (1 - t) * 0.8;
      const lit = dy < 0 ? 24 : -20;      // บนสว่าง ล่างเงา
      b[i] = clamp8(b[i] * (1 - a) + (tone + lit + 8) * a);
      b[i + 1] = clamp8(b[i + 1] * (1 - a) + (tone + lit) * a);
      b[i + 2] = clamp8(b[i + 2] * (1 - a) + (tone + lit - 18) * a);
    });
  }
  // ดินก้อนเข้ม — จุดคล้ำเล็ก ๆ
  for (let n = 0; n < 40; n++) {
    stamp(buf, (rng() * SIZE) | 0, (rng() * SIZE) | 0, 1 + rng() * 1.8, (b, i, t) => {
      const a = (1 - t) * 0.5;
      b[i] = clamp8(b[i] * (1 - a) + 70 * a);
      b[i + 1] = clamp8(b[i + 1] * (1 - a) + 50 * a);
      b[i + 2] = clamp8(b[i + 2] * (1 - a) + 34 * a);
    });
  }
  return buf;
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------- run ----------
mkdirSync(OUT_DIR, { recursive: true });
const g = writePNG(resolve(OUT_DIR, 'ground_grass.png'), SIZE, makeGrass());
const d = writePNG(resolve(OUT_DIR, 'road_dirt.png'), SIZE, makeDirt());
console.log(`ground_grass.png  ${SIZE}x${SIZE}  ${(g / 1024).toFixed(1)} KB`);
console.log(`road_dirt.png     ${SIZE}x${SIZE}  ${(d / 1024).toFixed(1)} KB`);
