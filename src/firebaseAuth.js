// firebaseAuth.js — ระบบสมัคร/เข้าสู่ระบบผู้เล่นด้วย Firebase (ข้อ 1)
// เสริมระบบเดิม ไม่บังคับสมัคร — progress/ดาว/คะแนนสะสมยังเก็บใน localStorage
// เหมือนเดิมทุกอย่าง (ดู storage.js) โมดูลนี้ไม่ยุ่งกับ progress เลย มีหน้าที่แค่:
//   1) สมัคร/เข้าสู่ระบบด้วยอีเมล+รหัส 4 หลัก+ชื่อผู้เล่น (เก็บชื่อไว้เผื่ออนาคต v.pro
//      ยังไม่ได้ใช้ทำอะไรอื่นตอนนี้)
//   2) ถ้าอีเมลที่ล็อกอินอยู่ในรายชื่อ Admin (ฮาร์ดโค้ดด้านล่าง) → ปลดล็อกทุกมาตรา
//      ไม่มีการล็อกเลย ไว้ให้ทดสอบเกมได้ทุกด่านทันที (ดู isUnlocked ใน levelSelect.js)
//
// Firebase config จริงของโปรเจกต์ "games-for-kid" (จาก Firebase Console ⚙ Project
// settings > General > Your apps) — ค่านี้เป็น public identifier ของฝั่ง client
// ตามปกติของ Firebase (ไม่ใช่ secret) ความปลอดภัยจริงคุมด้วย Firebase
// Authentication + Firestore Security Rules ฝั่ง console แทน
const firebaseConfig = {
  apiKey: 'AIzaSyDq739Umvb345lhYPV4jq-IsaUFfQmWumI',
  authDomain: 'games-for-kid.firebaseapp.com',
  projectId: 'games-for-kid',
  storageBucket: 'games-for-kid.firebasestorage.app',
  messagingSenderId: '22538217948',
  appId: '1:22538217948:web:bcc5d10340b45608958719',
};

// อีเมล Admin — ล็อกอินด้วยอีเมลนี้แล้วเล่นได้ทุกมาตราทันทีไม่ต้องผ่านมาตราก่อนหน้า
// (ข้อ 1) เพิ่มอีเมลอื่นได้ตามต้องการ (ฮาร์ดโค้ดตามที่ตกลงไว้ ไม่ใช้ field ใน Firestore)
const ADMIN_EMAILS = ['saantie@gmail.com'];

// แปลง PIN 4 หลักที่ผู้ปกครอง/เด็กพิมพ์ ให้เป็นรหัสผ่านจริงที่ Firebase ยอมรับ
// เบื้องหลังอัตโนมัติ (Firebase Auth บังคับรหัสผ่านขั้นต่ำ 6 ตัวอักษร แต่โจทย์ขอ
// รหัส 4 หลักล้วน) ผู้ใช้ไม่เห็น/ไม่ต้องรู้เรื่องการแปลงนี้เลย พิมพ์แค่ 4 หลักเสมอ
const PIN_SALT = 'witchCauldronKid_';
function pinToPassword(pin) {
  return PIN_SALT + pin;
}

let app = null;
let auth = null;
let db = null;
let _initError = null;
let _sdkPromise = null;

// โหลด Firebase SDK จาก CDN แบบ ES module ตอนต้องใช้จริงเท่านั้น (lazy) — กันโหลด
// สคริปต์จากอินเทอร์เน็ตทุกครั้งที่เปิดแอปทั้งที่ผู้เล่นส่วนใหญ่ไม่ใช้ฟีเจอร์นี้เลย
async function ensureInit() {
  if (app || _initError) return;
  if (!_sdkPromise) {
    _sdkPromise = Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js'),
    ]);
  }
  try {
    const [appMod, authMod, fsMod] = await _sdkPromise;
    app = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(app);
    // auto-detect long-polling: ลองต่อแบบปกติ (เร็วกว่า) ก่อนเสมอ ถ้าเครือข่าย
    // (พร็อกซี/ไฟร์วอลล์บางที่) บล็อกการเชื่อมต่อสดจริงๆ ค่อย fallback เป็น
    // long-polling เอง — ไม่กระทบผู้เล่นส่วนใหญ่ที่เน็ตปกติ (ต่างจาก
    // experimentalForceLongPolling ที่บังคับ long-polling ทุกคน ช้ากว่าโดยไม่จำเป็น)
    db = fsMod.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
    _authMod = authMod;
    _fsMod = fsMod;
  } catch (e) {
    _initError = e;
  }
}
let _authMod = null;
let _fsMod = null;

export async function isFirebaseReady() {
  await ensureInit();
  return !!auth && !_initError;
}

export function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(String(email).toLowerCase());
}

// สมัครสมาชิกใหม่ — email อะไรก็ได้ (Firebase ตรวจรูปแบบเองแค่ว่าเป็นอีเมลถูก
// รูปแบบไหม ไม่ต้องยืนยันจริงก็สมัครได้) + PIN 4 หลัก + ชื่อผู้เล่น
export async function registerPlayer(email, pin, playerName) {
  await ensureInit();
  if (!auth) throw new Error('ระบบลงทะเบียนยังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งค่า Firebase)');
  const cred = await _authMod.createUserWithEmailAndPassword(auth, email, pinToPassword(pin));
  // บันทึกชื่อผู้เล่นลง Firestore แบบ "ไม่บล็อก" (ไม่ await) — สมัครสมาชิกสำเร็จ
  // แล้วตั้งแต่บรรทัด Auth ด้านบน (Admin bypass ก็เช็คแค่อีเมลจาก Auth เท่านั้น
  // ไม่ต้องพึ่ง Firestore เลย) ถ้า Firestore ยังไม่ได้เปิดใช้ในโปรเจกต์/เน็ตช้า/
  // ล้มเหลว ไม่ควรทำให้ทั้งฟังก์ชันนี้ค้างหรือดูเหมือนสมัครไม่สำเร็จทั้งที่ Auth
  // สร้างบัญชีจริงไปแล้ว (เจอจริงตอนทดสอบ — setDoc ค้างได้นานมากถ้า Firestore
  // ยังไม่ถูกสร้าง/เปิดใช้ในโปรเจกต์ Firebase Console)
  _fsMod.setDoc(_fsMod.doc(db, 'users', cred.user.uid), {
    email,
    playerName: playerName || '',
    createdAt: Date.now(),
  }).catch((e) => console.warn('บันทึกชื่อผู้เล่นลง Firestore ไม่สำเร็จ (ไม่กระทบการสมัครสมาชิก):', e));
  return cred.user;
}

export async function loginPlayer(email, pin) {
  await ensureInit();
  if (!auth) throw new Error('ระบบลงทะเบียนยังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งค่า Firebase)');
  const cred = await _authMod.signInWithEmailAndPassword(auth, email, pinToPassword(pin));
  return cred.user;
}

export async function logoutPlayer() {
  await ensureInit();
  if (!auth) return;
  await _authMod.signOut(auth);
}

// สมัครสมาชิกใหม่แต่แจ้งเตือนถ้าเรียกซ้ำก่อน SDK พร้อม — คืนฟังก์ชันยกเลิกการฟัง
// (unsubscribe) — callback(user|null) เรียกทันทีตอนเริ่มฟังด้วยสถานะปัจจุบัน
export function watchAuthState(callback) {
  ensureInit().then(() => {
    if (!auth) { callback(null); return; }
    _authMod.onAuthStateChanged(auth, callback);
  });
  return () => {}; // เผื่ออนาคตอยากยกเลิกฟัง (ยังไม่จำเป็นตอนนี้)
}

export async function getPlayerProfile(uid) {
  await ensureInit();
  if (!db) return null;
  const snap = await _fsMod.getDoc(_fsMod.doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}
