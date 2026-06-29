// main.js — bootstrap: เลือกมาตรา, สลับ input layer, เชื่อมทุกระบบ

import { audio } from './audio.js';
import { initScene } from './scene.js';
import { createPointerInput } from './input/pointer.js';
import { createGame } from './game.js';
import { buildLevelSelect } from './ui/levelSelect.js';
import { openAdultGate } from './ui/adultPage.js';
import { MATRA } from './data/matra.js';
import { loadProgress, saveProgress, clearProgress } from './storage.js';

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
  settings: { showSpellHint: false, bgm: true },
};

const $ = (sel) => document.querySelector(sel);

const startScreen = $('#startScreen');
const levelScreen = $('#levelScreen');
const adultScreen = $('#adultScreen');
const sceneRoot = $('#sceneRoot');
const magicOrbs = $('#magicOrbs');
const resetBtn = $('#resetProgressBtn');

const dom = {
  hud: $('#hud'),
  hudName: $('#hudName'),
  hudProgress: $('#hudProgress'),
  hudScore: $('#hudScore'),
  hudWord: $('#hudWord'),
  voicebar: $('#voicebar'),
  wordBig: $('#wordBig'),
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
};

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

// input layer: pointer (ต้นแบบ) — สลับเป็น handpinch ภายหลังได้โดยไม่แตะ game
createPointerInput(scene.fxCanvas, {
  onPick: game.onPick,
  onMove: game.onMove,
  onRelease: game.onRelease,
});

scene.onResize(() => game.relayout());

// ---- screen switching ----
let _inPopstate  = false;
let _historyInit = false;

function showScreen(which) {
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
  magicOrbs.classList.toggle('hidden', which !== 'level');
  resetBtn.classList.toggle('hidden', which !== 'level');
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
  }
}

// Android back button / iOS swipe back
window.addEventListener('popstate', (e) => {
  const to = e.state?.screen;
  if (!to) return; // entry ก่อนแอปโหลด — ปล่อยให้ browser จัดการ (ออกแอป)
  _inPopstate = true;
  game.stop();
  if (to === 'game') {
    // game state ไม่สามารถ resume — เปลี่ยน entry นี้เป็น level แทน
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
  const startGame = () => {
    showScreen('game');
    if (app.settings.bgm) audio.setBgmEnabled(true);
    game.startMatra(matra);
  };
  const launch = matra.video
    ? () => showIntroSpeech(startGame)   // วิดีโอจบ → หน้าม่วงพูด → เกม
    : startGame;                          // ไม่มีวิดีโอ → เกมทันที
  if (matra.video) {
    audio.stopLevelBgm();
    playIntroVideo(matra.video, launch);
  } else {
    launch();
  }
}

// ---- wiring buttons ----
// Android detection — ซ่อน fallback buttons, mic อยู่ตรงกลาง
if (/Android/i.test(navigator.userAgent)) {
  document.body.classList.add('is-android');
}

// register once ก่อน gesture แรก — ไม่ต้องการ user gesture สำหรับ visibilitychange
audio.initVisibility();

$('#startBtn').addEventListener('click', () => {
  audio.unlock();
  audio.requestMicPermission();
  showScreen('level');
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
    buildLevelSelect($('#levelGrid'), app, (id) => startMatraById(id));
  }
});

// เริ่มที่หน้า start
showScreen('start');
