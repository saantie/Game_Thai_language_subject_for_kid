// main.js — bootstrap: เลือกมาตรา, สลับ input layer, เชื่อมทุกระบบ

import { audio } from './audio.js';
import { initScene } from './scene.js';
import { createPointerInput } from './input/pointer.js';
import { createHandPinchInput } from './input/handpinch.js';
import { createGame } from './game.js';
import { createMahjongWarmup } from './mahjong.js';
import { buildLevelSelect } from './ui/levelSelect.js';
import { openAdultGate } from './ui/adultPage.js';
import { watchAuthState, isAdminEmail } from './firebaseAuth.js';
import { MATRA } from './data/matra.js';
import {
  loadProgress, saveProgress, clearProgress,
  loadArEnabled, saveArEnabled,
  loadTotalScore, saveTotalScore,
  loadMahjongSeen, saveMahjongSeen,
  loadConfirmButtonsOverride, saveConfirmButtonsOverride,
  loadArFlickHintShown, saveArFlickHintShown,
} from './storage.js';

const MATRA_BY_ID = Object.fromEntries(MATRA.map((m) => [m.id, m]));

// แสดง version จาก sw.js จริง (ไม่ hardcode)
fetch('sw.js?_=' + Date.now())
  .then((r) => r.text())
  .then((txt) => {
    const m = txt.match(/CACHE\s*=\s*['"]witch-cauldron-(v\d+)['"]/);
    if (m) document.querySelector('.app-version').textContent = m[1];
  })
  .catch(() => {});

// ---- app state กลาง (ต้นแบบเก็บใน memory; production ใช้ IndexedDB/Firebase) ----
const app = {
  progress: loadProgress(), // โหลดจาก localStorage — { matraId: stars }
  settings: { showSpellHint: false, bgm: true, arEnabled: loadArEnabled(), confirmButtonsOverride: loadConfirmButtonsOverride() },
  totalScore: loadTotalScore(), // คะแนนสะสมข้ามทุกมาตรา — game.js อัปเดตสดระหว่างเล่น
  mahjongSeen: loadMahjongSeen(), // { matraId: true } — ด่านอุ่นเครื่องไพ่โชว์แค่ครั้งแรก
  isAdmin: false, // ล็อกอินด้วยอีเมล Admin แล้ว → เล่นได้ทุกมาตราไม่ล็อก (ข้อ 1, ดู firebaseAuth.js)
  currentUser: null, // ผู้เล่นที่ล็อกอินอยู่ (ถ้ามี) — { email, uid } เสริมระบบเดิม ไม่บังคับล็อกอิน
};

// ฟังสถานะล็อกอิน Firebase (ถ้าตั้งค่าไว้แล้ว) — อัปเดต isAdmin + รีเฟรชหน้าเลือก
// มาตราถ้ากำลังเปิดอยู่ตอนสถานะเปลี่ยน (ข้อ 1) ไม่บล็อกอะไรถ้ายังไม่ได้ตั้งค่า Firebase
// จริง (ensureInit ข้างใน firebaseAuth.js จะ fail เงียบๆ แค่ callback(null))
watchAuthState((user) => {
  app.currentUser = user;
  app.isAdmin = isAdminEmail(user?.email);
  if (_screen === 'level') buildLevelSelect($('#levelGrid'), app, (id) => startMatraById(id));
});

// ผู้เล่นเก่าที่มีดาวอยู่แล้วก่อนฟีเจอร์นี้มา ไม่ควรต้องมาเจอด่านอุ่นเครื่องผุดขึ้น
// ทีหลังทุกมาตราที่เคยผ่าน — เช็คทุกครั้งที่บูต (เบา แค่ไล่ key ที่มีอยู่) ไม่ใช่
// migration one-shot กันข้อมูลไม่ตรงกันเองถ้า localStorage ถูกแก้มือ
(function ensureMahjongSeenInvariant() {
  let dirty = false;
  Object.keys(app.progress).forEach((id) => {
    if ((app.progress[id] | 0) >= 1 && !app.mahjongSeen[id]) {
      app.mahjongSeen[id] = true;
      dirty = true;
    }
  });
  if (dirty) saveMahjongSeen(app.mahjongSeen);
}());

const $ = (sel) => document.querySelector(sel);

const startScreen = $('#startScreen');
const levelScreen = $('#levelScreen');
const adultScreen = $('#adultScreen');
const mahjongScreen = $('#mahjongScreen');
// ย้ายออกมานอก #mahjongScreen แล้ว (ข้อ 5) — .screen มี backdrop-filter ที่ทำให้
// position:fixed ของลูกผูกกับกล่อง .screen แทน viewport จริงตอนกระดานสูงต้อง
// scroll ต้อง toggle .hidden เองแทนการอาศัย parent (#mahjongScreen) ซ่อนให้
const mjWitchImg = $('.mj-witch-img');
const sceneRoot = $('#sceneRoot');
const magicOrbs = $('#magicOrbs');
const resetBtn = $('#resetProgressBtn');

const dom = {
  hud: $('#hud'),
  mahjongTitle: $('#mahjongTitle'),
  mahjongBoard: $('#mahjongBoard'),
  mahjongTray: $('#mahjongTray'),
  mahjongShuffleBtn: $('#mahjongShuffleBtn'),
  mahjongBigWord: $('#mahjongBigWord'),
  mahjongHandCursor: $('#mahjongHandCursor'),
  mahjongPointsPopup: $('#mahjongPointsPopup'),
  hudName: $('#hudName'),
  hudProgress: $('#hudProgress'),
  hudScore: $('#hudScore'),
  hudWord: $('#hudWord'),
  voicebar: $('#voicebar'),
  wordBig: $('#wordBig'),
  vbPoints: $('#vbPoints'),
  micBtn: $('#micBtn'),
  micState: $('#micState'),
  okBtn: $('#okBtn'),
  retryBtn: $('#retryBtn'),
  hint: $('#hint'),
  toast: $('#toast'),
  scoreIcon: $('#scoreIcon'),
  resultScreen: $('#resultScreen'),
  resultStars: $('#resultStars'),
  resultMsg: $('#resultMsg'),
  resultBtn: $('#resultBtn'),
  resultCharImg: $('#resultCharImg'),
  resultCard: $('#resultCard'),
  resultTotalValue: $('#resultTotalValue'),
  totalBadge: $('#totalScoreBadge'),
  totalBadgeValue: $('#totalScoreValue'),
};

dom.totalBadgeValue.textContent = app.totalScore; // ค่าเริ่มต้นก่อนเข้าเกมรอบแรก

const scene = initScene(sceneRoot);

const game = createGame({
  scene,
  audio,
  app,
  dom,
  onExit: () => {
    saveProgress(app.progress); // บันทึกดาวลง localStorage
    showScreen('level');
  },
});

const mahjongWarmup = createMahjongWarmup({
  scene,
  audio,
  app,
  dom,
  onComplete: (matraId) => {
    app.mahjongSeen[matraId] = true;
    saveMahjongSeen(app.mahjongSeen);
    mahjongWarmup.stop();
    enterBubbleGame(MATRA_BY_ID[matraId]);
  },
});

// input layer: hybrid — pointer (touch/เมาส์) ทำงานเสมอ, AR (handpinch) ซ้อนทับ
// เมื่อเปิดกล้องสำเร็จ — เด็กจิ้มจอก็เล่นได้ จีบนิ้วหน้ากล้องก็เล่นได้
// route ตาม _screen ตอนเรียกจริง (ไม่ต้อง rewiring ตอนสลับหน้า) — onHandFrame
// ตอนอยู่หน้า mahjong ต้องเข้า mahjongWarmup.onHandFrame เท่านั้น (ใช้แสดงภาพ
// มือชี้ AR แทนกล้องจริง) ห้าม forward เข้า game เด็ดขาด เพราะ game.js's loop
// หยุดอยู่ (ยังไม่ startMatra) particle จาก spawnDragTrail จะค้างไม่ถูกวาด/ล้าง
// จนกว่าเกมหยิบฟองจะเริ่มจริงแล้วจู่ๆ ก็ระเบิดค้างเก่าออกมา
// alt = ตำแหน่งปลายนิ้วโป้ง (จาก handpinch.js เท่านั้น, pointer.js ไม่ส่งมา) — เกมไพ่
// ใช้นิ้วโป้งแทนนิ้วชี้ตอนลาก/วางไพ่ (ข้อ 2) ส่วนเกมหยิบฟองยังใช้นิ้วชี้เหมือนเดิมทุก
// จุด ไม่กระทบพฤติกรรมเดิมที่ปรับจูนมาแล้ว
const inputHandlers = {
  onPick:      (x, y, slop, alt) => (_screen === 'mahjong' ? mahjongWarmup.onPick(alt ? alt.x : x, alt ? alt.y : y, slop) : game.onPick(x, y, slop)),
  onMove:      (x, y, alt) => (_screen === 'mahjong' ? mahjongWarmup.onMove(alt ? alt.x : x, alt ? alt.y : y) : game.onMove(x, y)),
  onRelease:   (x, y, alt) => (_screen === 'mahjong' ? mahjongWarmup.onRelease(alt ? alt.x : x, alt ? alt.y : y) : game.onRelease(x, y)),
  onHandFrame: (frame) => (_screen === 'mahjong' ? mahjongWarmup.onHandFrame(frame) : game.onHandFrame(frame)),
};
createPointerInput(scene.fxCanvas, inputHandlers);
// มินิเกมไพ่วาดเป็น DOM แยกจาก fxCanvas (ไม่ใช่ canvas) — ต้องมี listener ของ
// ตัวเองบน #mahjongScreen ด้วย ไม่งั้นคลิก/แตะไพ่จะไม่มีทางไปถึง fxCanvas เลย
// (ปลอดภัย ไม่ชนกับหน้าอื่น เพราะ .hidden = display:none จึงไม่รับ event ตอนไม่ active)
createPointerInput(mahjongScreen, inputHandlers);

let arInput = null;
let _arStarting = false;
let _screen = 'start';
const camVideoEl = $('#camVideo');

// game.js เรียกตอนเข้า/ออก LISTENING — หยุด inference คืน CPU ให้ Speech Recognition
// รวม 'mahjong' ด้วย เพราะ pinch เป็น input หลักของด่านอุ่นเครื่องไพ่เช่นกัน
app.arPause = () => { if (arInput) arInput.pause(); };
app.arResume = () => { if (arInput && (_screen === 'game' || _screen === 'mahjong')) arInput.resume(); };

function onCameraLost() {
  // Android ตัดกล้อง (จอดับ/สลับแอป/สายเข้า) → ปิด AR เรียบร้อย เกมเล่นต่อด้วย touch
  if (arInput) { arInput.destroy(); arInput = null; }
  camVideoEl.classList.remove('show');
  witchSay('กล้องปิดไปแล้วจ้ะ ใช้นิ้วจิ้มจอแทนได้เลยนะ');
  updateWakeLock();
}

// AR ทำงานเฉพาะหน้าเกม/มินิเกมไพ่ — หน้าเมนู pause inference + ซ่อนภาพกล้อง (ประหยัดแบต/CPU)
function syncArToScreen() {
  if (!arInput) { camVideoEl.classList.remove('show'); updateWakeLock(); return; }
  if (_screen === 'game' || _screen === 'mahjong') {
    // เกมไพ่ใช้ท่าดีดนิ้วชี้แทนจีบสองนิ้ว (ข้อ 2) — เกมหยิบฟองยังใช้จีบเหมือนเดิม
    arInput.setMode(_screen === 'mahjong' ? 'flick' : 'pinch');
    arInput.resume();
    camVideoEl.classList.add('show');
    if (_screen === 'mahjong') maybeShowArFlickHint();
  } else {
    arInput.pause();
    camVideoEl.classList.remove('show');
  }
  updateWakeLock();
}

// เปิด AR ในเกมไพ่ครั้งแรก (ข้อ 2) — สอนท่าดีดนิ้วชี้ พูดครั้งเดียวตลอดการเล่น
// (persist ผ่าน localStorage ไม่ใช่แค่ session) เรียกจาก syncArToScreen ทุกครั้งที่
// เข้าเกมไพ่ตอน AR ทำงานอยู่ แต่ยิงเสียงจริงแค่ครั้งแรกเท่านั้น
let _arFlickHintShown = loadArFlickHintShown();
function maybeShowArFlickHint() {
  if (_arFlickHintShown) return;
  _arFlickHintShown = true;
  saveArFlickHintShown();
  audio.voice('mahjong_flick_hint', { onText: witchSay });
}

// ---- Wake Lock: กันจอพัก/ดับตอนเล่น AR ในมินิเกมไพ่ (ข้อ 5) — มือจีบลอยอยู่กลาง
// อากาศไม่แตะจอเลย ต่างจากการแตะจอปกติที่กันจอดับเองอยู่แล้ว จอดับกลางคันจะตัด
// กล้อง/inference ทำให้ AR หลุดกะทันหันระหว่างเล่น จึงกันเฉพาะตอนอยู่หน้ามินิเกมไพ่
// และ AR กำลังทำงานจริงเท่านั้น (ไม่ใช่ทุกหน้า กันจอไม่ดับตลอดโดยไม่จำเป็น)
let wakeLock = null;
async function updateWakeLock() {
  const shouldHold = _screen === 'mahjong' && !!arInput;
  if (shouldHold && !wakeLock) {
    if (!('wakeLock' in navigator)) return; // เบราว์เซอร์ไม่รองรับ — ข้ามเงียบๆ
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; } // ถูกปฏิเสธ/ชั่วคราวใช้ไม่ได้ — ไม่กระทบการเล่น
  } else if (!shouldHold && wakeLock) {
    const wl = wakeLock;
    wakeLock = null;
    try { await wl.release(); } catch (e) {}
  }
}
// Wake Lock หลุดอัตโนมัติเมื่อสลับแท็บ/พับจอ (ตามสเปก) — ต้องขอใหม่เองตอนกลับมา
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') updateWakeLock();
});

function initAR() {
  if (!app.settings.arEnabled) return; // ปิดจากปุ่มหน้าแรก
  if (arInput || _arStarting) return;
  _arStarting = true;
  createHandPinchInput(scene.fxCanvas, inputHandlers, onCameraLost)
    .then((input) => {
      _arStarting = false;
      arInput = input; // null = ไม่มีกล้อง/ปฏิเสธ/offline → touch อย่างเดียว ไม่ crash
      syncArToScreen();
    })
    .catch(() => { _arStarting = false; });
}

scene.onResize(() => game.relayout());
scene.onResize(() => mahjongWarmup.relayout());

// ---- screen switching ----
let _inPopstate  = false;
let _historyInit = false;

function showScreen(which) {
  _screen = which;
  syncArToScreen();
  // History API — ทำให้ปุ่ม Back บนมือถือย้อนกลับระหว่างหน้าของแอปแทนที่จะออก
  if (!_inPopstate) {
    if (!_historyInit) {
      history.replaceState({ screen: which }, ''); // แทนที่ entry เดิมของ browser
      _historyInit = true;
    } else {
      history.pushState({ screen: which }, '');
    }
  }
  startScreen.classList.toggle('hidden', which !== 'start');
  levelScreen.classList.toggle('hidden', which !== 'level');
  mahjongScreen.classList.toggle('hidden', which !== 'mahjong');
  mjWitchImg.classList.toggle('hidden', which !== 'mahjong'); // ข้อ 5 — ย้ายออกจาก #mahjongScreen แล้ว ต้อง toggle เอง
  magicOrbs.classList.toggle('hidden', which !== 'level');
  resetBtn.classList.toggle('hidden', which !== 'level');
  dom.totalBadge.classList.toggle('hidden', which === 'start'); // โชว์ทุกหน้ายกเว้นหน้าเริ่ม
  adultScreen.classList.add('hidden'); // ปิด adult overlay เสมอ
  dom.hud.classList.toggle('hidden', which !== 'game');
  arQuickToggleBtn.classList.toggle('hidden', which !== 'game' && which !== 'mahjong'); // ข้อ 3
  dom.voicebar.classList.add('hidden');
  dom.resultScreen.classList.add('hidden');
  // ข้อ 9-10: ไม่ซ้อนภาพกล้อง/ฉากป่าหลังมินิเกมไพ่ — เหลือแค่ fxCanvas (particle)
  // กับพื้นม่วงของ .screen เอง (CSS #sceneRoot.mahjong-mode ซ่อนลูกอื่นทั้งหมด)
  sceneRoot.classList.toggle('mahjong-mode', which === 'mahjong');
  // สลับ BGM ตามหน้า — startLevelBgm() เรียกจาก call site เพื่อควบคุมจังหวะ
  if (which === 'level') {
    audio.stopLevelBgm();   // level select เงียบ — BGM เริ่มเมื่อเกมเริ่ม
    buildLevelSelect($('#levelGrid'), app, (id) => startMatraById(id));
  } else if (which === 'game') {
    audio.stopLevelBgm();
  } else if (which === 'start') {
    audio.stopLevelBgm();
  } else if (which === 'mahjong') {
    // เพลงเดียวกับทั้งแอปแต่ลดเสียงลง 50% — เสียงอ่านสะกดคำ/เสียงแตกต้องได้ยินชัด
    if (app.settings.bgm) audio.startMahjongBgm(); else audio.stopLevelBgm();
  }
}

// Android back button / iOS swipe back
window.addEventListener('popstate', (e) => {
  const to = e.state?.screen;
  if (!to) return; // entry ก่อนแอปโหลด — ปล่อยให้ browser จัดการ (ออกแอป)
  _inPopstate = true;
  game.stop();
  mahjongWarmup.stop(); // no-op เฉยๆ ถ้าไม่ใช่โมดูลที่กำลัง active
  if (to === 'game' || to === 'mahjong') {
    // game/mahjong state ไม่สามารถ resume — เปลี่ยน entry นี้เป็น level แทน
    history.replaceState({ screen: 'level' }, '');
    showScreen('level');
  } else {
    showScreen(to);
  }
  _inPopstate = false;
});

const videoOverlay  = $('#videoOverlay');
const introVideo    = $('#introVideo');
const videoFade     = $('#videoFade');
const skipVideoBtn  = $('#skipVideoBtn');
const introOverlay  = $('#introOverlay');

function showIntroSpeech(onDone) {
  introOverlay.classList.remove('hidden');
  audio.voice('start_game', {
    onEnd: () => {
      introOverlay.classList.add('hidden');
      onDone();
    },
  });
}

// วิดีโอนำเรื่องหน้าแรก + หน้าม่วงแม่มดน้อยชวนมาปราบแม่มดใจร้าย — เล่นครั้งเดียว
// หลังกดปุ่ม "เริ่มเล่น" ก่อนเข้าหน้าเลือกมาตรา (ย้ายมาจากเดิมที่ผูกกับมาตรา kaka)
const INTRO_VIDEO_SRC = 'public/video/Movie%201.mp4';

const FADE_MS = 650; // ความเร็ว fade to black

function playIntroVideo(src, onDone) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    // fade ภาพ + เสียงพร้อมกัน
    videoFade.style.opacity = '1';
    const startVol = introVideo.volume || 1;
    const STEPS = 20;
    const stepMs = FADE_MS / STEPS;
    let step = 0;
    const fadeAudio = setInterval(() => {
      step++;
      introVideo.volume = Math.max(0, startVol * (1 - step / STEPS));
      if (step >= STEPS) clearInterval(fadeAudio);
    }, stepMs);
    setTimeout(() => {
      clearInterval(fadeAudio);
      introVideo.pause();
      introVideo.volume = 1;           // reset ไว้ใช้ครั้งต่อไป
      introVideo.removeAttribute('src');
      introVideo.load();
      videoFade.style.opacity = '0';
      videoOverlay.classList.add('hidden');
      videoOverlay.setAttribute('aria-hidden', 'true');
      onDone();
    }, FADE_MS);
  };

  introVideo.src = src;
  introVideo.muted = false;
  introVideo.volume = 0.6; // ลดเสียงวิดีโอนำเรื่องเหลือ 60%
  introVideo.onerror = finish;   // format/network error → ข้าม
  introVideo.onended = finish;
  skipVideoBtn.onclick = finish;
  videoOverlay.classList.remove('hidden');
  videoOverlay.setAttribute('aria-hidden', 'false');

  // รอโหลดพอเล่น แล้วค่อย play (ป้องกัน play before data)
  const tryPlay = () =>
    introVideo.play().catch(() => {
      // autoplay blocked with sound → ลอง muted
      introVideo.muted = true;
      return introVideo.play().catch(finish); // ยังเล่นไม่ได้ → ข้าม
    });

  if (introVideo.readyState >= 3) {   // HAVE_FUTURE_DATA — โหลดพอแล้ว
    tryPlay();
  } else {
    introVideo.addEventListener('canplay', function h() {
      introVideo.removeEventListener('canplay', h);
      tryPlay();
    });
    // timeout 10 วิ กัน network ช้า / offline
    setTimeout(() => { if (!done) finish(); }, 10000);
  }
}

function startMatraById(id) {
  const matra = MATRA_BY_ID[id];
  // decode เสียงสะกด/คำเต็มของมาตรานี้ล่วงหน้าเข้า BufferCache ระหว่างที่หน้าเลือก
  // มาตรากำลังสลับไปหน้าเกม (มีเวลาว่างอยู่แล้ว) — กันสะดุดตอนเฉลยสะกดคำระหว่างเล่นจริง
  audio.preloadMatra(matra);
  if (!app.mahjongSeen[id]) {
    // ครั้งแรกที่ปลดล็อกมาตรานี้ — ด่านอุ่นเครื่องไพ่ก่อน แล้วค่อยเข้าเกมหยิบฟอง
    showScreen('mahjong');
    mahjongWarmup.startMatra(matra, MATRA.indexOf(matra), MATRA.length);
  } else {
    enterBubbleGame(matra);
  }
}

function enterBubbleGame(matra) {
  showScreen('game');
  if (app.settings.bgm) audio.setBgmEnabled(true);
  game.startMatra(matra);
}

// ---- wiring buttons ----
// Android detection — ซ่อน fallback buttons, mic อยู่ตรงกลาง
if (/Android/i.test(navigator.userAgent)) {
  document.body.classList.add('is-android');
}
// PC (ไม่ใช่มือถือ/แท็บเล็ต) — ซ่อนปุ่ม "อ่านถูก/ลองใหม่" โดย default เหมือน Android
// เพราะ Web Speech API บน Chrome/Edge desktop ทำงานได้แม่นยำพออยู่แล้ว ผู้ปกครองเปิด
// กลับมาแสดงได้ที่หน้าผู้ปกครอง (ข้อ 1) — iOS ไม่เข้าเงื่อนไขนี้ เพราะ iOS Safari ไม่มี
// Web Speech API เลย ต้องใช้ปุ่มเสมอ (ดู .force-confirm ใน styles.css)
if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
  document.body.classList.add('is-desktop');
}
// จำค่าที่ผู้ปกครองเคยตั้งไว้ข้ามเซสชัน — ไม่ต้องเปิดใหม่ทุกครั้งที่เข้าแอป (ข้อ 4)
document.body.classList.toggle('force-confirm', app.settings.confirmButtonsOverride);

// register once ก่อน gesture แรก — ไม่ต้องการ user gesture สำหรับ visibilitychange
audio.initVisibility();

let _micDone = false;
$('#startBtn').addEventListener('click', () => {
  audio.unlock();
  // ไมค์ก่อน → กล้องหลัง ใน gesture เดียวกัน (ยิงพร้อมกัน prompt ซ้อน
  // บน Android บางรุ่นอันแรกถูก dismiss) — AR โหลด background ระหว่างดูวิดีโอนำ/เลือกมาตรา
  audio.requestMicPermission().then(() => {
    _micDone = true;
    initAR(); // ไม่ทำอะไรถ้าปุ่ม AR ปิดอยู่
  });
  audio.stopLevelBgm();
  // วิดีโอนำ → หน้าม่วงแม่มดน้อยชวนปราบแม่มดใจร้าย → หน้าเลือกมาตรา
  playIntroVideo(INTRO_VIDEO_SRC, () => showIntroSpeech(() => showScreen('level')));
});

// ---- ปุ่มเปิด/ปิดโหมด AR — ไอคอนกล้องมุมขวาล่างระหว่างเล่นเท่านั้น (เอาปุ่มข้อความ
// บนหน้าแรกออกแล้ว ข้อ 3 ของรอบนี้ — AR ยังเปิดอัตโนมัติตาม arEnabled ที่จำไว้
// เหมือนเดิม แค่ไม่มีปุ่มเปิด/ปิดตอนอยู่หน้าแรกอีกต่อไป) ----
const arQuickToggleBtn = $('#arQuickToggleBtn');
function updateArToggleLabel() {
  arQuickToggleBtn.classList.toggle('ar-off', !app.settings.arEnabled);
}
updateArToggleLabel();
function toggleArEnabled() {
  app.settings.arEnabled = !app.settings.arEnabled;
  saveArEnabled(app.settings.arEnabled);
  updateArToggleLabel();
  if (!app.settings.arEnabled) {
    // ปิด: หยุดกล้อง/inference ทันที — เกมเล่นต่อด้วย touch
    if (arInput) { arInput.destroy(); arInput = null; }
    camVideoEl.classList.remove('show');
    updateWakeLock();
  } else if (_micDone) {
    initAR(); // เปิดกลับหลังเคยผ่านหน้า start แล้ว — ขอกล้องได้เลย (ไมค์จบไปแล้ว)
  }
  // ยังไม่กด "เริ่มเล่น" → แค่จำ flag ไว้ initAR จะทำงานหลัง start ตามลำดับ permission
}
arQuickToggleBtn.addEventListener('click', toggleArEnabled);

$('#startAdultBtn').addEventListener('click', () => openAdultGate(app, adultScreen));
$('#levelAdultBtn').addEventListener('click', () => openAdultGate(app, adultScreen));

// ---- PWA Install button ----
(function setupInstall() {
  const installBtn = $('#installBtn');
  if (!installBtn) return;

  // standalone = แอปถูกติดตั้งแล้ว → ซ่อนปุ่ม
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  // แสดงปุ่มทันที (กรณี iOS ไม่มี beforeinstallprompt หรือ Chrome ยิงก่อน)
  installBtn.classList.remove('hidden');

  let _deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredPrompt = e;
    installBtn.classList.remove('hidden');
  });

  installBtn.addEventListener('click', () => {
    if (_deferredPrompt) {
      _deferredPrompt.prompt();
      _deferredPrompt.userChoice.then(() => { _deferredPrompt = null; });
    } else {
      // iOS หรือ browser ที่ไม่รองรับ beforeinstallprompt
      alert(
        'วิธีติดตั้งแอป:\n' +
        '• iPhone/iPad: กดปุ่ม Share ↑ แล้วเลือก "เพิ่มไปที่หน้าจอโฮม"\n' +
        '• Android (Chrome): กดเมนู ⋮ แล้วเลือก "เพิ่มในหน้าจอหลัก"'
      );
    }
  });

  window.addEventListener('appinstalled', () => {
    installBtn.classList.add('hidden');
  });
}());

$('#backBtn').addEventListener('click', () => {
  game.stop();
  showScreen('level');
});

$('#mahjongBackBtn').addEventListener('click', () => {
  mahjongWarmup.stop();
  showScreen('level');
});

$('#levelBackBtn').addEventListener('click', () => showScreen('start'));

$('#mahjongShuffleBtn').addEventListener('click', () => mahjongWarmup.shuffle());

function witchSay(text) {
  dom.toast.textContent = text;
  dom.toast.classList.add('show');
  clearTimeout(witchSay._t);
  witchSay._t = setTimeout(() => dom.toast.classList.remove('show'), 3500);
}

resetBtn.addEventListener('click', () => {
  if (window.confirm('ล้างคะแนนและมาตราที่เล่นไปทั้งหมด?')) {
    clearProgress();
    app.progress = {};
    app.totalScore = 0;
    saveTotalScore(0);
    app.mahjongSeen = {};
    saveMahjongSeen({});
    dom.totalBadgeValue.textContent = 0;
    buildLevelSelect($('#levelGrid'), app, (id) => startMatraById(id));
  }
});

// เริ่มที่หน้า start
showScreen('start');
