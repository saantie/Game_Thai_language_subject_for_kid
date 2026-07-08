// ui/adultPage.js — คู่มือผู้ใหญ่ + parent gate + ทูลทิปสะกดคำ (หัวข้อ 6)

import { audio } from '../audio.js';
import { saveConfirmButtonsOverride } from '../storage.js';
import { registerPlayer, loginPlayer, logoutPlayer, isAdminEmail } from '../firebaseAuth.js';

const FEEDBACK_EMAIL = 'saantie@gmail.com';

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
         เพื่อประกอบคำ แล้วอ่านออกเสียงให้แม่มดฟังเพื่อรับดาว ระหว่างเล่นตัวละครข้างหม้อ
         (เจ้าหญิง/แม่มดใจร้าย) จะค่อยๆ เปลี่ยนร่างทุกครั้งที่ตอบถูก</p>

      <h3>วิธีเล่น</h3>
      <ul>
        <li><b>แม่ ก กา</b> — ลากพยัญชนะตัวใดก็ได้ลงหม้อ จะได้คำใหม่เสมอ</li>
        <li><b>มาตรามีตัวสะกด</b> (กง กน กม กก กด กบ เกย เกอว) — หม้อจะโชว์โจทย์
            เช่น "ลิ▢" ให้เลือกตัวสะกดที่ถูกต้องมาเติม</li>
        <li>เลือกตัวสะกดผิด ฟองจะเด้งกลับอย่างนุ่มนวล (ไม่ดุ) ให้ลองใหม่ได้เรื่อยๆ</li>
        <li>อ่านออกเสียงถูก = ได้ดาว; ผิด 2 ครั้งแม่มดจะเฉลยการสะกดทีละพยางค์ให้ฟัง</li>
        <li>ถ้าไมค์ตัดก่อนเด็กพูดจบ แม่มดจะบอก "เอาใหม่ค่ะ" แล้วเปิดไมค์ให้เองอัตโนมัติ</li>
        <li>เล่นจบมาตราได้ดาวสูงสุด 3 ดวง/มาตรา + คะแนนสะสมข้ามทุกมาตรา (ป้ายมุมขวาบน)</li>
        <li>ปุ่ม "📷 โหมด AR" ที่หน้าแรก — เปิดกล้องให้จีบนิ้ว (หัวแม่มือ+ชี้) หยิบตัวอักษร
            แทนนิ้วแตะจอ ปิดได้ถ้าไม่สะดวกใช้กล้อง</li>
      </ul>

      <h3>ตั้งค่า</h3>
      <label class="setting">
        <input type="checkbox" id="setHint"> แสดงทูลทิปสะกดคำ (เช่น "ลอ – อิ – งอ – ลิง")
      </label>
      <label class="setting">
        <input type="checkbox" id="setBgm"> เปิดเสียงดนตรีพื้นหลัง
      </label>
      <label class="setting">
        <input type="checkbox" id="setConfirmBtn"> แสดงปุ่ม "อ่านถูก/ลองใหม่" บน Android/คอมพิวเตอร์ด้วย
        <p class="note">ปกติ Android และคอมพิวเตอร์ (PC) ใช้ไมค์ฟังเสียงอย่างเดียว (แม่นยำพอ)
           เปิดข้อนี้ถ้าอยากให้ผู้ใหญ่ช่วยกดยืนยันคำตอบแทนได้ — บน iOS มีปุ่มนี้ให้อยู่แล้วเสมอ
           เพราะ iOS Safari ยังไม่รองรับการฟังเสียงพูดของเบราว์เซอร์</p>
      </label>

      <h3>หมายเหตุด้านเสียง</h3>
      <p class="note">เสียงแม่มดพูดเป็นไฟล์เสียงพากย์จริงเป็นหลัก ถ้าไฟล์ยังโหลดไม่ทัน (เช่นเน็ตช้า)
         จะสลับไปใช้เสียงสังเคราะห์ของเบราว์เซอร์ (TTS ภาษาไทย) แทนชั่วคราว ด่านอ่านออกเสียงใช้
         การรู้จำเสียงพูดของเบราว์เซอร์ (Web Speech API) ซึ่ง iOS Safari ยังไม่รองรับ จึงต้องใช้
         ปุ่มยืนยันคำตอบแทนเสมอในอุปกรณ์นั้น</p>

      <h3>บัญชีผู้เล่น</h3>
      <p class="note">ไม่บังคับสมัคร — เกมเล่นได้ปกติโดยไม่ต้องล็อกอิน (คะแนน/ดาวยังเก็บในเครื่อง
         เหมือนเดิม) สมัครไว้เผื่อฟีเจอร์เพิ่มเติมในอนาคต</p>
      <div id="authStatus" class="auth-status"></div>
      <div id="authForm" class="auth-form">
        <input type="email" id="authEmail" class="auth-input" placeholder="อีเมล" autocomplete="email" />
        <input type="text" id="authPlayerName" class="auth-input" placeholder="ชื่อผู้เล่น (สำหรับสมัครสมาชิกใหม่)" />
        <input type="password" id="authPin" class="auth-input" placeholder="รหัส 4 หลัก" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" />
        <div class="auth-buttons">
          <button class="btn-primary" id="authRegisterBtn" type="button">สมัครสมาชิก</button>
          <button class="btn-primary" id="authLoginBtn" type="button">เข้าสู่ระบบ</button>
        </div>
        <p id="authMsg" class="note"></p>
      </div>

      <h3>แจ้งปัญหา / แนะนำการพัฒนาเกม</h3>
      <p class="note">พิมพ์รายละเอียดแล้วกดปุ่ม จะเปิดโปรแกรมอีเมลของคุณพร้อมข้อความนี้ ส่งถึง
         ${FEEDBACK_EMAIL}</p>
      <textarea id="feedbackText" class="feedback-textarea" rows="4"
        placeholder="พบปัญหาอะไร หรืออยากแนะนำอะไรเพิ่มเติม เขียนที่นี่ได้เลยจ้ะ"></textarea>
      <button class="btn-primary" id="feedbackSendBtn" type="button">ส่งอีเมลแจ้งปัญหา</button>

      <button class="btn-primary" id="adultBack">กลับเข้าเกม</button>
    </div>`;

  const hint = screenEl.querySelector('#setHint');
  const bgm = screenEl.querySelector('#setBgm');
  const confirmBtn = screenEl.querySelector('#setConfirmBtn');
  hint.checked = app.settings.showSpellHint;
  bgm.checked = app.settings.bgm;
  confirmBtn.checked = app.settings.confirmButtonsOverride;
  hint.onchange = () => (app.settings.showSpellHint = hint.checked);
  bgm.onchange = () => {
    app.settings.bgm = bgm.checked;
    audio.setBgmEnabled(bgm.checked);
  };
  confirmBtn.onchange = () => {
    app.settings.confirmButtonsOverride = confirmBtn.checked;
    saveConfirmButtonsOverride(confirmBtn.checked); // จำข้ามเซสชัน ไม่ต้องตั้งใหม่ทุกครั้ง (ข้อ 4)
    document.body.classList.toggle('force-confirm', confirmBtn.checked);
  };

  // ---------- บัญชีผู้เล่น (ข้อ 1) ----------
  const authStatus = screenEl.querySelector('#authStatus');
  const authForm = screenEl.querySelector('#authForm');
  const authEmail = screenEl.querySelector('#authEmail');
  const authPlayerName = screenEl.querySelector('#authPlayerName');
  const authPin = screenEl.querySelector('#authPin');
  const authMsg = screenEl.querySelector('#authMsg');

  function renderAuthStatus() {
    if (app.currentUser) {
      const adminBadge = app.isAdmin ? ' <span class="admin-badge">Admin</span>' : '';
      authStatus.innerHTML = `เข้าสู่ระบบแล้ว: ${app.currentUser.email}${adminBadge}
        <button class="btn-link" id="authLogoutBtn" type="button">ออกจากระบบ</button>`;
      authForm.classList.add('hidden');
      screenEl.querySelector('#authLogoutBtn').onclick = async () => {
        await logoutPlayer();
        app.currentUser = null;
        app.isAdmin = false;
        authMsg.textContent = '';
        renderAuthStatus();
      };
    } else {
      authStatus.textContent = '';
      authForm.classList.remove('hidden');
    }
  }
  renderAuthStatus();

  screenEl.querySelector('#authRegisterBtn').onclick = async () => {
    const email = authEmail.value.trim();
    const pin = authPin.value.trim();
    const playerName = authPlayerName.value.trim();
    if (!email || !/^\d{4}$/.test(pin)) {
      authMsg.textContent = 'กรอกอีเมลและรหัส 4 หลัก (ตัวเลขล้วน) ให้ครบก่อนนะ';
      return;
    }
    authMsg.textContent = 'กำลังสมัครสมาชิก...';
    try {
      const user = await registerPlayer(email, pin, playerName);
      app.currentUser = user;
      app.isAdmin = isAdminEmail(user.email);
      authMsg.textContent = 'สมัครสมาชิกสำเร็จ!';
      renderAuthStatus();
    } catch (e) {
      authMsg.textContent = 'สมัครไม่สำเร็จ: ' + (e.message || e);
    }
  };
  screenEl.querySelector('#authLoginBtn').onclick = async () => {
    const email = authEmail.value.trim();
    const pin = authPin.value.trim();
    if (!email || !/^\d{4}$/.test(pin)) {
      authMsg.textContent = 'กรอกอีเมลและรหัส 4 หลัก (ตัวเลขล้วน) ให้ครบก่อนนะ';
      return;
    }
    authMsg.textContent = 'กำลังเข้าสู่ระบบ...';
    try {
      const user = await loginPlayer(email, pin);
      app.currentUser = user;
      app.isAdmin = isAdminEmail(user.email);
      authMsg.textContent = 'เข้าสู่ระบบสำเร็จ!';
      renderAuthStatus();
    } catch (e) {
      authMsg.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + (e.message || e);
    }
  };

  // ---------- แจ้งปัญหา/ข้อเสนอแนะ (ข้อ 2) ----------
  screenEl.querySelector('#feedbackSendBtn').onclick = () => {
    const text = screenEl.querySelector('#feedbackText').value.trim();
    const subject = encodeURIComponent('แจ้งปัญหา/ข้อเสนอแนะ - หม้อแม่มดผสมคำ');
    const body = encodeURIComponent(text || '(ไม่ได้พิมพ์ข้อความ)');
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
  };

  screenEl.querySelector('#adultBack').onclick = () => {
    screenEl.classList.remove('show');
    screenEl.classList.add('hidden');
  };
  screenEl.classList.remove('hidden');
  screenEl.classList.add('show');
}
