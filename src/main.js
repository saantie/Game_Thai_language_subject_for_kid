// main.js — bootstrap: เลือกมาตรา, สลับ input layer, เชื่อมทุกระบบ

import { audio } from './audio.js';
import { initScene } from './scene.js';
import { createPointerInput } from './input/pointer.js';
import { createHandPinchInput } from './input/handpinch.js';
import { createGame } from './game.js';
import { createMahjongWarmup } from './mahjong.js';
import { buildLevelSelect } from './ui/levelSelect.js';
import { openAdultGate } from './ui/adultPage.js';
import { MATRA } from './data/matra.js';
import {
  loadProgress, saveProgress, clearProgress,
  loadArEnabled, saveArEnabled,
  loadTotalScore, saveTotalScore,
  loadMahjongSeen, saveMahjongSeen,
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
  settings: { showSpellHint: false, bgm: true, arEnabled: loadArEnabled(), androidConfirmButtons: false },
  totalScore: loadTotalScore(), // คะแนนสะสมข้ามทุกมาตรา — game.js อัปเดตสดระหว่างเล่น
  mahjongSeen: loadMahjongSeen(), // { matraId: true } — ด่านอุ่นเครื่องไพ่โชว์แค่ครั้งแรก
};

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
const sceneRoot = $('#sceneRoot');
const magicOrbs = $('#magicOrbs');
const resetBtn = $('#resetProgressBtn');

const dom = {
  hud: $('#hud'),
  mahjongTitle: $('#mahjongTitle'),
  mahjongBoard: $('#mahjongBoard'),
  mahjongTray: $('#mahjongTray'),
  mahjongShuffleBtn: $('#mahjongShuffleBtn'),
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
// ห้าม forward เข้า game ตอนอยู่หน้า mahjong เพราะ game.js's loop หยุดอยู่
// (ยังไม่ startMatra) particle จาก spawnDragTrail จะค้างไม่ถูกวาด/ล้างจนกว่า
// เกมหยิบฟองจะเริ่มจริงแล้วจู่ๆ ก็ระเบิดค้างเก่าออกมา
const inputHandlers = {
  onPick:      (x, y, slop) => (_screen === 'mahjong' ? mahjongWarmup.onPick(x, y, slop) : game.onPick(x, y, slop)),
  onMove:      (x, y) => (_screen === 'mahjong' ? mahjongWarmup.onMove(x, y) : game.onMove(x, y)),
  onRelease:   (x, y) => (_screen === 'mahjong' ? mahjongWarmup.onRelease(x, y) : game.onRelease(x, y)),
  onHandFrame: (frame) => { if (_screen !== 'mahjong') game.onHandFrame(frame); },
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
}

// AR ทำงานเฉพาะหน้าเกม/มินิเกมไพ่ — หน้าเมนู pause inference + ซ่อนภาพกล้อง (ประหยัดแบต/CPU)
function syncArToScreen() {
  if (!arInput) { camVideoEl.classList.remove('show'); return; }
  if (_screen === 'game' || _screen === 'mahjong') {
    arInput.resume();
    camVideoEl.classList.add('show');
  } else {
    arInput.pause();
    camVideoEl.classList.remove('show');
  }
}

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
  magicOrbs.classList.toggle('hidden', which !== 'level');
  resetBtn.classList.toggle('hidden', which !== 'level');
  dom.totalBadge.classList.toggle('hidden', which === 'start'); // โชว์ทุกหน้ายกเว้นหน้าเริ่ม
  adultScreen.classList.add('hidden'); // ปิด adult overlay เสมอ
  dom.hud.classList.toggle('hidden', which !== 'game');
  dom.voicebar.classList.add('hidden');
  dom.resultScreen.classList.add('hidden');
  // สลับ BGM ตามหน้า — startLevelBgm() เรียกจาก call site เพื่อควบคุมจังหวะ
  if (which === 'level') {
    audio.stopLevelBgm();   // level select เงียบ — BGM เริ่มเมื่อเกมเริ่ม
    buildLevelSelect($('#levelGrid'), app, (id) => startMatraById(id));
  } else if (which === 'game') {
    audio.stopLevelBgm();
  } else if (which === 'start') {
    audio.stopLevelBgm();
  } else if (which === 'mahjong') {
    audio.stopLevelBgm(); // ด่านอุ่นเครื่องไพ่ยังไม่มีเพลงประกอบเฉพาะ — เงียบเหมือนหน้าเลือกมาตรา
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

// ---- ปุ่มเปิด/ปิดโหมด AR (หน้าแรก) ----
const arToggleBtn = $('#arToggleBtn');
function updateArToggleLabel() {
  arToggleBtn.textContent = app.settings.arEnabled ? '📷 โหมด AR: เปิด' : '📷 โหมด AR: ปิด';
  arToggleBtn.style.opacity = app.settings.arEnabled ? '' : '0.6';
}
updateArToggleLabel();
arToggleBtn.addEventListener('click', () => {
  app.settings.arEnabled = !app.settings.arEnabled;
  saveArEnabled(app.settings.arEnabled);
  updateArToggleLabel();
  if (!app.settings.arEnabled) {
    // ปิด: หยุดกล้อง/inference ทันที — เกมเล่นต่อด้วย touch
    if (arInput) { arInput.destroy(); arInput = null; }
    camVideoEl.classList.remove('show');
  } else if (_micDone) {
    initAR(); // เปิดกลับหลังเคยผ่านหน้า start แล้ว — ขอกล้องได้เลย (ไมค์จบไปแล้ว)
  }
  // ยังไม่กด "เริ่มเล่น" → แค่จำ flag ไว้ initAR จะทำงานหลัง start ตามลำดับ permission
});

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
