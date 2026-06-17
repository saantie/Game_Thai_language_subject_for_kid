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
      { display:'วิ่ง', lead:'วิ', final:'ง', spell:['วอ','อิ','งอ','วิ่ง'], distractors:['น','ม','ด'] },
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
