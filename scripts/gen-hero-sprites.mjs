// scripts/gen-hero-sprites.mjs — แตกเฟรม GIF แม่มดน้อยเป็น sprite sheet PNG (RGBA)
// รันซ้ำได้: node scripts/gen-hero-sprites.mjs
//
// ***ทำไม***: worldMap.js เดิมเล่น GIF ฮีโร่ด้วย ImageDecoder (Chrome/Safari 17.4+) แล้ว
// fallback <img> ที่ Safari เก่าหยุดเดินเฟรม → บน iPad iOS < 17.4 แม่มดน้อยนิ่งสนิท
// (ดู memory gif-animation-on-canvas). Sprite sheet PNG + drawImage sub-rect เล่นได้ทุก
// browser ไม่ต้อง decode runtime. เฟรม GIF ทั้ง 3 ไฟล์ delay 200ms เท่ากันหมด
//
// เอาต์พุต: hero_stand.png (21f) / hero_walk.png (4f) / hero_atk.png (8f) เรียงเฟรมแนวนอน
// GIF ต้นฉบับเก็บไว้เป็น source — worldMap.js เลิกอ้างถึงแล้ว

import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'omggif';
const { GifReader } = pkg;

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG_DIR = resolve(HERE, '../public/assets/images');

// ---------- PNG writer (RGBA 8-bit, ไม่มี dependency — pattern เดียวกับ gen-textures.mjs) ----------
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
function writePNG(path, w, h, rgba /* Uint8Array w*h*4 */) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type 6 = RGBA
  // raw scanlines: filter byte 0 + row (w*4 bytes)
  const rowLen = w * 4;
  const raw = Buffer.alloc(h * (rowLen + 1));
  for (let y = 0; y < h; y++) {
    const ro = y * (rowLen + 1);
    raw[ro] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * rowLen, rowLen).copy(raw, ro + 1);
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

// ---------- แตก GIF → sprite strip ----------
function buildSheet(gifName, outName) {
  const buf = new Uint8Array(readFileSync(resolve(IMG_DIR, gifName)));
  const r = new GifReader(buf);
  const fw = r.width, fh = r.height, n = r.numFrames();
  const strip = new Uint8Array(fw * n * fh * 4); // RGBA, เฟรมเรียงแนวนอน
  const frame = new Uint8Array(fw * fh * 4);
  for (let i = 0; i < n; i++) {
    frame.fill(0); // disposal 2 (restore to bg) — เฟรมเต็มพื้นที่ทุกเฟรม เริ่มโปร่งใสก่อน
    r.decodeAndBlitFrameRGBA(i, frame);
    // คัดลอกลง strip ที่ offset x = i*fw
    for (let y = 0; y < fh; y++) {
      const src = y * fw * 4;
      const dst = (y * fw * n + i * fw) * 4;
      strip.set(frame.subarray(src, src + fw * 4), dst);
    }
  }
  const bytes = writePNG(resolve(IMG_DIR, outName), fw * n, fh, strip);
  console.log(`${outName}  ${fw * n}x${fh}  ${n} frames (${fw}x${fh} each)  ${(bytes / 1024).toFixed(1)} KB`);
  return { frames: n, fw, fh };
}

const stand = buildSheet('wish standing 30.gif', 'hero_stand.png');
const walk = buildSheet('wish walk 30.gif', 'hero_walk.png');
const atk = buildSheet('wish attact 30.gif', 'hero_atk.png');
console.log('\nframe counts → worldMap.js HERO_SHEETS:', JSON.stringify({ stand: stand.frames, walk: walk.frames, atk: atk.frames }));
