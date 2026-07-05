// input/speech.js — Web Speech Recognition (th-TH) สำหรับด่านอ่านออกเสียง
// iOS Safari ไม่มี API นี้ → supported=false, เกมจะ fallback เป็นปุ่มให้ผู้ปกครองช่วยฟัง
// (ตามข้อ 9.2 ในสเปก)
//
// ข้อจำกัดที่แก้จาก JS ไม่ได้: Web Speech API ไม่เปิด mic gain/sensitivity ให้ควบคุม
// เลย (ไม่รับ MediaStream ของเราเอง จัดการ audio pipeline เองทั้งหมด) ถ้าเด็กอ่านเบา
// มากจนตัวรู้จำเสียงพูด (VAD) ในเบราว์เซอร์ไม่ได้ยินอะไรเลย จะแก้จากโค้ดฝั่งนี้ไม่ได้
//
// [แก้ 2026-07-05] บั๊กจริงที่พบ: โหมด non-continuous (ค่า default) เบราว์เซอร์ตัด
// จบ session เร็วมากถ้าเงียบสั้นๆ — โค้ดเดิมแก้ด้วยการ "restart" สร้าง SpeechRecognition
// ใหม่ทุกครั้งที่จบ (ดู game.js listen() เดิม) ซึ่งแต่ละ session เป็นคนละ audio stream
// กัน ตัดเสียงพูดต่อเนื่องของเด็กให้กลายเป็นท่อนๆ ทำให้ถอดเสียงได้ไม่ครบคำ (ปัญหาที่
// รายงาน "อ่านถูกแต่เกมตัดสินผิด" ส่วนหนึ่งมาจากตรงนี้) แก้ด้วย `continuous:true`
// ให้ session เดียวฟังต่อเนื่องได้เองโดยไม่ต้องแทรกแซง restart กลางคัน — คุมเวลาสูงสุด
// ด้วย maxMs (setTimeout เรียก stop() เอง) แทน ไม่ใช่ tear down แล้วสร้างใหม่
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function createRecognizer() {
  const supported = !!SR;

  return {
    supported,
    listening: false,
    _recog: null,

    // start(onResult, onEnd, opts): onResult(transcript) เมื่อได้ยินคำ
    // opts.maxMs: เวลาฟังต่อเนื่องสูงสุดก่อน stop() เอง (default 8000ms)
    start(onResult, onEnd, opts = {}) {
      const maxMs = opts.maxMs ?? 8000;
      if (!supported) {
        onEnd && onEnd();
        return;
      }
      const recog = new SR();
      this._recog = recog;
      recog.lang = 'th-TH';
      // ★ continuous:true — ฟังต่อเนื่อง session เดียวจนกว่าจะ stop() เอง ไม่ตัดจบ
      // ทันทีที่เงียบสั้นๆ เหมือน non-continuous (ค่า default) — กันปัญหา "restart
      // กลางคันตัดเสียงพูดเป็นท่อนๆ" ตามที่อธิบายด้านบน
      recog.continuous = true;
      recog.interimResults = true;
      recog.maxAlternatives = 8; // เพิ่มจาก 5 — ตัวเลือกมากขึ้น โอกาสตรงเป้ามากขึ้น
      this.listening = true;

      let lastAlts = null;
      let done = false; // กัน finishResult/finishEnd ยิงซ้ำ (สอง path นี้แยกกันแต่ exclusive)
      const cleanup = () => {
        this.listening = false;
        clearTimeout(timeoutId);
      };
      // ได้ผล final แล้ว — เรียก onResult ทันที (ไม่รอ onend ตามหลัง) แล้วค่อย stop()
      // เก็บกวาด engine ทีหลัง กัน latency เพิ่มโดยไม่จำเป็น
      const finishResult = (alts) => {
        if (done) return;
        done = true;
        cleanup();
        try { recog.stop(); } catch (e) {}
        onResult && onResult(alts);
      };
      // จบโดยไม่มี final (error/no-speech/เราเรียก stop() เองจาก maxMs timeout)
      const finishEnd = () => {
        if (done) return;
        done = true;
        cleanup();
        // ไม่เคย finalize แต่มี interim ค้างไว้ — ใช้แทนดีกว่าฟันธงว่า "ไม่ได้ยิน"
        // ทั้งที่จริงมีเสียงเข้ามาบ้าง (เสียงเบา/พูดสั้น)
        if (lastAlts && lastAlts.length) {
          onResult && onResult(lastAlts);
          return;
        }
        onEnd && onEnd();
      };

      recog.onresult = (e) => {
        const res = e.results[e.results.length - 1];
        const alts = [];
        for (let i = 0; i < res.length; i++) alts.push(res[i].transcript);
        lastAlts = alts;
        if (res.isFinal) finishResult(alts);
      };
      recog.onerror = () => finishEnd();
      recog.onend = () => finishEnd();

      const timeoutId = setTimeout(() => {
        try { recog.stop(); } catch (e) {}
      }, maxMs);

      try {
        recog.start();
      } catch (e) {
        this.listening = false;
        clearTimeout(timeoutId);
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
