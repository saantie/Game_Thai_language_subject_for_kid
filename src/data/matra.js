// data/matra.js — ข้อมูลมาตราตัวสะกด + คำ + spell + distractor

export const MATRA = [
  {
    id: 'kaka',
    name: 'แม่ ก กา',
    mode: 'TWO_PART',
    sessionSize: 8, // เล่นทีละ 8 ตัวสุ่ม — เปลี่ยนทุกรอบ
    sara: 'า',
    // เฉพาะพยัญชนะที่ + า แล้วเป็น "คำจริงที่มีความหมาย" และ STT (th-TH) รู้จัก
    // ตัดพยัญชนะที่รวม า แล้วไม่ใช่คำ (เช่น ณา ฒา ฑา ฎา ฉา ฬา ...) ออก —
    // เพราะ Speech Recognition ไม่มีในคลังคำ จะตีว่าผิดเสมอแม้ออกเสียงถูก
    bubbles: ['ก','ข','ค','ง','ช','ต','ท','น','ป','ผ','ฝ','พ','ม','ย','ร','ล','ห','อ'],
    words: [
      { display:'กา', lead:'ก', sara:'า', spell:['กอ','อา','กา'] }, // อีกา
      { display:'ขา', lead:'ข', sara:'า', spell:['ขอ','อา','ขา'] }, // ขา
      { display:'คา', lead:'ค', sara:'า', spell:['คอ','อา','คา'] }, // ติดคา
      { display:'งา', lead:'ง', sara:'า', spell:['งอ','อา','งา'] }, // เมล็ดงา
      { display:'ชา', lead:'ช', sara:'า', spell:['ชอ','อา','ชา'] }, // น้ำชา
      { display:'ตา', lead:'ต', sara:'า', spell:['ตอ','อา','ตา'] }, // ดวงตา
      { display:'ทา', lead:'ท', sara:'า', spell:['ทอ','อา','ทา'] }, // ทาสี
      { display:'นา', lead:'น', sara:'า', spell:['นอ','อา','นา'] }, // ท้องนา
      { display:'ปา', lead:'ป', sara:'า', spell:['ปอ','อา','ปา'] }, // ปาลูกบอล
      { display:'ผา', lead:'ผ', sara:'า', spell:['ผอ','อา','ผา'] }, // หน้าผา
      { display:'ฝา', lead:'ฝ', sara:'า', spell:['ฝอ','อา','ฝา'] }, // ฝาหม้อ
      { display:'พา', lead:'พ', sara:'า', spell:['พอ','อา','พา'] }, // พาไป
      { display:'มา', lead:'ม', sara:'า', spell:['มอ','อา','มา'] }, // มา
      { display:'ยา', lead:'ย', sara:'า', spell:['ยอ','อา','ยา'] }, // ยา
      { display:'รา', lead:'ร', sara:'า', spell:['รอ','อา','รา'] }, // เชื้อรา
      { display:'ลา', lead:'ล', sara:'า', spell:['ลอ','อา','ลา'] }, // ลา (สัตว์)
      { display:'หา', lead:'ห', sara:'า', spell:['หอ','อา','หา'] }, // ค้นหา
      { display:'อา', lead:'อ', sara:'า', spell:['ออ','อา','อา'] }, // อา (ญาติ)
    ],
  },
  // ─── แม่กา — สระอื่น ๆ (ไม่มีตัวสะกด) ───────────────────────────────────────
  {
    id: 'sara_ii',
    name: 'สระ อี',
    mode: 'TWO_PART',
    sessionSize: 7,
    sara: 'ี',
    bubbles: ['ม','ด','ป','ต','ผ','ช','ฝ'],
    words: [
      { display:'มี', lead:'ม', sara:'ี', spell:['มอ','อี','มี'] },   // มีของ
      { display:'ดี', lead:'ด', sara:'ี', spell:['ดอ','อี','ดี'] },   // ดีใจ
      { display:'ปี', lead:'ป', sara:'ี', spell:['ปอ','อี','ปี'] },   // ปีใหม่
      { display:'ตี', lead:'ต', sara:'ี', spell:['ตอ','อี','ตี'] },   // ตีกลอง
      { display:'ผี', lead:'ผ', sara:'ี', spell:['ผอ','อี','ผี'] },   // ผีปอบ
      { display:'ชี', lead:'ช', sara:'ี', spell:['ชอ','อี','ชี'] },   // แม่ชี
      { display:'ฝี', lead:'ฝ', sara:'ี', spell:['ฝอ','อี','ฝี'] },   // ฝีมือ
    ],
  },
  {
    id: 'sara_ue',
    name: 'สระ อือ',
    mode: 'TWO_PART',
    sessionSize: 4,
    sara: 'ือ',
    bubbles: ['ม','ค','ถ','ล'],
    words: [
      { display:'มือ', lead:'ม', sara:'ือ', spell:['มอ','อือ','มือ'] }, // มือ
      { display:'คือ', lead:'ค', sara:'ือ', spell:['คอ','อือ','คือ'] }, // คือ
      { display:'ถือ', lead:'ถ', sara:'ือ', spell:['ถอ','อือ','ถือ'] }, // ถือของ
      { display:'ลือ', lead:'ล', sara:'ือ', spell:['ลอ','อือ','ลือ'] }, // ลือชา
    ],
  },
  {
    id: 'sara_uu',
    name: 'สระ อู',
    mode: 'TWO_PART',
    sessionSize: 6,
    sara: 'ู',
    bubbles: ['ห','ร','ด','ช','ป','ง'],
    words: [
      { display:'หู', lead:'ห', sara:'ู', spell:['หอ','อู','หู'] },   // หูฟัง
      { display:'รู', lead:'ร', sara:'ู', spell:['รอ','อู','รู'] },   // รูปู
      { display:'ดู', lead:'ด', sara:'ู', spell:['ดอ','อู','ดู'] },   // ดูทีวี
      { display:'ชู', lead:'ช', sara:'ู', spell:['ชอ','อู','ชู'] },   // ชูมือ
      { display:'ปู', lead:'ป', sara:'ู', spell:['ปอ','อู','ปู'] },   // ปูทะเล
      { display:'งู', lead:'ง', sara:'ู', spell:['งอ','อู','งู'] },   // งูเหลือม
    ],
  },
  {
    id: 'sara_o',
    name: 'สระ ออ',
    mode: 'TWO_PART',
    sessionSize: 8,
    sara: 'ออ',
    bubbles: ['ก','ข','ค','ต','พ','ย','ร','ห'],
    words: [
      { display:'กอ', lead:'ก', sara:'อ', spell:['กอ','ออ','กอ'] },   // กอหญ้า
      { display:'ขอ', lead:'ข', sara:'อ', spell:['ขอ','ออ','ขอ'] },   // ขอร้อง
      { display:'คอ', lead:'ค', sara:'อ', spell:['คอ','ออ','คอ'] },   // คอยาว
      { display:'ตอ', lead:'ต', sara:'อ', spell:['ตอ','ออ','ตอ'] },   // ตอไม้
      { display:'พอ', lead:'พ', sara:'อ', spell:['พอ','ออ','พอ'] },   // พอดี
      { display:'ยอ', lead:'ย', sara:'อ', spell:['ยอ','ออ','ยอ'] },   // ยอดเขา
      { display:'รอ', lead:'ร', sara:'อ', spell:['รอ','ออ','รอ'] },   // รอก่อน
      { display:'หอ', lead:'ห', sara:'อ', spell:['หอ','ออ','หอ'] },   // หอคอย
    ],
  },
  {
    id: 'sara_am',
    name: 'สระ อำ',
    mode: 'TWO_PART',
    sessionSize: 8,
    sara: 'ำ',
    bubbles: ['ท','จ','ด','ย','น','ล','ค','ข','ต','ร'],
    words: [
      { display:'ทำ', lead:'ท', sara:'ำ', spell:['ทอ','อำ','ทำ'] },   // ทำงาน
      { display:'จำ', lead:'จ', sara:'ำ', spell:['จอ','อำ','จำ'] },   // จำได้
      { display:'ดำ', lead:'ด', sara:'ำ', spell:['ดอ','อำ','ดำ'] },   // สีดำ
      { display:'ยำ', lead:'ย', sara:'ำ', spell:['ยอ','อำ','ยำ'] },   // ส้มตำ
      { display:'นำ', lead:'น', sara:'ำ', spell:['นอ','อำ','นำ'] },   // นำทาง
      { display:'ลำ', lead:'ล', sara:'ำ', spell:['ลอ','อำ','ลำ'] },   // ลำต้น
      { display:'คำ', lead:'ค', sara:'ำ', spell:['คอ','อำ','คำ'] },   // คำพูด
      { display:'ขำ', lead:'ข', sara:'ำ', spell:['ขอ','อำ','ขำ'] },   // ขำขัน
      { display:'ตำ', lead:'ต', sara:'ำ', spell:['ตอ','อำ','ตำ'] },   // ตำน้ำพริก
      { display:'รำ', lead:'ร', sara:'ำ', spell:['รอ','อำ','รำ'] },   // รำไทย
    ],
  },
  {
    id: 'sara_ao',
    name: 'สระ เอา',
    mode: 'TWO_PART',
    sessionSize: 7,
    sara: 'เา',
    bubbles: ['ก','ข','ต','ด','ม','ร','ส','ห'],
    words: [
      { display:'เกา', lead:'ก', sara:'เา', spell:['กอ','เอา','เกา'] },   // เกาหลัง
      { display:'เขา', lead:'ข', sara:'เา', spell:['ขอ','เอา','เขา'] },   // ภูเขา
      { display:'เตา', lead:'ต', sara:'เา', spell:['ตอ','เอา','เตา'] },   // เตาไฟ
      { display:'เดา', lead:'ด', sara:'เา', spell:['ดอ','เอา','เดา'] },   // เดาคำตอบ
      { display:'เมา', lead:'ม', sara:'เา', spell:['มอ','เอา','เมา'] },   // เมารถ
      { display:'เรา', lead:'ร', sara:'เา', spell:['รอ','เอา','เรา'] },   // พวกเรา
      { display:'เสา', lead:'ส', sara:'เา', spell:['สอ','เอา','เสา'] },   // เสาไฟ
      { display:'เหา', lead:'ห', sara:'เา', spell:['หอ','เอา','เหา'] },   // เหา (แมลง)
    ],
  },
  {
    id: 'sara_ia',
    name: 'สระ เอีย',
    mode: 'TWO_PART',
    sessionSize: 4,
    sara: 'เีย',
    bubbles: ['ม','ส','ล','ป'],
    words: [
      { display:'เมีย', lead:'ม', sara:'เีย', spell:['มอ','เอีย','เมีย'] },   // เมีย
      { display:'เสีย', lead:'ส', sara:'เีย', spell:['สอ','เอีย','เสีย'] },   // เสียของ
      { display:'เลีย', lead:'ล', sara:'เีย', spell:['ลอ','เอีย','เลีย'] },   // เลียไอศกรีม
      { display:'เปีย', lead:'ป', sara:'เีย', spell:['ปอ','เอีย','เปีย'] },   // เปียผม
    ],
  },
  {
    id: 'sara_uea',
    name: 'สระ เอือ',
    mode: 'TWO_PART',
    sessionSize: 4,
    sara: 'เือ',
    bubbles: ['ส','ร','ล','จ'],
    words: [
      { display:'เสือ', lead:'ส', sara:'เือ', spell:['สอ','เอือ','เสือ'] },   // เสือโคร่ง
      { display:'เรือ', lead:'ร', sara:'เือ', spell:['รอ','เอือ','เรือ'] },   // เรือแล่น
      { display:'เลือ', lead:'ล', sara:'เือ', spell:['ลอ','เอือ','เลือ'] },   // เลือเกิน
      { display:'เจือ', lead:'จ', sara:'เือ', spell:['จอ','เอือ','เจือ'] },   // เจือจาง
    ],
  },
  {
    id: 'sara_a',
    name: 'สระ อะ',
    mode: 'TWO_PART',
    sessionSize: 7,
    sara: 'ะ',
    bubbles: ['ก','ค','จ','ป','น','ล','ม'],
    words: [
      { display:'กะ', lead:'ก', sara:'ะ', spell:['กอ','อะ','กะ'] },     // กะประมาณ
      { display:'คะ', lead:'ค', sara:'ะ', spell:['คอ','อะ','คะ'] },     // คะ (สุภาพ)
      { display:'จะ', lead:'จ', sara:'ะ', spell:['จอ','อะ','จะ'] },     // จะไป
      { display:'ปะ', lead:'ป', sara:'ะ', spell:['ปอ','อะ','ปะ'] },     // ปะรอยขาด
      { display:'นะ', lead:'น', sara:'ะ', spell:['นอ','อะ','นะ'] },     // นะคะ
      { display:'ละ', lead:'ล', sara:'ะ', spell:['ลอ','อะ','ละ'] },     // ละเล่น
      { display:'มะ', lead:'ม', sara:'ะ', spell:['มอ','อะ','มะ'] },     // มะม่วง
    ],
  },
  {
    id: 'sara_i',
    name: 'สระ อิ',
    mode: 'TWO_PART',
    sessionSize: 4,
    sara: 'ิ',
    bubbles: ['ต','ม','ช','ส'],
    words: [
      { display:'ติ', lead:'ต', sara:'ิ', spell:['ตอ','อิ','ติ'] },     // ติเตียน
      { display:'มิ', lead:'ม', sara:'ิ', spell:['มอ','อิ','มิ'] },     // มิใช่
      { display:'ชิ', lead:'ช', sara:'ิ', spell:['ชอ','อิ','ชิ'] },     // ลองชิ
      { display:'สิ', lead:'ส', sara:'ิ', spell:['สอ','อิ','สิ'] },     // ไปสิ
    ],
  },
  {
    id: 'sara_u',
    name: 'สระ อุ',
    mode: 'TWO_PART',
    sessionSize: 4,
    sara: 'ุ',
    bubbles: ['ด','ต','พ','ม'],
    words: [
      { display:'ดุ', lead:'ด', sara:'ุ', spell:['ดอ','อุ','ดุ'] },     // ดุมาก
      { display:'ตุ', lead:'ต', sara:'ุ', spell:['ตอ','อุ','ตุ'] },     // ตุ (พุงป่อง)
      { display:'พุ', lead:'พ', sara:'ุ', spell:['พอ','อุ','พุ'] },     // พุน้ำ
      { display:'มุ', lead:'ม', sara:'ุ', spell:['มอ','อุ','มุ'] },     // มุ่งมั่น
    ],
  },
  {
    id: 'sara_e_short',
    name: 'สระ เอะ',
    mode: 'TWO_PART',
    sessionSize: 3,
    sara: 'เะ',
    bubbles: ['ก','ต','ป'],
    words: [
      { display:'เกะ', lead:'ก', sara:'เะ', spell:['กอ','เอะ','เกะ'] },   // เกะกะ
      { display:'เตะ', lead:'ต', sara:'เะ', spell:['ตอ','เอะ','เตะ'] },   // เตะบอล
      { display:'เปะ', lead:'ป', sara:'เะ', spell:['ปอ','เอะ','เปะ'] },   // พอเปะ
    ],
  },
  {
    id: 'sara_ae_short',
    name: 'สระ แอะ',
    mode: 'TWO_PART',
    sessionSize: 3,
    sara: 'แะ',
    bubbles: ['ก','ต','ป'],
    words: [
      { display:'แกะ', lead:'ก', sara:'แะ', spell:['กอ','แอะ','แกะ'] },   // ลูกแกะ
      { display:'แตะ', lead:'ต', sara:'แะ', spell:['ตอ','แอะ','แตะ'] },   // แตะต้อง
      { display:'แปะ', lead:'ป', sara:'แะ', spell:['ปอ','แอะ','แปะ'] },   // แปะกระดาษ
    ],
  },
  {
    id: 'sara_o_short',
    name: 'สระ เอาะ',
    mode: 'TWO_PART',
    sessionSize: 4,
    sara: 'เาะ',
    bubbles: ['ก','จ','ป','ต'],
    words: [
      { display:'เกาะ', lead:'ก', sara:'เาะ', spell:['กอ','เอาะ','เกาะ'] },   // เกาะทะเล
      { display:'เจาะ', lead:'จ', sara:'เาะ', spell:['จอ','เอาะ','เจาะ'] },   // เจาะรู
      { display:'เปาะ', lead:'ป', sara:'เาะ', spell:['ปอ','เอาะ','เปาะ'] },   // เปราะบาง
      { display:'เตาะ', lead:'ต', sara:'เาะ', spell:['ตอ','เอาะ','เตาะ'] },   // เดินเตาะแตะ
    ],
  },
  {
    id: 'sara_oo',
    name: 'สระ โอ',
    mode: 'TWO_PART',
    sessionSize: 4,
    sara: 'โ',
    bubbles: ['ต','บ','ห','ด'],
    words: [
      { display:'โต', lead:'ต', sara:'โ', spell:['ตอ','โอ','โต'] },     // โตขึ้น
      { display:'โบ', lead:'บ', sara:'โ', spell:['บอ','โอ','โบ'] },     // โบผม
      { display:'โห', lead:'ห', sara:'โ', spell:['หอ','โอ','โห'] },     // โห! (อุทาน)
      { display:'โด', lead:'ด', sara:'โ', spell:['ดอ','โอ','โด'] },     // โด เร มี (ดนตรี)
    ],
  },
  {
    id: 'sara_ua',
    name: 'สระ อัว',
    mode: 'TWO_PART',
    sessionSize: 4,
    sara: 'ัว',
    bubbles: ['ต','ห','ม','ร'],
    words: [
      { display:'ตัว', lead:'ต', sara:'ัว', spell:['ตอ','อัว','ตัว'] },   // ร่างกาย
      { display:'หัว', lead:'ห', sara:'ัว', spell:['หอ','อัว','หัว'] },   // หัวใจ
      { display:'มัว', lead:'ม', sara:'ัว', spell:['มอ','อัว','มัว'] },   // ท้องฟ้ามัว
      { display:'รัว', lead:'ร', sara:'ัว', spell:['รอ','อัว','รัว'] },   // รัวกลอง
    ],
  },
  {
    id: 'sara_ae',
    name: 'สระ แอ',
    mode: 'TWO_PART',
    sessionSize: 5,
    sara: 'แ',
    bubbles: ['ก','ต','น','ล','ม'],
    words: [
      { display:'แก', lead:'ก', sara:'แ', spell:['กอ','แอ','แก'] },     // ยาแก้
      { display:'แต', lead:'ต', sara:'แ', spell:['ตอ','แอ','แต'] },     // แต่ว่า
      { display:'แน', lead:'น', sara:'แ', spell:['นอ','แอ','แน'] },     // แน่ใจ
      { display:'แล', lead:'ล', sara:'แ', spell:['ลอ','แอ','แล'] },     // แลดู
      { display:'แม', lead:'ม', sara:'แ', spell:['มอ','แอ','แม'] },     // แม่
    ],
  },
  // ─── มาตราตัวสะกด ─────────────────────────────────────────────────────────
  {
    id: 'kong',
    name: 'แม่ กง',
    mode: 'FILL_FINAL',
    finalSound: 'ง',
    words: [
      { display:'ลิง', lead:'ลิ', final:'ง', spell:['ลอ','อิ','งอ','ลิง'], distractors:['ม','น','ก'] },
      { display:'นาง', lead:'นา', final:'ง', spell:['นอ','อา','งอ','นาง'], distractors:['ด','บ','ย'] },
      { display:'ทาง', lead:'ทา', final:'ง', spell:['ทอ','อา','งอ','ทาง'], distractors:['น','ก','ม'] },
      { display:'ฟอง', lead:'ฟอ', final:'ง', spell:['ฟอ','ออ','งอ','ฟอง'], distractors:['บ','ด','ว'] },
      { display:'ขิง', lead:'ขิ', final:'ง', spell:['ขอ','อิ','งอ','ขิง'], distractors:['น','ม','ด'] },
    ],
  },
  {
    id: 'kon',
    name: 'แม่ กน',
    mode: 'FILL_FINAL',
    finalSound: 'น',
    words: [
      { display:'จาน', lead:'จา', final:'น', spell:['จอ','อา','นอ','จาน'], distractors:['ง','ม','ด'] },
      { display:'กิน', lead:'กิ', final:'น', spell:['กอ','อิ','นอ','กิน'], distractors:['ง','บ','ก'] },
      { display:'นอน', lead:'นอ', final:'น', spell:['นอ','ออ','นอ','นอน'], distractors:['ย','ว','ง'] },
      { display:'ดิน', lead:'ดิ', final:'น', spell:['ดอ','อิ','นอ','ดิน'], distractors:['ม','ก','บ'] },
      { display:'คน',  lead:'ค',  final:'น', spell:['คอ','นอ','คน'],       distractors:['ม','ง','ด'] },
    ],
  },
  {
    id: 'kom',
    name: 'แม่ กม',
    mode: 'FILL_FINAL',
    finalSound: 'ม',
    words: [
      { display:'ลม',  lead:'ล',  final:'ม', spell:['ลอ','มอ','ลม'], distractors:['ง','น','ด'] },
      { display:'ริม', lead:'ริ', final:'ม', spell:['รอ','อิ','มอ','ริม'], distractors:['ง','บ','ก'] },
      { display:'ถาม', lead:'ถา', final:'ม', spell:['ถอ','อา','มอ','ถาม'], distractors:['น','ย','ว'] },
      { display:'ชิม', lead:'ชิ', final:'ม', spell:['ชอ','อิ','มอ','ชิม'], distractors:['ด','ก','ง'] },
      { display:'ยิ้ม', lead:'ยิ', final:'ม', spell:['ยอ','อิ','มอ','ยิ้ม'], distractors:['น','ว','ก'] },
    ],
  },
  {
    id: 'kok',
    name: 'แม่ กก',
    mode: 'FILL_FINAL',
    finalSound: 'ก',
    words: [
      { display:'นก',  lead:'น',  final:'ก', spell:['นอ','กอ','นก'],       distractors:['ง','ด','บ'] },
      { display:'ปาก', lead:'ปา', final:'ก', spell:['ปอ','อา','กอ','ปาก'], distractors:['น','ม','ย'] },
      { display:'มาก', lead:'มา', final:'ก', spell:['มอ','อา','กอ','มาก'], distractors:['ง','ด','ว'] },
      { display:'ลูก', lead:'ลู', final:'ก', spell:['ลอ','อู','กอ','ลูก'], distractors:['น','บ','ง'] },
      { display:'รัก', lead:'รั', final:'ก', spell:['รอ','อะ','กอ','รัก'], distractors:['ด','ม','ว'] },
    ],
  },
  {
    id: 'kod',
    name: 'แม่ กด',
    mode: 'FILL_FINAL',
    finalSound: 'ด',
    words: [
      { display:'มด',  lead:'ม',  final:'ด', spell:['มอ','ดอ','มด'],       distractors:['ง','น','ก'] },
      { display:'ปิด', lead:'ปิ', final:'ด', spell:['ปอ','อิ','ดอ','ปิด'], distractors:['บ','ม','ย'] },
      { display:'กอด', lead:'กอ', final:'ด', spell:['กอ','ออ','ดอ','กอด'], distractors:['ง','ว','น'] },
      { display:'ขูด', lead:'ขู', final:'ด', spell:['ขอ','อู','ดอ','ขูด'], distractors:['ก','บ','ง'] },
      { display:'วัด', lead:'วั', final:'ด', spell:['วอ','อะ','ดอ','วัด'], distractors:['บ','ง','น'] },
    ],
  },
  {
    id: 'kob',
    name: 'แม่ กบ',
    mode: 'FILL_FINAL',
    finalSound: 'บ',
    words: [
      { display:'กบ',  lead:'ก',  final:'บ', spell:['กอ','บอ','กบ'],       distractors:['ด','ง','น'] },
      { display:'ลูบ', lead:'ลู', final:'บ', spell:['ลอ','อู','บอ','ลูบ'], distractors:['ก','ม','ย'] },
      { display:'ดิบ', lead:'ดิ', final:'บ', spell:['ดอ','อิ','บอ','ดิบ'], distractors:['ด','ง','ว'] },
      { display:'ตอบ', lead:'ตอ', final:'บ', spell:['ตอ','ออ','บอ','ตอบ'], distractors:['น','ก','ง'] },
      { display:'ครับ', lead:'ครั', final:'บ', spell:['คอ','รอ','อะ','บอ','ครับ'], distractors:['ด','ม','ง'] },
    ],
  },
  {
    id: 'koei',
    name: 'แม่ เกย',
    mode: 'FILL_FINAL',
    finalSound: 'ย',
    words: [
      { display:'ยาย', lead:'ยา', final:'ย', spell:['ยอ','อา','ยอ','ยาย'], distractors:['ง','น','ว'] },
      { display:'ลอย', lead:'ลอ', final:'ย', spell:['ลอ','ออ','ยอ','ลอย'], distractors:['ม','ก','ด'] },
      { display:'ตาย', lead:'ตา', final:'ย', spell:['ตอ','อา','ยอ','ตาย'], distractors:['น','บ','ง'] },
      { display:'ดอย', lead:'ดอ', final:'ย', spell:['ดอ','ออ','ยอ','ดอย'], distractors:['ว','ม','ก'] },
      { display:'ขาย', lead:'ขา', final:'ย', spell:['ขอ','อา','ยอ','ขาย'], distractors:['ง','ด','บ'] },
    ],
  },
  {
    id: 'koew',
    name: 'แม่ เกอว',
    mode: 'FILL_FINAL',
    finalSound: 'ว',
    words: [
      { display:'ดาว', lead:'ดา', final:'ว', spell:['ดอ','อา','วอ','ดาว'], distractors:['ย','ง','น'] },
      { display:'หิว', lead:'หิ', final:'ว', spell:['หอ','อิ','วอ','หิว'], distractors:['ม','ก','ด'] },
      { display:'ขาว', lead:'ขา', final:'ว', spell:['ขอ','อา','วอ','ขาว'], distractors:['ย','บ','ง'] },
      { display:'กาว', lead:'กา', final:'ว', spell:['กอ','อา','วอ','กาว'], distractors:['น','ม','ก'] },
      { display:'สาว', lead:'สา', final:'ว', spell:['สอ','อา','วอ','สาว'], distractors:['ย','ง','น'] },
    ],
  },
];

export function getMatra(id) {
  return MATRA.find((m) => m.id === id);
}
