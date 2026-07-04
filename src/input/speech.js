// input/speech.js — Web Speech Recognition (th-TH) สำหรับด่านอ่านออกเสียง
// iOS Safari ไม่มี API นี้ → supported=false, เกมจะ fallback เป็นปุ่มให้ผู้ปกครองช่วยฟัง
// (ตามข้อ 9.2 ในสเปก)
//
// ข้อจำกัดที่แก้จาก JS ไม่ได้: Web Speech API ไม่เปิด mic gain/sensitivity ให้ควบคุม
// เลย (ไม่รับ MediaStream ของเราเอง จัดการ audio pipeline เองทั้งหมด) ถ้าเด็กอ่านเบา
// มากจนตัวรู้จำเสียงพูด (VAD) ในเบราว์เซอร์ไม่ได้ยินอะไรเลย จะแก้จากโค้ดฝั่งนี้ไม่ได้
// — สิ่งที่พอทำได้คือ (1) ใช้ interim results แทนรอ final เท่านั้น ช่วยจับกรณีเสียงเบา
// ที่ recognizer ยังไม่กล้า finalize ให้ (มักจบด้วย no-speech error เฉยๆ) และ (2) ผ่อน
// การเทียบคำ (matchWord) ให้ทนต่อ STT ถอดเสียงคลาดเคลื่อนเล็กน้อยทั้งที่ออกเสียงถูกจริง

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
      // ★ เปิด interim results — ไม่ใช่แค่รอผล final เท่านั้น เสียงเบาบางทีเบราว์เซอร์
      // ไม่กล้า finalize ให้ (ตัดจบด้วย no-speech error ทั้งที่มีเสียงเข้ามาบ้าง) เก็บ
      // ผลล่าสุดที่เห็นไว้เผื่อใช้ตอน finish() ถ้าไม่มี final มาจริงๆ
      recog.interimResults = true;
      recog.maxAlternatives = 8; // เพิ่มจาก 5 — ตัวเลือกมากขึ้น โอกาสตรงเป้ามากขึ้น
      this.listening = true;

      let lastAlts = null;
      recog.onresult = (e) => {
        const res = e.results[e.results.length - 1];
        const alts = [];
        for (let i = 0; i < res.length; i++) alts.push(res[i].transcript);
        lastAlts = alts;
        if (res.isFinal) onResult && onResult(alts);
      };
      // guard: onEnd ต้อง fire แค่ครั้งเดียว ไม่ว่า onerror หรือ onend จะยิงก่อน
      let fired = false;
      const finish = () => {
        if (fired) return;
        fired = true;
        this.listening = false;
        // ไม่เคย finalize (เช่น no-speech ตัดก่อน) แต่มี interim ค้างไว้ — ใช้แทนดีกว่า
        // ฟันธงว่า "ไม่ได้ยิน" ทั้งที่จริงมีเสียงเข้ามาบ้าง (เสียงเบา/พูดสั้น)
        if (lastAlts && lastAlts.length) {
          onResult && onResult(lastAlts);
          return;
        }
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

// ระยะแก้ไข (Levenshtein) — ใช้เป็น fallback ทนต่อ STT ถอดเสียงคลาดเคลื่อนเล็กน้อย
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// เทียบคำที่ได้ยินกับเป้าหมาย — normalize แล้วเช็ค substring ก่อน ถ้าไม่ตรงลอง fuzzy
// (Levenshtein) เผื่อ STT ถอดเสียงคลาดเคลื่อนเล็กน้อย (วรรณยุกต์/สระสั้นยาว/พยัญชนะ
// พ้องเสียง) ทั้งที่เด็กอ่านถูกจริงตามที่เฉลย [ผ่อนเพิ่ม 2026-07-05: ผู้ใช้ทดสอบพบว่า
// เกมตัดสินผิดบ่อยทั้งที่อ่านถูกแล้ว]
export function matchWord(alternatives, target) {
  const normalize = (s) =>
    (s || '')
      .replace(/[็่้๊๋์]/g, '')  // ็ mai tai khu + วรรณยุกต์ 4 + ์ thanthakat
      .replace(/ใ/g, 'ไ')          // ไ/ใ เสียงเดียวกัน
      .replace(/ณ/g, 'น')          // ณ/น เสียงเดียวกัน
      .replace(/ญ/g, 'ย')          // ญ/ย เสียงเดียวกัน
      .replace(/ฬ/g, 'ล')          // ฬ/ล เสียงเดียวกัน
      .replace(/[ศษ]/g, 'ส')       // ศ/ษ/ส เสียงเดียวกัน
      .replace(/[ฒฑธ]/g, 'ท')      // ฒ/ฑ/ธ/ท เสียงเดียวกัน (พยัญชนะวรรค ท)
      .replace(/ฎ/g, 'ด')          // ฎ/ด เสียงเดียวกัน
      .replace(/ัม/g, 'ำ')         // อัม → อำ (STT อาจสะกดต่างกัน)
      .replace(/[\s.,!?๚๛]+/g, '') // ตัดช่องว่าง/เครื่องหมายวรรคตอนที่ STT อาจแทรกมา
      .trim();
  const t = normalize(target);
  if (!t) return false;

  return alternatives.some((a) => {
    const c = normalize(a);
    if (!c) return false;
    if (c === t || c.includes(t) || t.includes(c)) return true;
    // fuzzy fallback: ระยะแก้ไขไม่เกิน ~35% ของความยาวคำ — คำสั้นมาก (1-2 ตัวอักษร)
    // แทบไม่ทนอะไรเลย (ต้องตรงเป๊ะอยู่ดี) กันจับคู่มั่วกับคำสั้นที่ต่างกันชัดเจน
    const dist = levenshtein(c, t);
    const maxLen = Math.max(c.length, t.length);
    return maxLen > 0 && dist / maxLen <= 0.35;
  });
}
