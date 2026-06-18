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
let bgmNodes = [];
let bgmTarget = 0.0; // ค่าเริ่ม: ปิด BGM (เปิดได้จากหน้าผู้ปกครอง)
let ducked = false;

// ---- เสียงพากย์แม่มด (สุ่มกันจำเจ) ----
const VOICE = {
  greet: ['สวัสดีจ้ะคนเก่ง มาช่วยแม่มดผสมคำกันเถอะ', 'หม้อวิเศษพร้อมแล้ว มาเล่นกันเลยจ้ะ'],
  read: ['ลองอ่านคำนี้ให้แม่มดฟังหน่อยจ้ะ', 'อ่านออกเสียงดัง ๆ นะจ๊ะ'],
  correct: ['เก่งมากจ้า!', 'เยี่ยมไปเลยคนเก่งค่ะ!', 'ถูกต้องค่ะ เก่งจัง!'],
  retry: ['ลองใหม่นะจ๊ะคนเก่ง', 'เกือบแล้ว ลองอีกทีจ้ะ'],
  reveal: ['ฟังแม่มดสะกดให้นะจ๊ะ', 'คำนี้สะกดแบบนี้จ้ะ'],
  wrong: ['ตัวนี้ยังไม่ใช่จ้ะ ลองตัวอื่นนะ', 'ลองตัวสะกดอื่นดูนะจ๊ะ'],
};

let thaiVoice = null;
function pickThaiVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  thaiVoice =
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('th')) || null;
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
    // ปลุก speechSynthesis ด้วย utterance ว่าง (บางเบราว์เซอร์ต้องการ)
    if ('speechSynthesis' in window) {
      try {
        const u = new SpeechSynthesisUtterance('');
        window.speechSynthesis.speak(u);
      } catch (e) {}
    }
    this.ready = true;
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
      case 'boom':
        this._boom(t);
        break;
      case 'star':
        this._arp([784, 988, 1319], 0.09, t);
        break;
      case 'chime':
        this._arp([523, 659, 784, 1047], 0.12, t);
        break;
      case 'wrong_soft':
        this._blip(220, 0.18, 'sine', t);
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

  _boom(t) {
    // ระเบิดฟอง: noise burst + sweep ลง
    const dur = 0.5;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const ng = this._gain(t, 0.4, dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + dur);
    noise.connect(lp).connect(ng);
    noise.start(t);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.4);
    const og = this._gain(t, 0.3, 0.4);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.42);
  },

  // ---------- BGM (pad เบา ๆ) ----------
  startBgm() {
    if (!ctx || bgmNodes.length) return;
    const notes = [130.81, 196.0, 261.63]; // C3 G3 C4
    notes.forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.33;
      o.connect(g).connect(bgmGain);
      o.start();
      bgmNodes.push(o);
    });
  },
  setBgmEnabled(on) {
    bgmTarget = on ? 0.06 : 0.0;
    if (on) this.startBgm();
    if (bgmGain && ctx) bgmGain.gain.linearRampToValueAtTime(bgmTarget, ctx.currentTime + 0.4);
  },
  duck() {
    ducked = true;
    if (bgmGain && ctx) bgmGain.gain.linearRampToValueAtTime(bgmTarget * 0.2, ctx.currentTime + 0.2);
  },
  unduck() {
    ducked = false;
    if (bgmGain && ctx) bgmGain.gain.linearRampToValueAtTime(bgmTarget, ctx.currentTime + 0.4);
  },

  // ---------- Voice (TTS) ----------
  // เล่นวลีแม่มด + คืน text ที่พูด (เพื่อโชว์เป็นคำพูด) ผ่าน onText
  voice(key, opts = {}) {
    const pool = VOICE[key] || [''];
    const text = pool[(Math.random() * pool.length) | 0];
    opts.onText && opts.onText(text);
    this.speak(text, opts);
    return text;
  },

  // พูดข้อความใด ๆ ด้วย TTS ภาษาไทย; onEnd เรียกเมื่อพูดจบ
  speak(text, opts = {}) {
    const { rate = 0.92, pitch = 1.25, onEnd } = opts;
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

  // เฉลยสะกดคำ: เล่นทีละพยางค์ตาม word.spell แล้วต่อด้วยคำเต็ม
  playSpellReveal(word, done) {
    this.sfx('chime');
    const parts = word.spell.slice();
    let i = 0;
    const next = () => {
      if (i >= parts.length) return done && done();
      const syll = parts[i++];
      this.speak(syll, { rate: 0.8, pitch: 1.2, onEnd: () => setTimeout(next, 180) });
    };
    setTimeout(next, 350);
  },

  stopSpeaking() {
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    this.unduck();
  },
};
