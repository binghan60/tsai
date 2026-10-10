// IDEXX 示範資料：沒有 IDEXX 儀器時，用來看「填入狀態」燈號的每一種情況（診療台「檢驗報告」標題旁、健檢報告填寫頁）。
// 建五隻今天已報到的貓，各自對應一種情況；檢驗結果走跟正式流程同一支 matchManually，所以填入、差異、病歷日誌都是真的算出來的。
// 示範飼主電話都以 0900200 開頭、檢驗結果的 diagnosticSetId 都以 DEMO_ 開頭，用來辨識與清除（跟 _demo-seed.mjs 的 0900100 分開）。
//   node scripts/_idexx-demo-seed.mjs           建立（會先清掉上一批）
//   node scripts/_idexx-demo-seed.mjs --clean   只清除
// 伺服器不會收到即時通知，建立後請重新整理頁面。
import 'dotenv/config';
import mongoose from 'mongoose';
import Owner from '../src/models/Owner.js';
import Pet from '../src/models/Pet.js';
import Appointment from '../src/models/Appointment.js';
import ClinicalNote from '../src/models/ClinicalNote.js';
import MedicalRecord from '../src/models/MedicalRecord.js';
import FormTemplate from '../src/models/FormTemplate.js';
import LabResult from '../src/models/LabResult.js';
import { matchManually } from '../src/lib/labResultApply.js';
import { matchLabItem } from '../src/lib/labResultFill.js';
import { templateLabItems } from '../../shared/labValues.js';
import { clinicToday, combineClinicDateTime } from '../src/lib/clinicTime.js';

const PHONE_PREFIX = '0900200';
const SET_PREFIX = 'DEMO_';
const TODAY = clinicToday();
const TEMPLATE_ID = '6a83187ebfb283db73bca0b4'; // 例行健檢（檢驗項目已設血球機的 IDEXX 代號）
const at = (time) => combineClinicDateTime(TODAY, time);

// 血球機（ProCyte Dx）一次的結果；PDW、RDW-SD 表單上沒有對應欄位。
const CBC = [
  ['RBC', '8.52', 'M/µL', 6.54, 12.2], ['HCT', '38.1', '%', 30.3, 52.3], ['HGB', '12.6', 'g/dL', 9.8, 16.2],
  ['MCV', '44.7', 'fL', 35.9, 53.1], ['WBC', '22.4', 'K/µL', 2.87, 17.02], ['NEU', '17.9', 'K/µL', 2.3, 10.29],
  ['LYM', '2.6', 'K/µL', 0.92, 6.88], ['PLT', '132', 'K/µL', 151, 600], ['PDW', '10.2', 'fL', null, null], ['RDW-SD', '27.4', 'fL', null, null],
];
// 生化機（Catalyst One）：這份表單沒有生化的代號，整份都沒有對應欄位。
const CHEM = [['GLU', '117', 'mg/dL', 74, 159], ['BUN', '25', 'mg/dL', 16, 36], ['CREA', '1.7', 'mg/dL', 0.8, 2.4], ['SDMA', '9', 'µg/dL', 0, 14]];

async function clean() {
  const ownerIds = (await Owner.find({ phone: new RegExp(`^${PHONE_PREFIX}`) }).select('_id')).map((owner) => owner._id);
  const petIds = (await Pet.find({ ownerId: { $in: ownerIds } }).select('_id')).map((pet) => pet._id);
  console.log('清除 IDEXX 示範資料', {
    labResults: (await LabResult.deleteMany({ diagnosticSetId: new RegExp(`^${SET_PREFIX}`) })).deletedCount,
    clinicalNotes: (await ClinicalNote.deleteMany({ petId: { $in: petIds } })).deletedCount,
    records: (await MedicalRecord.deleteMany({ petId: { $in: petIds } })).deletedCount,
    appointments: (await Appointment.deleteMany({ petId: { $in: petIds } })).deletedCount,
    pets: (await Pet.deleteMany({ _id: { $in: petIds } })).deletedCount,
    owners: (await Owner.deleteMany({ _id: { $in: ownerIds } })).deletedCount,
  });
}

async function seed() {
  const template = await FormTemplate.findById(TEMPLATE_ID);
  if (!template) throw new Error('找不到「例行健檢」表單');
  const labItems = templateLabItems(template);
  // 先在看診上填一個跟 IDEXX 不同的值（像醫師在報告上手打的），匯入時才會出現「跟報告不同」。
  const preset = (code, value) => {
    const item = matchLabItem(labItems, 'ProCyte_Dx', code);
    if (!item) throw new Error(`「例行健檢」沒有對應 ${code} 的檢驗項目`);
    return { key: item.key, label: item.label, value, unit: item.unit || '', referenceMin: item.referenceMin ?? null, referenceMax: item.referenceMax ?? null };
  };

  const cats = [
    { name: '小綠', owner: '林綠燈', time: '14:00', reason: '示範：綠燈（全部填入）', templateId: template._id, labValues: [], result: ['ProCyte_Dx', CBC] },
    { name: '小黃', owner: '黃不同', time: '14:15', reason: '示範：黃燈（2 項跟報告不同）', templateId: template._id, labValues: [preset('RBC', '7.90'), preset('WBC', '12.0')], result: ['ProCyte_Dx', CBC] },
    { name: '小白', owner: '白沒表', time: '14:30', reason: '示範：黃燈（這次看診沒選健檢表單）', templateId: null, labValues: [], result: ['ProCyte_Dx', CBC] },
    { name: '小藍', owner: '藍沒欄', time: '14:45', reason: '示範：藍燈（表單沒有生化的欄位）', templateId: template._id, labValues: [], result: ['Catalyst_One', CHEM] },
    // 這一隻的結果留在待確認清單，自己從診療台按「匯入檢驗結果」；RBC 先填了不同的值，匯入時會跳比對視窗。
    { name: '小灰', owner: '灰待匯', time: '15:00', reason: '示範：自己匯入（結果在待確認清單）', templateId: template._id, labValues: [preset('RBC', '7.90')], result: ['ProCyte_Dx', CBC], pending: true },
  ];

  let number = 0;
  for (const cat of cats) {
    number += 1;
    const owner = await Owner.create({ name: cat.owner, phone: `${PHONE_PREFIX}${String(number).padStart(3, '0')}` });
    const pet = await Pet.create({ name: cat.name, ownerId: owner._id, species: '貓', breed: 'Mixed', sex: 'male', neutered: 'yes', weightKg: 4.2 });
    const appointment = await Appointment.create({
      ownerId: owner._id, petId: pet._id, visitType: 'return', ownerName: owner.name, ownerPhone: owner.phone, petName: pet.name, species: '貓',
      date: TODAY, time: cat.time, scheduledAt: at(cat.time), reason: cat.reason, status: 'arrived',
      checkinNumber: number, checkinNumberHistory: [number], checkedInAt: new Date(),
      templateId: cat.templateId, labValues: cat.labValues,
    });
    const [instrument, assays] = cat.result;
    const result = await LabResult.create({
      diagnosticSetId: `${SET_PREFIX}${TODAY}_${number}`, instrument, runAt: new Date(Date.now() - (6 - number) * 60_000),
      // IDEXX 主機上手打的名字，沒有帶貓咪編號。
      client: { lastName: cat.owner.slice(0, 1), firstName: cat.owner.slice(1) },
      patient: { name: cat.name, species: 'FELINE' },
      assays: assays.map(([code, value, unit, referenceMin, referenceMax]) => ({ code, value, unit, referenceMin, referenceMax, qualifier: '=' })),
      rawXml: '<!-- scripts/_idexx-demo-seed.mjs 建立的示範結果，沒有原始檔 -->', fileName: `示範_${cat.name}_${instrument}.xml`,
    });
    const fill = cat.pending ? { status: '留在待確認清單' } : await matchManually(result._id, pet._id, { appointmentId: appointment._id });
    console.log(`${cat.name}（號碼牌 ${number}）`, cat.reason, '→', fill.status, fill.filled?.length ? `填入 ${fill.filled.length} 項` : '', fill.conflicts ? `不同 ${fill.conflicts} 項` : '', fill.unmapped ? `沒有欄位 ${fill.unmapped} 項` : '');
  }
}

await mongoose.connect(process.env.MONGODB_URI);
try {
  await clean();
  if (!process.argv.includes('--clean')) await seed();
} finally {
  await mongoose.disconnect();
}
