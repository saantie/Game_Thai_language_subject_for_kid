---
description: sync APP_SHELL ใน sw.js กับไฟล์จริง และ bump cache version — ป้องกัน offline stale
---

# /sw-sync

ทำให้ `sw.js` สอดคล้องกับไฟล์ที่มีอยู่จริงในโปรเจกต์เสมอ
ต้องรัน **ทุกครั้งที่เพิ่ม/ลบ/เปลี่ยนชื่อไฟล์** ใน `src/`, `icons/`, หรือ root

## ขั้นตอน

1. อ่าน `sw.js` — ดึง:
   - ค่า `CACHE` version ปัจจุบัน (เช่น `'witch-cauldron-v1'`)
   - รายการ `APP_SHELL` ปัจจุบัน

2. Glob หาไฟล์จริงที่ต้องแคช:
   - `src/**/*.js`, `src/**/*.css`
   - `icons/*.png`
   - `index.html`, `manifest.webmanifest`, `sw.js`
   - **ยกเว้น:** `server.mjs`, `tools/`, `node_modules/`, `.claude/`, `.github/`
   - **ยกเว้น asset ที่ยังไม่มีจริง** (ไฟล์ใน `public/assets/` ที่ lazy-load ไม่ต้องแคชล่วงหน้า)

3. เปรียบเทียบ:
   - ไฟล์ที่มีจริงแต่ **ไม่อยู่ใน APP_SHELL** → ต้องเพิ่ม
   - path ใน APP_SHELL ที่ **ไม่มีไฟล์จริง** → ต้องลบ (stale entry ทำให้ SW install fail แบบ silent)

4. รายงานความต่าง:
   ```
   + เพิ่ม: ./src/ui/newScreen.js
   - ลบ:   ./src/ui/oldScreen.js  (ไม่มีไฟล์แล้ว)
   = คงเดิม: 18 ไฟล์
   ```

5. ถ้ามีความต่าง — อัปเดต `sw.js`:
   - แก้ `APP_SHELL` ให้ตรงกับไฟล์จริง (เรียงตาม path)
   - bump CACHE version: `vN` → `v(N+1)`
   - แสดง diff ที่แก้ให้เห็น

6. ถ้าไม่มีความต่าง:
   ```
   ✅ sw.js ซิงค์กับไฟล์จริงแล้ว (CACHE = witch-cauldron-vN)
   ```

## กฎสำคัญ
- แก้เฉพาะ `sw.js` เท่านั้น ห้ามแก้ไฟล์อื่น
- path ใน APP_SHELL ต้องขึ้นต้นด้วย `./` เสมอ (relative to SW scope)
- ห้าม bump version ถ้าไม่มีความต่างจริง (cache invalidation ทั่วโลกมีต้นทุน)
- ไม่ต้องใส่ font Google (cross-origin, SW ไม่ควร cache)
