// main.js — bootstrap: เลือกมาตรา, สลับ input layer, เชื่อมทุกระบบ

import { audio } from './audio.js';
import { initScene } from './scene.js';
import { createPointerInput } from './input/pointer.js';
import { createGame } from './game.js';
import { buildLevelSelect } from './ui/levelSelect.js';
import { openAdultGate } from './ui/adultPage.js';
import { MATRA } from './data/matra.js';
import { loadProgress, saveProgress } from './storage.js';

const MATRA_BY_ID = Object.fromEntries(MATRA.map((m) => [m.id, m]));

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
  adultScreen.classList.add('hidden'); // ปิด adult overlay เสมอ
  dom.hud.classList.toggle('hidden', which !== 'game');
  dom.voicebar.classList.add('hidden');
  dom.resultScreen.classList.add('hidden');
  if (which === 'level') {
    buildLevelSelect($('#levelGrid'), app, (id) => startMatraById(id));
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

function startMatraById(id) {
  const matra = MATRA_BY_ID[id];
  showScreen('game');
  game.startMatra(matra);
}

// ---- wiring buttons ----
// register once ก่อน gesture แรก — ไม่ต้องการ user gesture สำหรับ visibilitychange
audio.initVisibility();

$('#startBtn').addEventListener('click', () => {
  audio.unlock();
  if (app.settings.bgm) audio.setBgmEnabled(true);
  audio.voice('greet', { onText: witchSay });
  showScreen('level');
});

$('#startAdultBtn').addEventListener('click', () => openAdultGate(app, adultScreen));
$('#levelAdultBtn').addEventListener('click', () => openAdultGate(app, adultScreen));

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

// เริ่มที่หน้า start
showScreen('start');
