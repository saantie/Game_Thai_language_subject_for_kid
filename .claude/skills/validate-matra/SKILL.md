---
description: ตรวจ schema ของ src/data/matra.js — ป้องกัน silent bug จากโครงสร้างข้อมูลผิด
---

# /validate-matra

ตรวจความถูกต้องของข้อมูลใน `src/data/matra.js` ตาม contract ที่ `game.js` คาดหวัง
รายงานทุกปัญหาที่พบพร้อมบอก field และ index ที่ผิด ไม่แก้ไขโค้ดเกม

## ขั้นตอน

1. อ่าน `src/data/matra.js`

2. ตรวจ **ระดับ MATRA array**:
   - `id` ต้องไม่ซ้ำกันในทั้ง array
   - ทุก matra ต้องมี: `id` (string), `name` (string), `mode` ('TWO_PART' | 'FILL_FINAL'), `words` (array ≥1)
   - TWO_PART ต้องมี `bubbles` (array) ที่ครอบคลุมทุก `lead` ใน `words` — ถ้า `bubbles` ไม่มี lead ของ word ใด ฟองนั้นจะไม่สร้างคำ
   - FILL_FINAL ต้องมี `finalSound` (string)

3. ตรวจ **ระดับ word** (ทุก word ในทุก matra):
   - ต้องมี `display` (string ≠ ''), `spell` (array ≥2)
   - **`spell` ตัวสุดท้ายต้องเท่ากับ `display`** — ถ้าไม่ตรง TTS จะอ่านเฉลยแล้วพูดคำผิด
   - TWO_PART: ต้องมี `lead` (string), `sara` (string)
   - FILL_FINAL: ต้องมี `lead` (string), `final` (string, 1 ตัว), `distractors` (array ≥2)
     - `final` ต้องไม่อยู่ใน `distractors` — ถ้าอยู่ เกมอาจให้คำตอบถูกเป็น distractor
     - `distractors` ต้องไม่มีตัวซ้ำกัน
     - `final` ต้องเป็น 1 ตัวอักษร (บางครั้งพิมพ์ผิดเป็นคำเต็ม)

4. **รายงานผล** ในรูปแบบ:
   ```
   ✅ PASS  — ไม่พบปัญหา (N มาตรา, M คำ)
   ```
   หรือ:
   ```
   ❌ พบ X ปัญหา:
   
   [matra "kong" / word "ลิง" (index 0)]
     - spell ตัวสุดท้าย "ลิง" ≠ display "ลิ้ง" (ตรวจสอบวรรณยุกต์)
   
   [matra "kaka"]
     - bubbles ไม่มี lead "น" ซึ่งมีอยู่ใน words[2] (นา)
   ```

5. ถ้าพบปัญหา ถามว่าต้องการแก้ไขทันทีหรือไม่ ถ้าใช่ให้แก้เฉพาะ `src/data/matra.js` เท่านั้น
   ห้ามแก้ไข `game.js`, `scene.js` หรือไฟล์อื่น

## ห้ามทำ
- แก้ logic ใน game.js เพื่อ workaround ข้อมูลผิด
- เพิ่มคำหรือมาตราใหม่ (ใช้ /add-matra)
- รันคำสั่ง shell ที่ไม่ใช่ node --check
