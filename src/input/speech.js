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
      recog.maxAlternatives = 5;
      this.listening = true;

      recog.onresult = (e) => {
        const alts = [];
        for (let i = 0; i < e.results[0].length; i++) {
          alts.push(e.results[0][i].transcript);
        }
        onResult && onResult(alts);
      };
      // guard: onEnd ต้อง fire แค่ครั้งเดียว ไม่ว่า onerror หรือ onend จะยิงก่อน
      let fired = false;
      const finish = () => {
        if (fired) return;
        fired = true;
        this.listening = false;
        onEnd && onEnd();
      };
      recog.onerror = () => finish();
      recog.onend = () => finish();
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

// เทียบคำที่ได้ยินกับเป้าหมาย — normalize แล้วเช็ค substring
export function matchWord(alternatives, target) {
  const normalize = (s) =>
    (s || '')
      .replace(/[็่้๊๋์]/g, '')  // ็ mai tai khu + วรรณยุกต์ 4 + ์ thanthakat
      .replace(/ใ/g, 'ไ')          // ไ/ใ เสียงเดียวกัน
      .replace(/ณ/g, 'น')          // ณ/น เสียงเดียวกัน
      .replace(/ญ/g, 'ย')          // ญ/ย เสียงเดียวกัน
      .replace(/ฬ/g, 'ล')          // ฬ/ล เสียงเดียวกัน
      .replace(/ัม/g, 'ำ')         // อัม → อำ (STT อาจสะกดต่างกัน)
      .replace(/\s+/g, '')
      .trim();
  const t = normalize(target);
  return alternatives.some((a) => {
    const c = normalize(a);
    return c === t || c.includes(t) || t.includes(c);
  });
}
