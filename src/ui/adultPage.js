// ui/adultPage.js — คู่มือผู้ใหญ่ + parent gate + ทูลทิปสะกดคำ (หัวข้อ 6)

import { audio } from '../audio.js';

// parent gate ง่าย ๆ ที่เด็กเล็กทำไม่ได้ (ไม่ใช่ security จริง)
export function openAdultGate(app, screenEl) {
  const a = 3 + ((Math.random() * 6) | 0);
  const b = 2 + ((Math.random() * 6) | 0);
  const ans = window.prompt(`สำหรับผู้ปกครอง: ${a} + ${b} = ?`);
  if (ans !== null && parseInt(ans, 10) === a + b) {
    showAdultPage(app, screenEl);
  } else if (ans !== null) {
    window.alert('คำตอบไม่ถูกต้อง');
  }
}

export function showAdultPage(app, screenEl) {
  screenEl.innerHTML = `
    <div class="adult-card">
      <h2>คู่มือผู้ปกครอง</h2>
      <p>เกมนี้ฝึกการ <b>แจกลูกสะกดคำ</b> ตามมาตราตัวสะกดไทย เด็กลากตัวอักษรลงหม้อแม่มด
         เพื่อประกอบคำ แล้วอ่านออกเสียงให้แม่มดฟังเพื่อรับดาว</p>

      <h3>วิธีเล่น</h3>
      <ul>
        <li><b>แม่ ก กา</b> — ลากพยัญชนะตัวใดก็ได้ลงหม้อ จะได้คำใหม่</li>
        <li><b>มาตรามีตัวสะกด</b> — หม้อจะโชว์โจทย์ เช่น "ลิ▢" ให้เลือกเติมตัวสะกดให้ถูก</li>
        <li>เลือกตัวสะกดผิด ฟองจะเด้งกลับอย่างนุ่มนวล (ไม่ดุ) ให้ลองใหม่</li>
        <li>อ่านออกเสียงถูก = ได้ดาว; ผิด 2 ครั้งแม่มดจะเฉลยการสะกดให้ฟัง</li>
      </ul>

      <h3>ตั้งค่า</h3>
      <label class="setting">
        <input type="checkbox" id="setHint"> แสดงทูลทิปสะกดคำ (เช่น "ลอ – อิ – งอ – ลิง")
      </label>
      <label class="setting">
        <input type="checkbox" id="setBgm"> เปิดเสียงดนตรีพื้นหลัง
      </label>

      <h3>หมายเหตุด้านเสียง</h3>
      <p class="note">ต้นแบบนี้ใช้เสียงสังเคราะห์ของเบราว์เซอร์ (TTS ภาษาไทย) เป็นเสียงแม่มด
         และใช้การรู้จำเสียงพูดของเบราว์เซอร์ในด่านอ่าน หากอุปกรณ์ไม่รองรับ (เช่น iOS Safari)
         จะมีปุ่มให้ผู้ปกครองช่วยกดยืนยันแทน</p>

      <button class="btn-primary" id="adultBack">กลับเข้าเกม</button>
    </div>`;

  const hint = screenEl.querySelector('#setHint');
  const bgm = screenEl.querySelector('#setBgm');
  hint.checked = app.settings.showSpellHint;
  bgm.checked = app.settings.bgm;
  hint.onchange = () => (app.settings.showSpellHint = hint.checked);
  bgm.onchange = () => {
    app.settings.bgm = bgm.checked;
    audio.setBgmEnabled(bgm.checked);
  };
  screenEl.querySelector('#adultBack').onclick = () => {
    screenEl.classList.remove('show');
    screenEl.classList.add('hidden');
  };
  screenEl.classList.remove('hidden');
  screenEl.classList.add('show');
}
