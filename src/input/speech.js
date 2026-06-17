// input/speech.js — Web Speech Recognition (th-TH) สำหรับด่านอ่านออกเสียง
// iOS Safari ไม่มี API นี้ → supported=false, เกมจะ fallback เป็นปุ่มให้ผู้ปกครองช่วยฟัง
// (ตามข้อ 9.2 ในสเปก)

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function createRecognizer() {
  const supported = !!SR;

  return {
    supported,
    listening: false,
    _recog: null,

    // start(onResult, onEnd): onResult(transcript) เมื่อได้ยินคำ
    start(onResult, onEnd) {
      if (!supported) {
        onEnd && onEnd();
        return;
      }
      const recog = new SR();
      this._recog = recog;
      recog.lang = 'th-TH';
      recog.interimResults = false;
      recog.maxAlternatives = 3;
      this.listening = true;

      recog.onresult = (e) => {
        const alts = [];
        for (let i = 0; i < e.results[0].length; i++) {
          alts.push(e.results[0][i].transcript);
        }
        onResult && onResult(alts);
      };
      recog.onerror = () => {};
      recog.onend = () => {
        this.listening = false;
        onEnd && onEnd();
      };
      try {
        recog.start();
      } catch (e) {
        this.listening = false;
        onEnd && onEnd();
      }
    },

    stop() {
      if (this._recog && this.listening) {
        try {
          this._recog.stop();
        } catch (e) {}
      }
    },
  };
}

// เทียบคำที่ได้ยินกับเป้าหมาย — ตัดวรรณยุกต์/ช่องว่าง แล้วเช็คว่ามีคำเป้าหมายอยู่
export function matchWord(alternatives, target) {
  const clean = (s) =>
    (s || '')
      .replace(/[่-๋์]/g, '') // วรรณยุกต์ + ทัณฑฆาต
      .replace(/\s+/g, '')
      .trim();
  const t = clean(target);
  return alternatives.some((a) => {
    const c = clean(a);
    return c === t || c.includes(t) || t.includes(c);
  });
}
