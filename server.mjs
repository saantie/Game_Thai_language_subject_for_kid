// static server เล็ก ๆ สำหรับรันต้นแบบ (ES modules ต้องเสิร์ฟผ่าน HTTP)
//   node server.mjs   →  http://localhost:5173
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  // MediaPipe (AR mode) — .wasm ต้องถูก type ไม่งั้น streaming compile fail
  // ตกไปใช้ compile ช้า (production hosting ต้องตั้ง MIME นี้ด้วย)
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('404 not found');
      } else {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      }
    });
  })
  .listen(PORT, () => console.log(`▶ เปิดเกมที่  http://localhost:${PORT}`));
