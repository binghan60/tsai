// 住院示範資料：給一隻已建檔的貓（預設「牛奶」）加一段過去的住院，看病歷日誌「住院」列出院後的摘要
// （每一筆的體重、體溫與 IDEXX 檢驗）。只新增，不改動這隻貓原有的任何資料。
// 示範的看診與住院單原因都以「[示範]」開頭、檢驗結果的 diagnosticSetId 都以 DEMO_STAY_ 開頭，用來辨識與清除。
//   node scripts/_hospital-demo-seed.mjs                建立（會先清掉上一批）
//   node scripts/_hospital-demo-seed.mjs --pet=貓咪名   換一隻貓
//   node scripts/_hospital-demo-seed.mjs --clean        只清除
// 伺服器不會收到即時通知，建立後請重新整理頁面。
import 'dotenv/config';
import mongoose from 'mongoose';
import Pet from '../src/models/Pet.js';
import Owner from '../src/models/Owner.js';
import Appointment from '../src/models/Appointment.js';
import ClinicalNote from '../src/models/ClinicalNote.js';
import Hospitalization from '../src/models/Hospitalization.js';
import HospitalizationEntry from '../src/models/HospitalizationEntry.js';
import LabResult from '../src/models/LabResult.js';
import { syncAppointmentJournal } from '../src/lib/appointmentJournal.js';
import { combineClinicDateTime } from '../src/lib/clinicTime.js';

const MARK = '[示範]';
const SET_PREFIX = 'DEMO_STAY_';
const TEMPLATE_ID = '6a83187ebfb283db73bca0b4'; // 例行健檢
const petName = process.argv.find((arg) => arg.startsWith('--pet='))?.slice('--pet='.length) || '牛奶';
const at = (date, time) => combineClinicDateTime(date, time);

// 照護紀錄：[日期, 時間, 體重, 體溫, 食物放置]。10/14 量了兩次體重，10/11、10/12 各量了兩次體溫。
const ENTRIES = [
  ['2026-10-11', '10:00', 3.48, 38.6, 'a/d 1/4 罐'],
  ['2026-10-11', '18:00', null, 39.1, ''],
  ['2026-10-12', '09:30', 3.42, 38.9, 'a/d 1/3 罐'],
  ['2026-10-12', '18:20', null, 38.4, ''],
  ['2026-10-13', '10:10', 3.45, 38.5, 'a/d 1/2 罐'],
  ['2026-10-14', '09:50', 3.52, 38.3, ''],
  ['2026-10-14', '16:30', 3.5, null, 'a/d 1/2 罐'],
  ['2026-10-15', '09:40', 3.58, 38.4, ''],
];

// 生化與電解質（Catalyst One）、血球（ProCyte_Dx），入院那天偏高、慢慢回到正常範圍：[代號, 值, 單位, 參考下限, 參考上限]
const CHEM = (crea, bun) => [['GLU', '117', 'mg/dL', 74, 159], ['BUN', bun, 'mg/dL', 16, 36], ['CREA', crea, 'mg/dL', 0.8, 2.4], ['SDMA', '9', 'µg/dL', 0, 14]];
const CBC = (wbc, hct) => [['RBC', '8.52', 'M/µL', 6.54, 12.2], ['HCT', hct, '%', 30.3, 52.3], ['HGB', '12.6', 'g/dL', 9.8, 16.2], ['WBC', wbc, 'K/µL', 2.87, 17.02], ['PLT', '232', 'K/µL', 151, 600]];
const LYTES = (k) => [['Na', '151', 'mmol/L', 147, 156], ['K', k, 'mmol/L', 3.4, 4.6], ['Cl', '118', 'mmol/L', 107, 120]];
const LABS = [
  ['2026-10-10', '11:00', 'Catalyst One', CHEM('2.9', '41')],
  ['2026-10-10', '11:20', 'ProCyte_Dx', CBC('22.4', '38.1')],
  ['2026-10-11', '09:40', 'Catalyst One', LYTES('3.1')],
  ['2026-10-12', '10:10', 'ProCyte_Dx', CBC('18.9', '35.2')],
  ['2026-10-13', '10:30', 'Catalyst One', CHEM('2.2', '33')],
  ['2026-10-14', '10:30', 'Catalyst One', LYTES('4.0')],
  ['2026-10-15', '08:50', 'ProCyte_Dx', CBC('11.6', '36.8')],
  ['2026-10-15', '09:05', 'Catalyst One', CHEM('1.7', '25')],
];

const assay = ([code, value, unit, referenceMin, referenceMax]) => ({ code, value, unit, referenceMin, referenceMax });

async function findPet() {
  const pets = await Pet.find({ name: petName, species: '貓' }).select('_id name ownerId').lean();
  if (pets.length !== 1) throw new Error(`找到 ${pets.length} 隻叫「${petName}」的貓，要剛好一隻（用 --pet= 指定名字）`);
  return pets[0];
}

async function clean(pet) {
  const stays = await Hospitalization.find({ petId: pet._id, reason: new RegExp(`^\\${MARK}`) }).select('_id admittingAppointmentId').lean();
  const stayIds = stays.map((stay) => stay._id);
  const appointmentIds = stays.map((stay) => stay.admittingAppointmentId);
  console.log('清除住院示範資料', {
    labResults: (await LabResult.deleteMany({ diagnosticSetId: new RegExp(`^${SET_PREFIX}`), petId: pet._id })).deletedCount,
    entries: (await HospitalizationEntry.deleteMany({ hospitalizationId: { $in: stayIds } })).deletedCount,
    clinicalNotes: (await ClinicalNote.deleteMany({ appointmentId: { $in: appointmentIds } })).deletedCount,
    appointments: (await Appointment.deleteMany({ _id: { $in: appointmentIds }, reason: new RegExp(`^\\${MARK}`) })).deletedCount,
    hospitalizations: (await Hospitalization.deleteMany({ _id: { $in: stayIds } })).deletedCount,
  });
}

async function seed(pet) {
  const owner = await Owner.findById(pet.ownerId).select('name phone').lean();
  const admittedAt = at('2026-10-10', '10:30');
  const appointment = new Appointment({
    date: '2026-10-10',
    time: '10:00',
    scheduledAt: admittedAt,
    ownerId: pet.ownerId,
    petId: pet._id,
    ownerName: owner?.name ?? '',
    ownerPhone: owner?.phone ?? '',
    petName: pet.name,
    species: '貓',
    visitType: 'return',
    reason: `${MARK} 食慾不振、脫水`,
    templateId: TEMPLATE_ID,
    status: 'completed',
    checkedInAt: admittedAt,
    walkInAt: admittedAt,
    visitStartedAt: at('2026-10-10', '10:40'),
    handoffAt: at('2026-10-10', '11:20'),
    deskCompletedAt: at('2026-10-10', '11:30'),
    weightKg: 3.6,
    temperatureC: 38.8,
    visitNote: '食慾不振三天，脫水約 5%，收住院輸液觀察。',
  });
  const [stay] = await Hospitalization.create([{
    petId: pet._id,
    admittingAppointmentId: appointment._id,
    status: 'discharged',
    admittedAt,
    dischargedAt: at('2026-10-15', '09:50'),
    reason: `${MARK} 食慾不振、脫水`,
    dischargeNote: '食慾恢復，輸液已停。',
  }]);
  appointment.hospitalizationId = stay._id;
  await appointment.save();
  await syncAppointmentJournal(appointment);

  await HospitalizationEntry.create(ENTRIES.map(([date, time, weightKg, temperatureC, food]) => ({
    hospitalizationId: stay._id, petId: pet._id, recordedAt: at(date, time), weightKg, temperatureC, food, staff: 'vet',
  })));
  await LabResult.create(LABS.map(([date, time, instrument, rows], index) => ({
    diagnosticSetId: `${SET_PREFIX}${index + 1}`,
    instrument,
    runAt: at(date, time),
    patient: { name: pet.name },
    assays: rows.map(assay),
    rawXml: 'demo',
    petId: pet._id,
    hospitalizationId: stay._id,
    matchedAt: new Date(),
    matchSource: 'manual',
    appliedAt: new Date(),
  })));
  console.log('已建立住院示範資料', { pet: pet.name, hospitalization: String(stay._id), entries: ENTRIES.length, labResults: LABS.length });
}

await mongoose.connect(process.env.MONGODB_URI);
console.log('db:', mongoose.connection.name);
try {
  const pet = await findPet();
  await clean(pet);
  if (!process.argv.includes('--clean')) await seed(pet);
} finally {
  await mongoose.disconnect();
}
