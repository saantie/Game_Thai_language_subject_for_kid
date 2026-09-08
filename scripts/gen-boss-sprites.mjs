// scripts/gen-boss-sprites.mjs — ครอป 3 ท่าของบอสงูจาก sprite sheet ต้นฉบับ
// รันซ้ำได้: node scripts/gen-boss-sprites.mjs
//
// ต้นฉบับ image asset/black snake.png (500x500, RGBA) เป็น collage เฟรมไม่เป็น grid
// เลือก 3 เฟรมด้วยตา (ผ่าน browser: connected-component หา bbox) → ครอปชิดขอบ:
//   boss_move.png   งูเลื้อยด้านข้าง (ท่าเคลื่อนที่)
//   boss_attack.png งูชูคอแผ่พังพาน มองตรง (ท่าต่อสู้)
//   boss_death.png  งูชูคอ + ระเบิดพลังม่วง (ท่าตาย)
// worldMap.js drawMinion() สาขา m.isBoss เลือกภาพตาม state

import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../image asset/black snake.png');
const OUT = resolve(HERE, '../public/assets/images');

// ---------- minimal PNG reader (8-bit RGBA, no interlace, filter method 0) ----------
function readPNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not PNG');
  let pos = 8, w = 0, h = 0, bit = 0, color = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); bit = data[8]; color = data[9];
      if (bit !== 8 || color !== 6) throw new Error('expect 8-bit RGBA, got bit=' + bit + ' color=' + color);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = new Uint8Array(w * h * bpp);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const rv = raw[row + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      if (ft === 0) v = rv;
      else if (ft === 1) v = rv + a;
      else if (ft === 2) v = rv + b;
      else if (ft === 3) v = rv + ((a + b) >> 1);
      else if (ft === 4) v = rv + paeth(a, b, c);
      else throw new Error('bad filter ' + ft);
      out[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, data: out };
}

// ---------- PNG writer (RGBA — pattern เดียวกับ gen-hero-sprites.mjs) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function writePNG(path, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rowLen = w * 4;
  const raw = Buffer.alloc(h * (rowLen + 1));
  for (let y = 0; y < h; y++) { raw[y * (rowLen + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * rowLen, rowLen).copy(raw, y * (rowLen + 1) + 1); }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return png.length;
}

// ---------- ครอป (region ที่จะสแกน + trim ด้วย alpha) ----------
function cropTrim(img, region, name, outName) {
  const [rx, ry, rw, rh] = region;
  let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
    if (img.data[(y * img.w + x) * 4 + 3] > 20) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  }
  const pad = 2;
  minx = Math.max(0, minx - pad); miny = Math.max(0, miny - pad);
  maxx = Math.min(img.w - 1, maxx + pad); maxy = Math.min(img.h - 1, maxy + pad);
  const w = maxx - minx + 1, h = maxy - miny + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((miny + y) * img.w + (minx + x)) * 4, dst = (y * w + x) * 4;
    out[dst] = img.data[s]; out[dst + 1] = img.data[s + 1]; out[dst + 2] = img.data[s + 2]; out[dst + 3] = img.data[s + 3];
  }
  const bytes = writePNG(resolve(OUT, outName), w, h, out);
  console.log(`${outName}  ${w}x${h}  (src bbox ${minx},${miny})  ${(bytes / 1024).toFixed(1)} KB`);
}

const img = readPNG(readFileSync(SRC));
console.log(`source: ${img.w}x${img.h}`);
cropTrim(img, [248, 90, 110, 58], 'move', 'boss_move.png');   // งูเลื้อยด้านข้าง หัวขวา
cropTrim(img, [62, 20, 66, 66], 'attack', 'boss_attack.png');  // งูชูคอแผ่พังพาน มองตรง
cropTrim(img, [14, 225, 80, 80], 'death', 'boss_death.png');   // งูชูคอ + ระเบิดม่วง
