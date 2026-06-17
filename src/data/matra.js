// data/matra.js — ข้อมูลมาตราตัวสะกด + คำ + spell + distractor
// แก้ไข/เพิ่มคำได้ที่นี่โดยไม่ต้องแตะโค้ดเกม
//
// mode:
//   'TWO_PART'   = พยัญชนะต้น + สระ (หยิบฟองไหนก็ได้ ทุกคู่เป็นคำจริง)
//   'FILL_FINAL' = ล็อกโจทย์ + เติมตัวสะกด (ต้องเลือกตัวสะกดให้ถูก)

export const MATRA = [
  {
    id: 'kaka',
    name: 'แม่ ก กา',
    mode: 'TWO_PART',
    sara: 'า',
    bubbles: ['ก', 'ม', 'ต', 'ข', 'ป', 'ย'],
    words: [
      { display: 'กา', lead: 'ก', sara: 'า', spell: ['กอ', 'อา', 'กา'] },
      { display: 'มา', lead: 'ม', sara: 'า', spell: ['มอ', 'อา', 'มา'] },
      { display: 'ตา', lead: 'ต', sara: 'า', spell: ['ตอ', 'อา', 'ตา'] },
      { display: 'ขา', lead: 'ข', sara: 'า', spell: ['ขอ', 'อา', 'ขา'] },
      { display: 'ปา', lead: 'ป', sara: 'า', spell: ['ปอ', 'อา', 'ปา'] },
      { display: 'ยา', lead: 'ย', sara: 'า', spell: ['ยอ', 'อา', 'ยา'] },
    ],
  },
  {
    id: 'kong',
    name: 'แม่ กง',
    mode: 'FILL_FINAL',
    finalSound: 'ง',
    words: [
      { display: 'ลิง', lead: 'ลิ', final: 'ง', spell: ['ลอ', 'อิ', 'งอ', 'ลิง'], distractors: ['ม', 'น', 'ก'] },
      { display: 'นาง', lead: 'นา', final: 'ง', spell: ['นอ', 'อา', 'งอ', 'นาง'], distractors: ['ด', 'บ', 'ย'] },
      { display: 'ทาง', lead: 'ทา', final: 'ง', spell: ['ทอ', 'อา', 'งอ', 'ทาง'], distractors: ['น', 'ก', 'ม'] },
      { display: 'ฟอง', lead: 'ฟอ', final: 'ง', spell: ['ฟอ', 'ออ', 'งอ', 'ฟอง'], distractors: ['บ', 'ด', 'ว'] },
    ],
  },
  {
    id: 'kon',
    name: 'แม่ กน',
    mode: 'FILL_FINAL',
    finalSound: 'น',
    words: [
      { display: 'จาน', lead: 'จา', final: 'น', spell: ['จอ', 'อา', 'นอ', 'จาน'], distractors: ['ง', 'ม', 'ด'] },
      { display: 'กิน', lead: 'กิ', final: 'น', spell: ['กอ', 'อิ', 'นอ', 'กิน'], distractors: ['ง', 'บ', 'ก'] },
      { display: 'นอน', lead: 'นอ', final: 'น', spell: ['นอ', 'ออ', 'นอ', 'นอน'], distractors: ['ย', 'ว', 'ง'] },
      { display: 'มือ', lead: 'มื', final: 'อ', spell: ['มอ', 'อือ', 'มือ'], distractors: ['น', 'ง', 'ก'], skip: true },
    ].filter((w) => !w.skip),
  },
  {
    id: 'kom',
    name: 'แม่ กม',
    mode: 'FILL_FINAL',
    finalSound: 'ม',
    words: [
      { display: 'ลม', lead: 'ล', final: 'ม', spell: ['ลอ', 'มอ', 'ลม'], distractors: ['ง', 'น', 'ด'] },
      { display: 'ริม', lead: 'ริ', final: 'ม', spell: ['รอ', 'อิ', 'มอ', 'ริม'], distractors: ['ง', 'บ', 'ก'] },
      { display: 'ถาม', lead: 'ถา', final: 'ม', spell: ['ถอ', 'อา', 'มอ', 'ถาม'], distractors: ['น', 'ย', 'ว'] },
      { display: 'ชิม', lead: 'ชิ', final: 'ม', spell: ['ชอ', 'อิ', 'มอ', 'ชิม'], distractors: ['ด', 'ก', 'ง'] },
    ],
  },
  {
    id: 'kok',
    name: 'แม่ กก',
    mode: 'FILL_FINAL',
    finalSound: 'ก',
    words: [
      { display: 'นก', lead: 'น', final: 'ก', spell: ['นอ', 'กอ', 'นก'], distractors: ['ง', 'ด', 'บ'] },
      { display: 'ปาก', lead: 'ปา', final: 'ก', spell: ['ปอ', 'อา', 'กอ', 'ปาก'], distractors: ['น', 'ม', 'ย'] },
      { display: 'มาก', lead: 'มา', final: 'ก', spell: ['มอ', 'อา', 'กอ', 'มาก'], distractors: ['ง', 'ด', 'ว'] },
      { display: 'ลูก', lead: 'ลู', final: 'ก', spell: ['ลอ', 'อู', 'กอ', 'ลูก'], distractors: ['น', 'บ', 'ง'] },
    ],
  },
  {
    id: 'kod',
    name: 'แม่ กด',
    mode: 'FILL_FINAL',
    finalSound: 'ด',
    words: [
      { display: 'มด', lead: 'ม', final: 'ด', spell: ['มอ', 'ดอ', 'มด'], distractors: ['ง', 'น', 'ก'] },
      { display: 'ปิด', lead: 'ปิ', final: 'ด', spell: ['ปอ', 'อิ', 'ดอ', 'ปิด'], distractors: ['บ', 'ม', 'ย'] },
      { display: 'กอด', lead: 'กอ', final: 'ด', spell: ['กอ', 'ออ', 'ดอ', 'กอด'], distractors: ['ง', 'ว', 'น'] },
      { display: 'ขูด', lead: 'ขู', final: 'ด', spell: ['ขอ', 'อู', 'ดอ', 'ขูด'], distractors: ['ก', 'บ', 'ง'] },
    ],
  },
  {
    id: 'kob',
    name: 'แม่ กบ',
    mode: 'FILL_FINAL',
    finalSound: 'บ',
    words: [
      { display: 'กบ', lead: 'ก', final: 'บ', spell: ['กอ', 'บอ', 'กบ'], distractors: ['ด', 'ง', 'น'] },
      { display: 'ลูบ', lead: 'ลู', final: 'บ', spell: ['ลอ', 'อู', 'บอ', 'ลูบ'], distractors: ['ก', 'ม', 'ย'] },
      { display: 'ดิบ', lead: 'ดิ', final: 'บ', spell: ['ดอ', 'อิ', 'บอ', 'ดิบ'], distractors: ['ด', 'ง', 'ว'] },
      { display: 'ตอบ', lead: 'ตอ', final: 'บ', spell: ['ตอ', 'ออ', 'บอ', 'ตอบ'], distractors: ['น', 'ก', 'ง'] },
    ],
  },
  {
    id: 'koei',
    name: 'แม่ เกย',
    mode: 'FILL_FINAL',
    finalSound: 'ย',
    words: [
      { display: 'ยาย', lead: 'ยา', final: 'ย', spell: ['ยอ', 'อา', 'ยอ', 'ยาย'], distractors: ['ง', 'น', 'ว'] },
      { display: 'ลอย', lead: 'ลอ', final: 'ย', spell: ['ลอ', 'ออ', 'ยอ', 'ลอย'], distractors: ['ม', 'ก', 'ด'] },
      { display: 'ตาย', lead: 'ตา', final: 'ย', spell: ['ตอ', 'อา', 'ยอ', 'ตาย'], distractors: ['น', 'บ', 'ง'] },
      { display: 'ดอย', lead: 'ดอ', final: 'ย', spell: ['ดอ', 'ออ', 'ยอ', 'ดอย'], distractors: ['ว', 'ม', 'ก'] },
    ],
  },
  {
    id: 'koew',
    name: 'แม่ เกอว',
    mode: 'FILL_FINAL',
    finalSound: 'ว',
    words: [
      { display: 'ดาว', lead: 'ดา', final: 'ว', spell: ['ดอ', 'อา', 'วอ', 'ดาว'], distractors: ['ย', 'ง', 'น'] },
      { display: 'หิว', lead: 'หิ', final: 'ว', spell: ['หอ', 'อิ', 'วอ', 'หิว'], distractors: ['ม', 'ก', 'ด'] },
      { display: 'ขาว', lead: 'ขา', final: 'ว', spell: ['ขอ', 'อา', 'วอ', 'ขาว'], distractors: ['ย', 'บ', 'ง'] },
      { display: 'กาว', lead: 'กา', final: 'ว', spell: ['กอ', 'อา', 'วอ', 'กาว'], distractors: ['น', 'ม', 'ก'] },
    ],
  },
];

// helper: หา matra จาก id
export function getMatra(id) {
  return MATRA.find((m) => m.id === id);
}
