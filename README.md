# 🧙‍♀️ หม้อแม่มดผสมคำ (Witch's Cauldron)

เกมฝึก **อ่านสะกดคำภาษาไทยตามมาตราตัวสะกด** สำหรับเด็ก สร้างตาม [Claude.md](Claude.md) (Technical Implementation Spec v2)

เด็กลากตัวอักษร (ฟอง) ลงหม้อแม่มดเพื่อประกอบคำ แล้วอ่านออกเสียงให้แม่มดฟังเพื่อรับดาว ⭐

---

## เล่นออนไลน์ (ไม่ต้องติดตั้ง)

หลัง push ขึ้น GitHub ไปที่:

```
https://<username>.github.io/<repo-name>/
```

ตัวอย่าง: `https://saantie.github.io/Game_Thai_language_subject_for_kid/`

---

## ติดตั้งเป็นแอปลงเครื่อง (PWA)

เมื่อเปิดด้วย Chrome/Edge บนมือถือหรือเดสก์ท็อป จะมีปุ่ม **"ติดตั้งแอป"** ให้กด
จากนั้นเล่น offline ได้โดยไม่ต้องต่อเน็ต — Service Worker แคชทุกไฟล์ให้อัตโนมัติ

> **รองรับ:** Chrome (Android/Desktop) · Edge · Safari บน iOS/macOS ≥ 16.4
> **ด่านอ่านออกเสียง:** ต้องการ Chrome หรือ Edge (Web Speech Recognition); iOS Safari จะใช้ปุ่มผู้ปกครองแทน

---

## Deploy ขึ้น GitHub Pages (ฟรี)

1. Push โค้ดขึ้น `main` branch
2. เปิด **Settings → Pages → Source** เลือก **GitHub Actions**
3. Push อีกครั้ง (หรือกด **Run workflow** ใน Actions tab)
4. GitHub Actions จะ deploy ให้อัตโนมัติ (ดู `.github/workflows/deploy.yml`)

---

## รันในเครื่องแบบ local

ES modules ต้องเสิร์ฟผ่าน HTTP — เปิดไฟล์ตรง ๆ จาก `file://` จะไม่ทำงาน

```bash
node server.mjs        # เปิดที่ http://localhost:5173 — ไม่ต้อง npm install
# หรือ
npm start              # เหมือนกัน
```

---

## การเล่น

1. กด **▶ เริ่มเล่น** → ปลดล็อกเสียง (autoplay policy)
2. เลือกมาตรา — เริ่มที่ **แม่ ก กา**, ปลดล็อกมาตราถัดไปเมื่อได้ ≥1 ดาว
3. **ลากฟองตัวอักษร** ลงหม้อแม่มด
   - **แม่ ก กา** — ลากตัวไหนก็ได้ ได้คำจริงเสมอ
   - **มาตรามีตัวสะกด** — หม้อโชว์โจทย์ เช่น `ลิ▢` ต้องเลือกตัวสะกดให้ถูก (ผิด = เด้งกลับ)
4. **อ่านออกเสียง** ให้แม่มดฟัง → ถูกได้ดาว · ผิด 2 ครั้ง แม่มดเฉลยสะกดคำให้

ปุ่ม **สำหรับผู้ปกครอง** (ผ่านโจทย์เลข) → เปิด/ปิดทูลทิปสะกดคำ และเสียงดนตรีพื้นหลัง

---

## ฟีเจอร์ที่ทำตามสเปก

| สเปก | สถานะในต้นแบบ |
|------|----------------|
| §0 เลเยอร์ render (`#bgCanvas` static + `#fxCanvas` dynamic) | ✅ ฉากป่าวาดครั้งเดียว, เอฟเฟกต์วาดทุกเฟรม |
| §1 Data model มาตรา (`data/matra.js`) | ✅ 9 มาตรา 2 โหมด (แก้คำได้โดยไม่แตะโค้ด) |
| §2 หน้าเลือกมาตรา (สร้างจาก data + ปลดล็อกตามดาว) | ✅ `ui/levelSelect.js` |
| §3 State machine 2 โหมด + drop + bounce back + distractor | ✅ `game.js` |
| §3.5 Input layer (pointer / interface เดียวกับ MediaPipe) | ✅ `input/pointer.js` + สเก็ตช์ `handpinch.js` |
| §4 ระบบเสียง (SFX / voice pool / ducking / เฉลยสะกด) | ✅ `audio.js` (Web Audio + TTS ภาษาไทย) |
| §5 ฉากป่า + แม่มด (DOM/CSS + reduced-motion) | ✅ `scene.js` + CSS animation |
| §6 คู่มือผู้ใหญ่ + parent gate + ทูลทิปสะกดคำ | ✅ `ui/adultPage.js` |
| PWA (ติดตั้งได้ + offline) | ✅ `manifest.webmanifest` + `sw.js` + icons |
| CI/CD GitHub Pages | ✅ `.github/workflows/deploy.yml` |

---

## ต่างจากสเปกอย่างไร (และทำไม)

สเปกอ้างถึงไฟล์ asset (รูปป่า, sprite แม่มด, ไฟล์เสียง, โมเดล MediaPipe) ที่ยังไม่มี
ต้นแบบนี้จึงทำให้ **รันได้ทันทีโดยไม่ต้องมี asset**:

| ในสเปก | ต้นแบบใช้ | ข้อดี |
|--------|-----------|--------|
| `forest_bg.webp` / `witch_sheet.png` | Canvas procedural + emoji | ไม่ต้องมีไฟล์รูป |
| Howler.js + `sfx.webm`/`.mp3` | Web Audio API สังเคราะห์ | ไม่ต้องมีไฟล์เสียง |
| `vo/*.mp3` (เสียงแม่มด) | SpeechSynthesis TTS `th-TH` | พูดข้อความใหม่ได้เลย |
| MediaPipe Hand Landmarker | `pointer.js` (เมาส์/นิ้ว) | interface เดียวกัน สลับทีหลังได้ |

---

## โครงสร้างไฟล์

```
witch-ar-spelling/
├── index.html
├── manifest.webmanifest         # PWA manifest
├── sw.js                        # Service Worker (offline cache)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── server.mjs                   # static server สำหรับ local dev
├── src/
│   ├── main.js                  # bootstrap
│   ├── game.js                  # loop, state machine, ด่านอ่าน
│   ├── scene.js                 # ฉากป่า (bgCanvas), หม้อ, แม่มด
│   ├── audio.js                 # Web Audio SFX + TTS voice + ducking
│   ├── styles.css
│   ├── data/
│   │   └── matra.js             # ข้อมูลมาตรา + คำ + spell + distractor
│   ├── input/
│   │   ├── pointer.js            # นิ้ว/เมาส์ (ต้นแบบ)
│   │   ├── handpinch.js          # MediaPipe stub (interface เดียวกัน)
│   │   └── speech.js             # Web Speech Recognition th-TH
│   └── ui/
│       ├── levelSelect.js         # หน้าเลือกมาตรา
│       └── adultPage.js           # คู่มือ + parent gate + ทูลทิป
├── tools/
│   └── generate-icons.mjs        # สร้างไอคอน PNG (ไม่ต้อง asset)
└── .github/
    └── workflows/
        └── deploy.yml             # CI/CD → GitHub Pages
```
