// scripts/gen-boss-sprites.mjs — บอสงู 4 ทิศ + โจมตี + ตาย → sprite sheet PNG
// รันซ้ำได้: node scripts/gen-boss-sprites.mjs
//
// ต้นฉบับ image asset/black snake/ : front/back/left/Right/Attrak เป็น GIF (256x256,
// 200ms/เฟรม) · Dead.png เป็น PNG เฟรมเดียว
//   ***ทำไม GIF → PNG strip***: iOS Safari เก่าหยุดเดินเฟรม GIF (บทเรียน v226) —
//   drawImage sub-rect ตามนาฬิกาเกมเล่นได้ทุก browser · pattern เดียวกับ gen-hero-sprites.mjs
//
// เอาต์พุต (public/assets/images/): boss_front/back/left/right/attack (strip แนวนอน) +
// boss_dead (เฟรมเดียว) — ***ครอปด้วย union bbox เดียวกันทั้ง 6*** → ทุก sheet ขนาดเท่ากัน
// anchor ตรงกันเป๊ะ บอสไม่เด้งขนาดตอนเปลี่ยนทิศ

import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'omggif';
const { GifReader } = pkg;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRCDIR = resolve(HERE, '../image asset/black snake');
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

// ---------- โหลดทุก anim เป็นเฟรม RGBA (256x256 ต่อเฟรม) ----------
const FW = 256, FH = 256;
function loadGifFrames(name) {
  const r = new GifReader(new Uint8Array(readFileSync(resolve(SRCDIR, name))));
  const n = r.numFrames();
  const frames = [];
  for (let i = 0; i < n; i++) {
    const f = new Uint8Array(FW * FH * 4);       // disposal 2 (restore bg) — เริ่มโปร่งใส
    r.decodeAndBlitFrameRGBA(i, f);
    frames.push(f);
  }
  return frames;
}
function loadPngFrame(name) {
  const p = readPNG(readFileSync(resolve(SRCDIR, name)));
  if (p.w !== FW || p.h !== FH) throw new Error(name + ' expect 256x256');
  return [p.data];
}

const ANIMS = {
  front:  loadGifFrames('front.gif'),
  back:   loadGifFrames('back.gif'),
  left:   loadGifFrames('left.gif'),
  right:  loadGifFrames('Right.gif'),
  attack: loadGifFrames('Attrak.gif'),
  dead:   loadPngFrame('Dead.png'),
};

// ---------- union bbox ของทุกเฟรม (alpha > 20) ----------
let minx = FW, miny = FH, maxx = -1, maxy = -1;
for (const frames of Object.values(ANIMS)) for (const fr of frames) {
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    if (fr[(y * FW + x) * 4 + 3] > 20) {
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
  }
}
const pad = 3;
minx = Math.max(0, minx - pad); miny = Math.max(0, miny - pad);
maxx = Math.min(FW - 1, maxx + pad); maxy = Math.min(FH - 1, maxy + pad);
const CW = maxx - minx + 1, CH = maxy - miny + 1;
console.log(`union bbox ${minx},${miny}  cell ${CW}x${CH}`);

// ---------- เขียน strip แนวนอนต่อ anim (ครอปด้วย union bbox เดียวกัน) ----------
for (const [name, frames] of Object.entries(ANIMS)) {
  const n = frames.length;
  const strip = new Uint8Array(CW * n * CH * 4);
  for (let i = 0; i < n; i++) {
    const fr = frames[i];
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const s = ((miny + y) * FW + (minx + x)) * 4;
      const d = (y * CW * n + i * CW + x) * 4;
      strip[d] = fr[s]; strip[d + 1] = fr[s + 1]; strip[d + 2] = fr[s + 2]; strip[d + 3] = fr[s + 3];
    }
  }
  const bytes = writePNG(resolve(OUT, `boss_${name}.png`), CW * n, CH, strip);
  console.log(`boss_${name}.png  ${CW * n}x${CH}  ${n}f  ${(bytes / 1024).toFixed(1)} KB`);
}
console.log('\nframe counts → worldMap.js BOSS_ANIM:',
  JSON.stringify(Object.fromEntries(Object.entries(ANIMS).map(([k, v]) => [k, v.length]))));
