// 示範資料：診療台、掛號台、藥單、待辦。所有示範飼主電話都以 0900100 開頭，用來辨識與清除。
// 日期一律以執行當天（診所時區）為準，時段是固定的：上午診已看完、下午診待報到。
//   node scripts/_demo-seed.mjs                    建立（會先清掉上一批示範資料）
//   node scripts/_demo-seed.mjs --date=2026-10-01  指定「今天」
//   node scripts/_demo-seed.mjs --clean            只清除
import 'dotenv/config';
import mongoose from 'mongoose';
import Owner from '../src/models/Owner.js';
import Pet from '../src/models/Pet.js';
import Appointment from '../src/models/Appointment.js';
import MedicationOrder from '../src/models/MedicationOrder.js';
import Todo from '../src/models/Todo.js';
import ClinicalNote from '../src/models/ClinicalNote.js';
import MedicalRecord from '../src/models/MedicalRecord.js';
import FormTemplate from '../src/models/FormTemplate.js';
import PinnedPet from '../src/models/PinnedPet.js';
import { defaultRecordFields } from '../src/lib/formTemplate.js';
import { clinicDayStart, clinicToday, combineClinicDateTime } from '../src/lib/clinicTime.js';

const PHONE_PREFIX = '0900100';
const dateArg = process.argv.find(arg => arg.startsWith('--date='))?.slice('--date='.length);
if (dateArg && !clinicDayStart(dateArg)) throw new Error(`--date 格式要是 YYYY-MM-DD：${dateArg}`);
const TODAY = dateArg || clinicToday();
// 相對 TODAY 的第 offset 天（YYYY-MM-DD）。從當天中午算，避開時區換日的邊界。
const day = offset => clinicToday(new Date(clinicDayStart(TODAY, offset).getTime() + 12 * 3600_000));
const YESTERDAY = day(-1);
const TOMORROW = day(1);
const TEMPLATE_ID = '6a83187ebfb283db73bca0b4'; // 例行健檢
const DEMO_TODO_MARK = /^(明天叫貨：|回電給 #咪咪|\[red\]疫苗冰箱|#小橘 血檢|整理手術室|月底盤點針劑|補印號碼牌 1–20|寄出 #奶茶)/;

const at = (date, time) => combineClinicDateTime(date, time);

async function insertRaw(Model, doc, createdAt, updatedAt = createdAt) {
  const model = new Model(doc);
  await model.validate();
  const raw = { ...model.toObject({ depopulate: true }), createdAt, updatedAt, __v: 0 };
  await Model.collection.insertOne(raw);
  return raw;
}

async function clean() {
  const owners = await Owner.find({ phone: new RegExp(`^${PHONE_PREFIX}`) }).select('_id');
  const ownerIds = owners.map(o => o._id);
  const pets = await Pet.find({ ownerId: { $in: ownerIds } }).select('_id');
  const petIds = pets.map(p => p._id);
  const result = {
    clinicalNotes: (await ClinicalNote.deleteMany({ petId: { $in: petIds } })).deletedCount,
    records: (await MedicalRecord.deleteMany({ petId: { $in: petIds } })).deletedCount,
    medications: (await MedicationOrder.deleteMany({ petId: { $in: petIds } })).deletedCount,
    pinned: (await PinnedPet.deleteMany({ petId: { $in: petIds } })).deletedCount,
    appointments: (await Appointment.deleteMany({ $or: [{ petId: { $in: petIds } }, { ownerPhone: new RegExp(`^${PHONE_PREFIX}`) }] })).deletedCount,
    todos: (await Todo.deleteMany({ $or: [{ 'mentions.petId': { $in: petIds } }, { content: DEMO_TODO_MARK }] })).deletedCount,
    pets: (await Pet.deleteMany({ _id: { $in: petIds } })).deletedCount,
    owners: (await Owner.deleteMany({ _id: { $in: ownerIds } })).deletedCount,
  };
  console.log('清除示範資料', result);
}

async function seed() {
  const template = await FormTemplate.findById(TEMPLATE_ID);
  if (!template) throw new Error('找不到「例行健檢」表單');
  const labItems = template.sections.flatMap(s => s.items).filter(i => i.type === 'lab');
  const lab = (key, value) => {
    const item = labItems.find(i => i.key === key);
    return { key, label: item.label, value, unit: item.unit || '', referenceMin: item.referenceMin ?? null, referenceMax: item.referenceMax ?? null };
  };

  // ── 飼主與貓咪 ──
  const ownerDefs = [
    { key: 'chen', name: '陳怡君', phone: '0900100001', email: 'demo.chen@example.com' },
    { key: 'wang', name: '王建民', phone: '0900100002' },
    { key: 'lee', name: '李佩珊', phone: '0900100003' },
    { key: 'chang', name: '張志豪', phone: '0900100004', notes: '電話常不接，請改傳 LINE' },
    { key: 'huang', name: '黃雅婷', phone: '0900100005' },
    { key: 'wu', name: '吳宗翰', phone: '0900100006' },
    { key: 'liu', name: '劉淑芬', phone: '0900100007', notes: '高齡貓，飼主容易緊張，說明請放慢' },
    { key: 'tsai', name: '蔡明哲', phone: '0900100008' },
  ];
  const owners = {};
  for (const def of ownerDefs) {
    const { key, ...doc } = def;
    owners[key] = await Owner.create(doc);
  }

  const petDefs = [
    { key: 'naicha', owner: 'chen', name: '奶茶', breed: 'British Shorthair', color: '奶油色', sex: 'female', neutered: 'yes', birthDate: '2019-04-10', weightKg: 4.6 },
    { key: 'mochi', owner: 'chen', name: '麻糬', breed: 'Mixed', color: '白底灰斑', sex: 'male', neutered: 'yes', birthDate: '2021-07-01', weightKg: 5.2 },
    { key: 'orange', owner: 'wang', name: '小橘', breed: 'Mixed', color: '橘虎斑', sex: 'male', neutered: 'yes', birthDate: '2022-03-15', weightKg: 6.1 },
    { key: 'brownsugar', owner: 'lee', name: '黑糖', breed: 'Mixed', color: '玳瑁', sex: 'female', neutered: 'no', birthDate: '2025-10-01', weightKg: 3.4 },
    { key: 'lucky', owner: 'chang', name: 'Lucky', breed: 'American Shorthair', color: '銀虎斑', sex: 'male', neutered: 'yes', birthDate: '2016-05-20', weightKg: 5.8, medicalHistory: ['關節退化'] },
    { key: 'douhua', owner: 'huang', name: '豆花', breed: 'Ragdoll', color: '海豹色重點', sex: 'female', neutered: 'yes', birthDate: '2020-11-11', weightKg: 4.9, allergyStatus: 'yes', allergyType: 'Amoxicillin', notes: '會咬人，抓取請戴手套' },
    { key: 'pudding', owner: 'wu', name: '布丁', breed: 'Scottish Fold', color: '藍白', sex: 'male', neutered: 'yes', birthDate: '2021-02-02', weightKg: 5.0 },
    { key: 'sesame', owner: 'wu', name: '芝麻', breed: 'Mixed', color: '黑', sex: 'female', neutered: 'yes', birthDate: '2018-08-08', weightKg: 3.9, medicalHistory: ['慢性腸胃炎'] },
    { key: 'mimi', owner: 'liu', name: '咪咪', breed: 'Persian', color: '白', sex: 'female', neutered: 'yes', birthDate: '2014-06-01', weightKg: 3.6, medicalHistory: ['慢性腎病'], notes: '抽血容易緊張，先讓她在提籠裡休息' },
    { key: 'cola', owner: 'tsai', name: '可樂', breed: 'Russian Blue', color: '藍灰', sex: 'male', neutered: 'yes', birthDate: '2020-01-20', weightKg: 4.4 },
    { key: 'pidan', owner: 'tsai', name: '皮蛋', breed: 'Bengal', color: '豹紋', sex: 'male', neutered: 'no', birthDate: '2025-12-24', weightKg: 3.1 },
  ];
  const pets = {};
  for (const def of petDefs) {
    const { key, owner, birthDate, ...doc } = def;
    pets[key] = await Pet.create({ ...doc, ownerId: owners[owner]._id, species: '貓', birthDate: new Date(`${birthDate}T00:00:00+08:00`) });
  }

  // ── 過去的手動病歷日誌（歷次紀錄欄才有東西看） ──
  const manualNotes = [
    ['mimi', -44, '15:00', 'SDMA 16、BUN 38，腎指數比上次略升。飲水量增加，建議改腎臟處方飼料，一個月後複查。'],
    ['mimi', -117, '16:20', '牙結石第三級，右上 P4 牙齦紅腫。飼主考慮中，先開漱口凝膠。'],
    ['orange', -118, '11:00', '年度疫苗（三合一）。體重 5.9 kg，理學檢查無異常。'],
    ['lucky', -70, '14:40', '後肢跳躍意願下降，X 光：雙側膝關節退化。開始 Cosequin 保健。'],
    ['douhua', -140, '17:10', '外耳炎，耳垢抹片見酵母菌。注意：對 Amoxicillin 過敏（起紅疹）。'],
    ['sesame', -14, '15:30', '軟便一週，糞檢陰性。改腸胃處方飼料，兩週後複診。'],
  ];
  for (const [pet, offset, time, content] of manualNotes) {
    await ClinicalNote.create({ petId: pets[pet]._id, entryDate: at(day(offset), time), content, source: 'manual' });
  }

  // ── 掛號 ──
  const base = (petKey, extra) => {
    const pet = pets[petKey];
    const owner = Object.values(owners).find(o => String(o._id) === String(pet.ownerId));
    return {
      ownerId: owner._id, petId: pet._id, visitType: 'return',
      ownerName: owner.name, ownerPhone: owner.phone, petName: pet.name, species: '貓',
      templateId: template._id, workflowVersion: 2, ...extra,
    };
  };
  const newPatient = extra => ({ ownerId: null, petId: null, visitType: 'new', species: '貓', templateId: template._id, workflowVersion: 2, ...extra });
  const slot = (date, time, extra) => ({ date, time, scheduledAt: at(date, time), ...extra });

  const appointmentDefs = [
    // 上午診：已完成
    { key: 'naicha', doc: base('naicha', { ...slot(TODAY, '10:00'), reason: '年度健檢＋腎指數追蹤', status: 'completed',
      checkinNumberHistory: [1], checkedInAt: at(TODAY, '09:52'),
      weightKg: 4.5, temperatureC: 38.4,
      labValues: [lab('rbc', '268'), lab('bun', '34'), lab('cre', '1.9'), lab('sdma', '15'), lab('glucose', '112')],
      visitNote: '整體狀況穩定，[orange]腎指數在臨界值[/orange]。牙齒輕度牙結石。',
      specialCareNote: '腎臟處方飼料開始換食，新舊飼料混合 7 天漸進更換',
      followUpRecommendation: '兩週後回診複查腎指數', followUpReason: '複查腎指數',
      followUpDate: day(14), followUpTime: '14:30',
      visitStartedAt: at(TODAY, '10:02'), handoffAt: at(TODAY, '10:30'), deskCompletedAt: at(TODAY, '10:41'), completedAt: at(TODAY, '10:41') }),
      createdAt: at(day(-8), '15:10') },
    { key: 'mochi', doc: base('mochi', { ...slot(TODAY, '10:15'), reason: '一直甩頭、抓右耳', status: 'completed',
      checkinNumberHistory: [2], checkedInAt: at(TODAY, '09:53'),
      weightKg: 5.3, temperatureC: 38.7,
      visitNote: '右耳道紅腫、褐色耳垢，抹片見**酵母菌**。已清耳。',
      specialCareNote: '耳滴每天兩次，滴完按摩耳根；一週內避免洗澡',
      visitStartedAt: at(TODAY, '10:31'), handoffAt: at(TODAY, '10:50'), deskCompletedAt: at(TODAY, '11:02'), completedAt: at(TODAY, '11:02') }),
      createdAt: at(day(-2), '18:20') },
    // 上午診：已交櫃台（待櫃台處理，回診還沒安排）
    { key: 'orange', doc: base('orange', { ...slot(TODAY, '10:30'), reason: '嘔吐兩天、食慾差', status: 'pending_checkout',
      checkinNumber: 3, checkinNumberHistory: [3], checkedInAt: at(TODAY, '10:18'),
      weightKg: 5.8, temperatureC: 39.1,
      labValues: [lab('wbc', '19.8'), lab('alt', '85'), lab('glucose', '145')],
      visitNote: '腹部觸診無明顯異物感，輕度脫水。已皮下輸液 150 ml、止吐針。\n[red]若 24 小時內仍吐，安排腹部超音波[/red]',
      internalNote: '飼主詢問費用分期，已請櫃台說明',
      specialCareNote: '今晚先禁食，明早起少量多餐；再吐請立刻回診',
      followUpRecommendation: '3 天後回診複查血檢', followUpReason: '複查血檢',
      visitStartedAt: at(TODAY, '11:03'), handoffAt: at(TODAY, '11:35') }),
      createdAt: at(TODAY, '08:45') },
    // 上午診：看診中（手術）
    { key: 'brownsugar', doc: base('brownsugar', { ...slot(TODAY, '10:45'), estimatedDurationMinutes: 90, reason: '結紮手術',
      isSurgery: true, surgeryName: '卵巢子宮摘除術', status: 'arrived',
      checkinNumber: 4, checkinNumberHistory: [4], checkedInAt: at(TODAY, '10:20'),
      weightKg: 3.4, temperatureC: 38.6,
      labValues: [lab('rbc', '210'), lab('bun', '22'), lab('cre', '1.2')],
      visitNote: '術前血檢正常，**11:10 麻醉誘導**。',
      internalNote: '飼主 16:00 後才能來接',
      visitStartedAt: at(TODAY, '11:05') }),
      createdAt: at(day(-7), '12:00') },
    // 上午診：候診中（遲到 12 分鐘）
    { key: 'lucky', doc: base('lucky', { ...slot(TODAY, '11:00'), reason: '疫苗補強＋關節評估', status: 'arrived',
      checkinNumber: 5, checkinNumberHistory: [5], checkedInAt: at(TODAY, '11:12'), latenessMinutes: 12 }),
      createdAt: at(day(-3), '10:30') },
    // 上午診：候診中（有備註、過敏）
    { key: 'douhua', doc: base('douhua', { ...slot(TODAY, '11:15'), reason: '皮膚癢、一直抓耳朵', status: 'arrived',
      checkinNumber: 6, checkinNumberHistory: [6], checkedInAt: at(TODAY, '11:10') }),
      createdAt: at(TODAY, '09:05') },
    // 上午診：初診，時間已過還沒報到（遲到未報到）
    { key: 'newA', doc: newPatient({ ...slot(TODAY, '11:30'), ownerName: '林小姐', ownerPhone: '0900100091', petName: '阿福',
      reason: '初診健康檢查、想打疫苗', status: 'scheduled' }), createdAt: at(TODAY, '09:40') },
    // 上午診：取消／未到
    { key: 'pudding', doc: base('pudding', { ...slot(TODAY, '10:30'), reason: '指甲修剪、體重追蹤', status: 'cancelled',
      cancelReason: '飼主臨時有事，改約今晚' }), createdAt: at(day(-4), '14:00') },
    { key: 'colaNoShow', doc: base('cola', { ...slot(TODAY, '10:00'), reason: '皮膚紅疹複診', status: 'no_show' }), createdAt: at(day(-5), '16:30') },
    // 下午診：待報到
    { key: 'sesame', doc: base('sesame', { ...slot(TODAY, '14:00'), reason: '慢性腸胃炎複診', status: 'scheduled' }), createdAt: at(day(-14), '15:40') },
    { key: 'mimi', doc: base('mimi', { ...slot(TODAY, '14:30'), estimatedDurationMinutes: 60, reason: '牙結石、口臭',
      isSurgery: true, surgeryName: '洗牙＋拔牙評估', status: 'scheduled' }), createdAt: at(day(-6), '11:15') },
    { key: 'newB', doc: newPatient({ ...slot(TODAY, '15:15'), ownerName: '', ownerPhone: '0900100092', petName: '小白',
      reason: '剛撿到的幼貓，想做基本檢查', status: 'scheduled' }), createdAt: at(TODAY, '10:50') },
    { key: 'pidan', doc: base('pidan', { ...slot(TODAY, '16:00'), reason: '結紮諮詢、第二劑疫苗', status: 'scheduled' }), createdAt: at(YESTERDAY, '16:45') },
    { key: 'puddingEvening', doc: base('pudding', { ...slot(TODAY, '18:30'), reason: '改約：指甲修剪、體重追蹤', status: 'scheduled' }), createdAt: at(TODAY, '09:20') },
    // 明天
    { key: 'colaTomorrow', doc: base('cola', { ...slot(TOMORROW, '10:15'), reason: '皮膚紅疹複診（今天未到，重新預約）', status: 'scheduled' }), createdAt: at(TODAY, '11:20') },
    { key: 'brownsugarTomorrow', doc: base('brownsugar', { ...slot(TOMORROW, '14:00'), reason: '術後回診、看傷口', status: 'scheduled' }), createdAt: at(TODAY, '10:25') },
    { key: 'douhuaTomorrow', doc: base('douhua', { ...slot(TOMORROW, '17:00'), reason: '耳朵複診', status: 'scheduled' }), createdAt: at(TODAY, '11:15') },
  ];
  const appts = {};
  for (const { key, doc, createdAt } of appointmentDefs) {
    const updatedAt = doc.deskCompletedAt || doc.handoffAt || doc.visitStartedAt || doc.checkedInAt || createdAt;
    appts[key] = await insertRaw(Appointment, doc, createdAt, updatedAt);
  }

  // 奶茶的回診：櫃台已敲定 10/12 14:30
  const followUp = await insertRaw(Appointment, base('naicha', { ...slot(day(14), '14:30'), reason: '複查腎指數', status: 'scheduled' }), at(TODAY, '10:40'));
  await Appointment.collection.updateOne({ _id: appts.naicha._id }, { $set: { followUpAppointmentId: followUp._id } });

  // 已報到的都有健檢報告草稿，有看診內容的都有病歷日誌
  for (const key of ['naicha', 'mochi', 'orange', 'brownsugar', 'lucky', 'douhua']) {
    const appt = appts[key];
    const record = await MedicalRecord.create({
      petId: appt.petId,
      ...defaultRecordFields(template),
      visitDate: at(appt.date, appt.time),
      chiefComplaint: appt.reason,
      templateId: template._id,
      templateVersion: template.version,
      examType: template.name,
    });
    await Appointment.collection.updateOne({ _id: appt._id }, { $set: { recordId: record._id } });
    if (appt.visitNote || appt.weightKg != null || appt.labValues?.length) {
      await ClinicalNote.create({ petId: appt.petId, entryDate: at(appt.date, '10:00'), source: 'appointment', appointmentId: appt._id });
    }
  }

  // ── 藥單 ──
  const ACTOR = 'admin';
  const event = (action, time, from, to, fields, reason = '') => ({ action, actor: ACTOR, at: time, from, to, reason, ...fields });
  const orderDefs = [
    { pet: 'naicha', appt: 'naicha', status: 'collected', created: at(TODAY, '10:35'),
      fields: { condition: '年度健檢，腎指數臨界', prescription: '腎臟處方飼料 **Renal** 1.5 kg ×1\nAzodyl 1 顆 SID ×30 天', note: '' },
      steps: [['create', '10:35', '', 'review'], ['approve', '10:36', 'review', 'approved'], ['ready', '10:38', 'approved', 'ready'], ['collect', '10:41', 'ready', 'collected']] },
    { pet: 'mochi', appt: 'mochi', status: 'approved', created: at(TODAY, '10:52'),
      fields: { condition: '右耳外耳炎（酵母菌）', prescription: 'Surolan 耳滴 2 滴 BID ×7 天\n[blue]滴完按摩耳根 30 秒[/blue]', note: '' },
      steps: [['create', '10:52', '', 'review'], ['approve', '10:53', 'review', 'approved']] },
    { pet: 'orange', appt: 'orange', status: 'ready', created: at(TODAY, '11:36'),
      fields: { condition: '急性嘔吐、輕度脫水', prescription: 'Cerenia 1/4 顆 SID ×3 天\n**Famotidine** 1/4 顆 BID ×5 天\n[red]空腹給藥[/red]', note: '飼主說餵藥很困難，已示範投藥器用法' },
      steps: [['create', '11:36', '', 'review'], ['approve', '11:37', 'review', 'approved'], ['ready', '11:42', 'approved', 'ready']] },
    { pet: 'lucky', appt: null, status: 'review', created: at(TODAY, '11:20'),
      fields: { condition: '關節退化，飼主來電續領', prescription: 'Cosequin 1 顆 SID ×60 天', note: '飼主下午 5 點來拿' },
      steps: [['create', '11:20', '', 'review']] },
    { pet: 'mimi', appt: null, status: 'review', created: at(YESTERDAY, '17:10'),
      fields: { condition: '牙齦炎、口臭（明天洗牙前先用藥）', prescription: 'Meloxicam 0.05 mg/kg SID ×5 天\nClavamox 62.5 mg BID ×7 天', note: '' },
      steps: [['create', '17:10', '', 'review', YESTERDAY], ['approve', '17:15', 'review', 'approved', YESTERDAY],
        ['return', '09:40', 'approved', 'review', TODAY, '腎指數偏高，Meloxicam 請再確認要不要開']] },
    { pet: 'cola', appt: null, status: 'approved', needsRepack: true, created: at(YESTERDAY, '15:00'),
      fields: { condition: '皮膚紅疹、疑似細菌性皮膚炎', prescription: 'Doxycycline 25 mg SID ×10 天（[red]劑量已改[/red]）\n伊莉莎白頭套 ×1', note: '' },
      steps: [['create', '15:00', '', 'review', YESTERDAY], ['approve', '15:05', 'review', 'approved', YESTERDAY], ['ready', '15:20', 'approved', 'ready', YESTERDAY],
        ['edit', '09:15', 'ready', 'review', TODAY], ['approve', '09:20', 'review', 'approved', TODAY]] },
    { pet: 'douhua', appt: null, status: 'cancelled', created: at(TODAY, '11:12'),
      fields: { condition: '皮膚癢', prescription: '止癢噴劑 ×1', note: '' },
      steps: [['create', '11:12', '', 'review'], ['cancel', '11:18', 'review', 'cancelled', TODAY, '飼主決定等看診後再開']] },
    { pet: 'pidan', appt: null, status: 'collected', created: at(YESTERDAY, '16:00'),
      fields: { condition: '外寄生蟲預防', prescription: 'Revolution 貓用滴劑 ×1 支', note: '下個月同一天再點一次' },
      steps: [['create', '16:00', '', 'review', YESTERDAY], ['approve', '16:02', 'review', 'approved', YESTERDAY], ['ready', '16:10', 'approved', 'ready', YESTERDAY], ['collect', '16:40', 'ready', 'collected', YESTERDAY]] },
  ];
  for (const def of orderDefs) {
    const pet = pets[def.pet];
    const owner = Object.values(owners).find(o => String(o._id) === String(pet.ownerId));
    const history = def.steps.map(([action, time, from, to, date = TODAY, reason = '']) => event(action, at(date, time), from, to, def.fields, reason));
    const last = history.at(-1).at;
    const find = action => history.findLast(h => h.action === action)?.at ?? null;
    const approvedAt = ['approved', 'ready', 'collected'].includes(def.status) ? find('approve') : null;
    const packedAt = ['ready', 'collected'].includes(def.status) ? find('ready') : null;
    const order = await insertRaw(MedicationOrder, {
      petId: pet._id, ownerId: owner._id, appointmentId: def.appt ? appts[def.appt]._id : null,
      petName: pet.name, ownerName: owner.name, ownerPhone: owner.phone,
      ...def.fields, status: def.status, needsRepack: Boolean(def.needsRepack),
      approvedBy: approvedAt ? ACTOR : '', approvedAt,
      packedBy: packedAt ? ACTOR : '', packedAt,
      collectedAt: def.status === 'collected' ? find('collect') : null,
      history,
    }, def.created, last);
    // 日誌存在 ⇔ 曾經審核過且沒有取消
    if (def.status !== 'cancelled' && history.some(h => h.action === 'approve')) {
      await ClinicalNote.create({ petId: pet._id, entryDate: def.created, source: 'medication', medicationOrderId: order._id });
    }
  }

  // ── 待辦 ──
  const mention = key => ({ petId: pets[key]._id, petName: pets[key].name, ownerName: Object.values(owners).find(o => String(o._id) === String(pets[key].ownerId)).name });
  const todoDefs = [
    { content: '明天叫貨：**腎臟處方飼料** 3 包、Surolan 耳滴 2 瓶', createdBy: 'front_desk', dueDate: TOMORROW, created: at(TODAY, '10:45') },
    { content: '回電給 #咪咪 家長，提醒洗牙前禁食 8 小時', createdBy: 'front_desk', dueDate: TODAY, mentions: [mention('mimi')], created: at(TODAY, '09:10') },
    { content: '[red]疫苗冰箱溫度紀錄[/red]這週還沒填', createdBy: 'vet', dueDate: day(-2), created: at(day(-4), '18:00') },
    { content: '#小橘 血檢報告出來後打給飼主', createdBy: 'vet', dueDate: null, mentions: [mention('orange')], created: at(TODAY, '11:34') },
    { content: '整理手術室器械包，下午洗牙要用', createdBy: 'vet', dueDate: TODAY, created: at(TODAY, '08:55') },
    { content: '月底盤點針劑與耗材', createdBy: 'front_desk', dueDate: day(2), created: at(day(-3), '12:30') },
    { content: '補印號碼牌 1–20', createdBy: 'front_desk', dueDate: null, created: at(YESTERDAY, '19:00'), done: ['front_desk', at(TODAY, '09:30')] },
    { content: '寄出 #奶茶 的健檢報告', createdBy: 'vet', dueDate: TODAY, mentions: [mention('naicha')], created: at(TODAY, '10:32'), done: ['vet', at(TODAY, '11:00')] },
  ];
  for (const def of todoDefs) {
    const { created, done, ...doc } = def;
    await insertRaw(Todo, { ...doc, status: done ? 'done' : 'open', doneBy: done?.[0] ?? null, doneAt: done?.[1] ?? null }, created, done?.[1] ?? created);
  }

  console.log('建立示範資料', {
    owners: ownerDefs.length, pets: petDefs.length, appointments: appointmentDefs.length + 1,
    medications: orderDefs.length, todos: todoDefs.length,
  });
}

await mongoose.connect(process.env.MONGODB_URI);
try {
  await clean();
  if (!process.argv.includes('--clean')) await seed();
} finally {
  await mongoose.disconnect();
}
