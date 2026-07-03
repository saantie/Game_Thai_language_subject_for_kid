// audio.js — ระบบเสียงแบบไม่ต้องมีไฟล์ asset
//   SFX  : สังเคราะห์ด้วย Web Audio API (boom / star / bubble / ...)
//   Voice: ใช้ SpeechSynthesis (TTS ภาษาไทย) เป็นเสียงแม่มด + เฉลยสะกดคำ
//   BGM  : pad เบา ๆ (ปิดได้) + ducking ตอนแม่มดพูด/ตอนฟังไมค์
//
// สเปกเดิมใช้ Howler.js + ไฟล์เสียง — โมดูลนี้คง interface เดียวกัน
// (audio.sfx / audio.voice / audio.playSpellReveal / duck / unduck)
// เพื่อให้สลับไปใช้ไฟล์เสียงจริงภายหลังได้ง่าย

let ctx = null;
let master = null;
let bgmGain = null;
let bgmEl = null;           // HTML Audio element สำหรับ MP3 BGM (game)
let bgmSourceConnected = false;
let bgmTarget = 0.0;        // ค่าเริ่ม: ปิด (เปิดตอน unlock ถ้า settings.bgm=true)
let ducked = false;
let levelBgmActive = false;

// ---- เสียงพากย์แม่มด (สุ่มกันจำเจ) ----
const VOICE = {
  greet: ['สวัสดีจ้ะคนเก่ง มาช่วยแม่มดผสมคำกันเถอะ', 'หม้อวิเศษพร้อมแล้ว มาเล่นกันเลยจ้ะ'],
  start_game: ['มาปราบแม่มดใจร้ายเพื่อช่วยเจ้าหญิงกันเถอะ'],
  read: ['ลองอ่านคำนี้ให้แม่มดฟังหน่อยจ้ะ', 'อ่านออกเสียงดัง ๆ นะจ๊ะ'],
  correct: ['เก่งมากจ้า!', 'เยี่ยมไปเลยคนเก่งค่ะ!', 'ถูกต้องค่ะ เก่งจัง!'],
  retry: ['ลองใหม่นะจ๊ะคนเก่ง', 'เกือบแล้ว ลองอีกทีจ้ะ'],
  reveal: ['ฟังแม่มดสะกดให้นะจ๊ะ', 'คำนี้สะกดแบบนี้จ้ะ'],
  wrong: ['ตัวนี้ยังไม่ใช่จ้ะ ลองตัวอื่นนะ', 'ลองตัวสะกดอื่นดูนะจ๊ะ'],
  cauldron_hint: ['จับฟองสบู่ใสในหม้อเลยจ๊า', 'ลองจับฟองสบู่ใส่ลงหม้อสิจ๊ะ', 'หยิบฟองสบู่แล้วหย่อนลงหม้อนะจ๊ะ'],
  echo_prompt: ['ลองอ่านตามแม่มดอีกครั้งนะจ๊ะ', 'อ่านดัง ๆ ตามแม่มดได้เลยจ๊ะ'],
  echo_praise: ['เก่งมากเลยจ๊ะ ฝึกต่อไปจะอ่านได้คล่องขึ้นเลย', 'ดีมากค่ะ พยายามต่อไปจะเก่งขึ้นแน่นอนนะจ๊ะ', 'เยี่ยมเลยค่ะ ฝึกทุกวันจะอ่านออกเสียงได้ดีมากเลย'],
};

let thaiVoice = null;
function pickThaiVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  // prefer exact th-TH match, then any th-* (e.g. iOS "Kanya" is th-TH)
  thaiVoice =
    voices.find((v) => v.lang && v.lang.toLowerCase() === 'th-th') ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('th')) ||
    null;
  return thaiVoice;
}
if ('speechSynthesis' in window) {
  pickThaiVoice();
  window.speechSynthesis.onvoiceschanged = pickThaiVoice;
}

export const audio = {
  ready: false,

  // ต้องเรียกจาก user gesture แรก (ปุ่ม "เริ่มเล่น")
  unlock() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      bgmGain = ctx.createGain();
      bgmGain.gain.value = bgmTarget;
      bgmGain.connect(master);
      if (ctx.state === 'suspended') ctx.resume();
    }
    // เชื่อม bgmEl เข้า Web Audio graph (ต้องทำใน user gesture)
    if (ctx && bgmEl && !bgmSourceConnected) {
      try {
        const src = ctx.createMediaElementSource(bgmEl);
        src.connect(bgmGain);
        bgmSourceConnected = true;
      } catch (e) {}
    }
    // เริ่มเล่น BGM ถ้าเปิดไว้ก่อน unlock
    if (bgmTarget > 0 && bgmEl) bgmEl.play().catch(() => {});
    this.ready = true;
  },

  // ขอ mic permission แยกต่างหาก — เรียกหลังเสียงทักทายพูดจบ ไม่ซ้อนทับ TTS
  // return promise ให้ caller รอก่อนขอ permission กล้อง (AR) — prompt ซ้อนกัน
  // บน Android บางรุ่นอันแรกถูก dismiss อัตโนมัติ
  requestMicPermission() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      return navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => stream.getTracks().forEach((t) => t.stop()))
        .catch(() => {});
    }
    return Promise.resolve();
  },

  // ---------- SFX ----------
  sfx(name) {
    if (!ctx) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'pick':
        this._blip(660, 0.08, 'triangle', t);
        break;
      case 'bubble':
        this._blip(880, 0.07, 'sine', t);
        break;
      case 'boom': {
        const sw = new Audio('public/assets/audio/Swoosh.mp3');
        sw.volume = 0.75;
        sw.play().catch(() => this._boom(ctx.currentTime));
        break;
      }
      case 'star':
        this._arp([784, 988, 1319], 0.09, t);
        break;
      case 'chime':
        this._arp([523, 659, 784, 1047], 0.12, t);
        break;
      case 'wrong_soft':
        this._blip(220, 0.18, 'sine', t);
        break;
      case 'ting':
        this._ting(t);
        break;
      default:
        break;
    }
  },

  _gain(t, peak, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    return g;
  },

  _blip(freq, dur, type, t) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = this._gain(t, 0.25, dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  _arp(freqs, step, t) {
    freqs.forEach((f, i) => this._blip(f, 0.16, 'triangle', t + i * step));
  },

  _ting(t) {
    // ฟรุ้งฟริ้ง — ascending sparkle arpeggio สำหรับกดเลือกมาตรา
    const notes = [1047, 1319, 1568, 2093, 2637];
    notes.forEach((f, i) => {
      const dt = t + i * 0.058;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, dt);
      o.frequency.exponentialRampToValueAtTime(f * 1.5, dt + 0.13);
      const g = this._gain(dt, 0.15, 0.17);
      o.connect(g); o.start(dt); o.stop(dt + 0.22);
    });
    // แสงเพิ่มเติม: sine ชั้นสูงเบา ๆ กระพริบท้าย
    [2093, 2637, 3136, 4186].forEach((f, i) => {
      const dt = t + 0.18 + i * 0.048;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this._gain(dt, 0.07, 0.09);
      o.connect(g); o.start(dt); o.stop(dt + 0.13);
    });
  },

  _boom(t) {
    const S = ctx.sampleRate;

    // ── Layer 1: Sub kick — ตีพื้นพลังงานต่ำ (impact ทันที)
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(90, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.18);
    const subG = this._gain(t, 0.75, 0.16);
    sub.connect(subG); sub.start(t); sub.stop(t + 0.22);

    // ── Layer 2: Crack — noise burst กรอบ ๆ (impact แหลม)
    const crackBuf = ctx.createBuffer(1, Math.ceil(S * 0.07), S);
    const cd = crackBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++)
      cd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / cd.length, 1.2);
    const crack = ctx.createBufferSource();
    crack.buffer = crackBuf;
    const crackHp = ctx.createBiquadFilter();
    crackHp.type = 'highpass'; crackHp.frequency.value = 1800;
    const crackG = this._gain(t, 0.55, 0.07);
    crack.connect(crackHp).connect(crackG); crack.start(t);

    // ── Layer 3: Body rumble — noise ยาว LP sweep (ควันระเบิด)
    const rumbleDur = 1.3;
    const rBuf = ctx.createBuffer(1, Math.ceil(S * rumbleDur), S);
    const rd = rBuf.getChannelData(0);
    for (let i = 0; i < rd.length; i++)
      rd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rd.length, 3);
    const rumble = ctx.createBufferSource();
    rumble.buffer = rBuf;
    const rLp = ctx.createBiquadFilter();
    rLp.type = 'lowpass';
    rLp.frequency.setValueAtTime(3500, t);
    rLp.frequency.exponentialRampToValueAtTime(100, t + rumbleDur);
    const rG = this._gain(t, 0.45, rumbleDur);
    rumble.connect(rLp).connect(rG); rumble.start(t);

    // ── Layer 4: Magical mid sweep — sawtooth พร้อม resonant filter
    const mid = ctx.createOscillator();
    mid.type = 'sawtooth';
    mid.frequency.setValueAtTime(520, t);
    mid.frequency.exponentialRampToValueAtTime(95, t + 0.55);
    const midBp = ctx.createBiquadFilter();
    midBp.type = 'bandpass'; midBp.frequency.value = 600; midBp.Q.value = 4;
    const midG = this._gain(t, 0.28, 0.5);
    mid.connect(midBp).connect(midG); mid.start(t); mid.stop(t + 0.6);

    // ── Layer 5: Spell shimmer — ascending arpeggio หลัง impact เล็กน้อย
    const sparkFreqs = [523, 784, 1047, 1319, 1760, 2093];
    sparkFreqs.forEach((f, i) => {
      const dt = t + 0.03 + i * 0.045;
      const sp = ctx.createOscillator();
      sp.type = 'triangle';
      sp.frequency.setValueAtTime(f, dt);
      sp.frequency.exponentialRampToValueAtTime(f * 1.5, dt + 0.25);
      const spG = this._gain(dt, 0.14, 0.22);
      sp.connect(spG); sp.start(dt); sp.stop(dt + 0.3);
    });

    // ── Layer 6: Echo tail — delay node ให้ความรู้สึกห้องกว้าง / เวทมนตร์ก้อง
    const delayBuf = ctx.createBuffer(1, Math.ceil(S * 0.4), S);
    const dd = delayBuf.getChannelData(0);
    for (let i = 0; i < dd.length; i++)
      dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / dd.length, 4);
    const echo = ctx.createBufferSource();
    echo.buffer = delayBuf;
    const echoLp = ctx.createBiquadFilter();
    echoLp.type = 'lowpass'; echoLp.frequency.value = 600;
    const echoG = this._gain(t + 0.18, 0.18, 0.38);
    echo.connect(echoLp).connect(echoG); echo.start(t + 0.18);
  },

  // ---------- BGM (Moonlit Broomhop — ใช้ทั้ง level select และ in-game) ----------
  _ensureBgm() {
    if (!bgmEl) {
      bgmEl = new Audio('public/music/Moonlit Broomhop.mp3');
      bgmEl.loop = true;
      bgmEl.preload = 'auto';
    }
    if (ctx && !bgmSourceConnected) {
      try {
        const src = ctx.createMediaElementSource(bgmEl);
        src.connect(bgmGain);
        bgmSourceConnected = true;
      } catch (e) {}
    }
  },
  startBgm() {
    levelBgmActive = false;
    this._ensureBgm();
    bgmTarget = 0.20;
    if (bgmGain && ctx && !ducked) bgmGain.gain.linearRampToValueAtTime(bgmTarget, ctx.currentTime + 0.6);
    bgmEl.play().catch(() => {});
  },
  startLevelBgm() {
    levelBgmActive = true;
    this._ensureBgm();
    bgmTarget = 0.25;
    if (bgmGain && ctx && !ducked) bgmGain.gain.linearRampToValueAtTime(bgmTarget, ctx.currentTime + 0.6);
    bgmEl.play().catch(() => {});
  },
  stopLevelBgm() {
    levelBgmActive = false;
    bgmTarget = 0;
    if (bgmGain && ctx) bgmGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
  },
  setBgmEnabled(on) {
    bgmTarget = on ? (levelBgmActive ? 0.25 : 0.20) : 0.0;
    if (on) { this._ensureBgm(); bgmEl.play().catch(() => {}); }
    else if (bgmEl) bgmEl.pause();
    if (bgmGain && ctx) bgmGain.gain.linearRampToValueAtTime(bgmTarget, ctx.currentTime + 0.8);
  },
  // เรียกครั้งเดียวตอน init — หยุด/เล่น BGM เมื่อ tab ถูกซ่อน/แสดง
  initVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        bgmEl?.pause();
      } else {
        if (ctx?.state === 'suspended') ctx.resume();
        if (bgmTarget > 0 && bgmEl) bgmEl.play().catch(() => {});
      }
    });
  },
  duck() {
    ducked = true;
    // หรี่เหลือ 15% ตอนแม่มดพูด/ฟังไมค์ → ไม่รบกวน STT
    if (bgmGain && ctx) bgmGain.gain.linearRampToValueAtTime(bgmTarget * 0.15, ctx.currentTime + 0.25);
  },
  unduck() {
    ducked = false;
    if (bgmGain && ctx) bgmGain.gain.linearRampToValueAtTime(bgmTarget, ctx.currentTime + 0.5);
  },

  // ---------- MP3 player (core) ----------
  // เล่นไฟล์ MP3 ด้วย HTMLAudioElement; ถ้าโหลดไม่ได้ → เรียก fallback()
  _playMp3(path, fallback, onEnd) {
    this.duck();
    const el = new Audio(path);
    // settled flag ป้องกัน onerror + play().catch() ยิง fallback/onEnd 2 ครั้ง
    let settled = false;
    const resolve = (isError) => {
      if (settled) return;
      settled = true;
      this.unduck();
      if (isError) { if (fallback) fallback(); else onEnd && onEnd(); }
      else          { onEnd && onEnd(); }
    };
    el.onended = () => resolve(false);
    el.onerror = () => resolve(true);
    el.play().catch(() => resolve(true));
  },

  // ---------- Voice (MP3 ก่อน, fallback TTS) ----------
  // เล่นวลีแม่มด + คืน text ที่พูด (เพื่อโชว์เป็นคำพูด) ผ่าน onText
  voice(key, opts = {}) {
    const pool = VOICE[key] || [''];
    const idx  = (Math.random() * pool.length) | 0;
    const text = pool[idx];
    opts.onText && opts.onText(text);
    const path = `public/assets/audio/voice/${key}_${idx + 1}.mp3`;
    this._playMp3(
      path,
      () => this.speak(text, { onEnd: opts.onEnd }),  // TTS fallback ถ้าไฟล์ยังไม่มี
      opts.onEnd
    );
    return text;
  },

  // พูดข้อความใด ๆ ด้วย TTS ภาษาไทย (fallback / ใช้ตรงกรณีพิเศษ)
  speak(text, opts = {}) {
    const { rate = 0.85, pitch = 1.0, onEnd } = opts;
    if (!('speechSynthesis' in window) || !text) {
      // ไม่มี TTS → หน่วงเวลาประมาณการแล้วเรียก onEnd
      setTimeout(() => onEnd && onEnd(), 600 + text.length * 45);
      return;
    }
    this.duck();
    const u = new SpeechSynthesisUtterance(text);
    if (thaiVoice) u.voice = thaiVoice;
    u.lang = 'th-TH';
    u.rate = rate;
    u.pitch = pitch;
    u.onend = () => {
      this.unduck();
      onEnd && onEnd();
    };
    u.onerror = () => {
      this.unduck();
      onEnd && onEnd();
    };
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {
      setTimeout(() => onEnd && onEnd(), 600);
    }
  },

  // เฉลยสะกดคำ: เล่นทีละพยางค์ตาม word.spell
  // มี MP3 → เล่นทีละไฟล์ | ไม่มี MP3 → พูด TTS ทุกพยางค์ที่เหลือในคราวเดียว (ไม่กระตุก)
  _spellCancelled: false,
  playSpellReveal(word, done) {
    this._spellCancelled = false;
    this.sfx('chime');
    const parts = word.spell.slice();
    let i = 0;
    const next = () => {
      if (this._spellCancelled) return;
      if (i >= parts.length) return done && done();
      const idx    = i++;
      const syll   = parts[idx];
      const isWord = (idx === parts.length - 1);
      const folder = isWord ? 'word' : 'spell';
      const path   = `public/assets/audio/${folder}/${encodeURIComponent(syll)}.mp3`;
      const afterMp3 = () => { if (!this._spellCancelled) setTimeout(next, 160); };
      // TTS fallback: พูดพยางค์ที่เหลือทั้งหมดในครั้งเดียว → ไม่มี startup latency ซ้ำ
      const ttsFallback = () => {
        if (this._spellCancelled) return;
        const remaining = parts.slice(idx).join(' ');
        this.speak(remaining, { rate: 0.72, onEnd: done });
      };
      this._playMp3(path, ttsFallback, afterMp3);
    };
    setTimeout(next, 350);
  },

  stopSpeaking() {
    this._spellCancelled = true;
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    this.unduck();
  },
};
