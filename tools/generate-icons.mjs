// generate-icons.mjs — สร้างไอคอน PWA (PNG จริง) โดยไม่ต้องพึ่ง asset/ไลบรารีภายนอก
// วาดด้วยคณิตศาสตร์ทีละพิกเซล แล้ว encode เป็น PNG ด้วย zlib ที่ติดมากับ node
//   node tools/generate-icons.mjs
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'icons');
fs.mkdirSync(OUT, { recursive: true });

// ---- CRC32 / PNG encoder ----
const crcTable = (() => {
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
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- วาดไอคอน: หม้อแม่มดเรืองแสง + ดาว บนพื้นม่วง ----
function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const na = a / 255;
    buf[i] = buf[i] * (1 - na) + r * na;
    buf[i + 1] = buf[i + 1] * (1 - na) + g * na;
    buf[i + 2] = buf[i + 2] * (1 - na) + b * na;
    buf[i + 3] = Math.max(buf[i + 3], a);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // พื้นหลัง: ไล่เฉดม่วง→น้ำเงินเข้ม (radial)
      const d = Math.hypot(x - cx, y - cx) / (size * 0.7);
      const r = 60 - d * 30;
      const g = 28 - d * 14;
      const b = 90 - d * 40;
      set(x, y, Math.max(8, r), Math.max(6, g), Math.max(20, b), 255);
    }
  }

  // ตัวหม้อ (วงรีดำ)
  const potY = size * 0.62;
  const potRx = size * 0.3;
  const potRy = size * 0.26;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - cx) / potRx;
      const ny = (y - potY) / potRy;
      if (nx * nx + ny * ny <= 1 && y >= potY - potRy * 0.2) {
        set(x, y, 24, 24, 34, 255);
      }
    }
  }
  // ของเหลวเรืองแสงเขียว (วงรีปากหม้อ)
  const liqY = potY - potRy * 0.45;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - cx) / (potRx * 0.82);
      const ny = (y - liqY) / (potRy * 0.4);
      const dd = nx * nx + ny * ny;
      if (dd <= 1) {
        const glow = 1 - dd;
        set(x, y, 120 + 80 * glow, 255, 180 + 40 * glow, 255);
      }
    }
  }
  // ดาวเหนือหม้อ
  drawStar(set, cx, size * 0.26, size * 0.13, size * 0.055, 255, 224, 120);
  drawStar(set, size * 0.72, size * 0.42, size * 0.05, size * 0.022, 255, 240, 170);
  drawStar(set, size * 0.26, size * 0.4, size * 0.04, size * 0.018, 255, 240, 170);

  return buf;
}

function drawStar(set, cx, cy, outer, inner, r, g, b) {
  // เติมรูปดาว 5 แฉกแบบ point-in-polygon
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  const minX = Math.floor(cx - outer),
    maxX = Math.ceil(cx + outer),
    minY = Math.floor(cy - outer),
    maxY = Math.ceil(cy + outer);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (inPoly(x + 0.5, y + 0.5, pts)) set(x, y, r, g, b, 255);
    }
  }
}
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0],
      yi = pts[i][1],
      xj = pts[j][0],
      yj = pts[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

for (const size of [192, 512]) {
  const png = encodePNG(size, size, draw(size));
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png);
  console.log(`wrote icons/icon-${size}.png (${png.length} bytes)`);
}
