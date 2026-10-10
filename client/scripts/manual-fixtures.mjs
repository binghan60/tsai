// 使用手冊截圖用的假資料：一個虛構的門診日（下午 15:10）。所有姓名、電話、Email 都是編的，不連資料庫。
// 文件形狀一律用伺服器的 Mongoose model 建（只建在記憶體、不存檔），病歷日誌與檢驗比對用伺服器的純函式組，
// 畫面拿到的資料才會跟正式環境長得一樣。
import mongoose from '../../server/node_modules/mongoose/index.js';
import Appointment from '../../server/src/models/Appointment.js';
import ChatMessage from '../../server/src/models/ChatMessage.js';
import ClinicalNote from '../../server/src/models/ClinicalNote.js';
import FormTemplate from '../../server/src/models/FormTemplate.js';
import IntakeSubmission from '../../server/src/models/IntakeSubmission.js';
import LabResult from '../../server/src/models/LabResult.js';
import MedicalRecord from '../../server/src/models/MedicalRecord.js';
import MedicationOrder from '../../server/src/models/MedicationOrder.js';
import Owner from '../../server/src/models/Owner.js';
import Pet from '../../server/src/models/Pet.js';
import Todo from '../../server/src/models/Todo.js';
import { buildDefaultSections } from '../../server/src/config/formTemplateSeed.js';
import { appointmentJournalContent, appointmentJournalFields, appointmentJournalSections, mergeLabValues } from '../../server/src/lib/appointmentWorkflow.js';
import { medicationJournalContent, medicationJournalFields, medicationJournalSections, medicationJournalStage, medicationJournalTitle } from '../../server/src/lib/medicationWorkflow.js';
import { combineClinicDateTime, clinicToday } from '../../server/src/lib/clinicTime.js';
import { liveConflicts, rankCandidates } from '../../server/src/lib/labResultFill.js';
import { attendanceRow } from '../../server/src/lib/attendance.js';
import { sortOpenTodos } from '../../server/src/lib/todos.js';
import { templateLabItems } from '../../shared/labValues.js';
import { appointmentNotification } from '../src/lib/appointmentNotifications.js';

const plain = (value) => JSON.parse(JSON.stringify(value));
let serial = 0;
const oid = () => new mongoose.Types.ObjectId(`65f1a0000000000000${String(++serial).padStart(6, '0')}`);
const build = (Model, data) => plain(new Model(data).toJSON());

function shiftDate(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

export function buildFixtures(today = clinicToday()) {
  serial = 0;
  const at = (time, date = today) => combineClinicDateTime(date, time);
  const now = at('15:10');
  const yesterday = shiftDate(today, -1);
  const tomorrow = shiftDate(today, 1);

  // ── 健檢表單：種子結構，檢驗項目補上 IDEXX 代號、貓的參考範圍與單位 ──
  const LAB_SETUP = {
    glucose: { codes: ['GLU'], min: 74, max: 159, unit: 'mg/dL' },
    sdma: { codes: ['SDMA'], min: 0, max: 14, unit: 'μg/dL' },
    bun: { codes: ['BUN'], min: 16, max: 36, unit: 'mg/dL' },
    cre: { codes: ['CREA'], min: 0.8, max: 2.4, unit: 'mg/dL' },
    albumin: { codes: ['ALB'], min: 2.3, max: 3.9, unit: 'g/dL' },
    alt: { codes: ['ALT'], min: 12, max: 130, unit: 'U/L' },
    alp: { codes: ['ALKP'], min: 14, max: 111, unit: 'U/L' },
    rbc: { codes: ['RBC'], min: 6.54, max: 12.2, unit: 'M/μL' },
    wbc: { codes: ['WBC'], min: 2.87, max: 17.02, unit: 'K/μL' },
    platelets: { codes: ['PLT'], min: 151, max: 600, unit: 'K/μL' },
  };
  const sections = buildDefaultSections().map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const setup = LAB_SETUP[item.key];
      return setup ? { ...item, idexxCodes: setup.codes, referenceMin: setup.min, referenceMax: setup.max, unit: setup.unit } : item;
    }),
  }));
  const templateDoc = new FormTemplate({ _id: oid(), name: '例行健檢', species: 'all', enabled: true, order: 0, version: 3, sections, presets: [{ key: 'preset_vaccine', name: '預防針', order: 0, values: { chiefComplaint: '年度預防針' } }] });
  const template = templateDoc;
  const labItems = templateLabItems(plain(templateDoc.toJSON()));
  const templateId = String(templateDoc._id);

  // ── 飼主與貓咪 ──
  const owner = (name, phone, extra = {}) => build(Owner, { _id: oid(), name, phone, ...extra });
  const owners = {
    lin: owner('林雅婷', '0900111222', { email: 'lin.yating@example.com' }),
    chen: owner('陳志豪', '0900222333', { email: 'chenzh0612@example.com', notes: '只接受下午來電' }),
    huang: owner('黃美玲', '0900333444'),
    chang: owner('張家瑋', '0900444555'),
    wu: owner('吳佩珊', '0900555666', { email: 'wu.peishan@example.com' }),
    li: owner('李承恩', '0900666777'),
    wang: owner('王怡君', '0900777888'),
    chao: owner('趙子涵', '0900888999'),
    chou: owner('周冠廷', '0900999000'),
  };
  const pet = (name, ownerKey, extra = {}) => build(Pet, { _id: oid(), name, ownerId: owners[ownerKey]._id, species: '貓', ...extra });
  const pets = {
    bean: pet('豆豆', 'lin', { breed: 'British Shorthair', color: '藍灰', sex: 'male', neutered: 'yes', birthDate: new Date('2019-05-01'), weightKg: 4.6, allergyStatus: 'yes', allergyType: 'Penicillin 類抗生素', medicalHistory: ['慢性腎病'], vaccineStatus: 'done', vaccineDate: '2026 年 3 月', checkupStatus: 'done', checkupDate: '2025 年 10 月', notes: '抽血會咬人，請兩人保定' }),
    milk: pet('奶茶', 'chen', { breed: 'Ragdoll', sex: 'female', neutered: 'yes', birthDate: new Date('2021-02-10'), weightKg: 4.1, allergyStatus: 'none', vaccineStatus: 'done', vaccineDate: '2026 年 1 月' }),
    mimi: pet('咪咪', 'huang', { breed: 'Mixed', sex: 'female', neutered: 'yes', birthDate: new Date('2016-08-01'), weightKg: 3.8, medicalHistory: ['甲狀腺亢進'] }),
    orange: pet('小橘', 'chang', { breed: 'Mixed', color: '橘白', sex: 'male', neutered: 'yes', birthDate: new Date('2020-11-01'), weightKg: 5.9 }),
    tiger: pet('阿虎', 'wu', { breed: 'American Shorthair', sex: 'male', neutered: 'yes', birthDate: new Date('2018-03-01'), weightKg: 5.2 }),
    lucky: pet('招財', 'li', { breed: 'Scottish Fold', sex: 'female', neutered: 'no', birthDate: new Date('2025-04-01'), weightKg: 3.0 }),
    sugar: pet('黑糖', 'wang', { breed: 'Mixed', sex: 'male', neutered: 'yes', birthDate: new Date('2015-06-01'), weightKg: 4.9, medicalHistory: ['慢性腎病'] }),
    snow: pet('雪球', 'chao', { breed: 'Persian', sex: 'female', neutered: 'yes', birthDate: new Date('2017-01-01'), weightKg: 3.6 }),
    fat: pet('胖虎', 'chou', { breed: 'Exotic Shorthair', sex: 'male', neutered: 'yes', birthDate: new Date('2019-09-01'), weightKg: 6.4 }),
    coco: pet('可可', 'huang', { breed: 'Mixed', sex: 'female', neutered: 'yes', birthDate: new Date('2022-05-01'), weightKg: 3.4 }),
  };
  const ownerOf = (p) => Object.values(owners).find((o) => String(o._id) === String(p.ownerId));
  const petWithOwner = (p) => ({ ...p, ownerId: ownerOf(p) });

  // ── 掛號（今天）──
  const recordIds = { bean: oid(), milk: oid() };
  const medIds = { milk: oid(), tiger: oid(), snow: oid(), beanPrev: oid(), sugar: oid() };
  const todoIds = { tiger: oid() };
  const appt = (p, time, extra = {}) => {
    const date = extra.date ?? today;
    return {
      _id: oid(), date, time, scheduledAt: at(time, date), estimatedDurationMinutes: 15, petId: p?._id ?? null, ownerId: p ? p.ownerId : null,
      petName: p?.name ?? '', ownerName: p ? ownerOf(p).name : '', ownerPhone: p ? ownerOf(p).phone : '', species: '貓',
      visitType: p ? 'return' : 'new', templateId, createdAt: at('09:00', date), ...extra,
    };
  };
  const raw = {
    snow: appt(pets.snow, '10:30', { reason: '皮膚癢回診', status: 'completed', checkinNumber: null, checkinNumberHistory: [1], checkedInAt: at('10:26'), visitStartedAt: at('10:31'), handoffAt: at('10:50'), deskCompletedAt: at('10:58'), visitNote: '背部脫毛範圍縮小，皮膚紅疹改善。', weightKg: 3.6, temperatureC: 38.5, reopenRequest: { reason: '回診建議漏寫：兩週後複診', requestedAt: at('14:50'), approvedAt: null } }),
    fat: appt(pets.fat, '11:00', { reason: '預防針', status: 'no_show' }),
    coco: appt(pets.coco, '11:15', { reason: '洗牙評估', status: 'cancelled', cancelReason: '飼主臨時有事，改天再約', cancelledAt: at('09:40') }),
    tiger: appt(pets.tiger, '14:00', { reason: '耳朵癢回診', status: 'completed', checkinNumberHistory: [2], checkedInAt: at('13:56'), visitStartedAt: at('14:01'), handoffAt: at('14:20'), deskCompletedAt: at('14:26'), weightKg: 5.2, temperatureC: 38.4, visitNote: '耳道清潔後紅腫改善，仍有少量耳垢。', prescription: 'Surolan 滴耳液：早晚各 2 滴，連續 7 天', medicationOrderId: medIds.tiger, imageUpload: true, imageUploadTodoId: todoIds.tiger, followUpRecommendation: '兩週後回診', followUpDate: shiftDate(today, 14), followUpTime: '14:30' }),
    milk: appt(pets.milk, '14:15', { reason: '嘔吐兩天', status: 'pending_checkout', checkinNumber: 3, checkinNumberHistory: [3], checkedInAt: at('14:12'), visitStartedAt: at('14:22'), handoffAt: at('14:58'), weightKg: 4.1, temperatureC: 38.9, recordId: recordIds.milk, visitNote: '**精神、食慾稍差**，腹部觸診無明顯疼痛。\n[orange]請飼主觀察排便狀況[/orange]', prescription: 'Cerenia 止吐錠 1/4 顆，每日一次，共 3 天\n腸胃處方罐頭 i/d 一週', medicationOrderId: medIds.milk, specialCareNote: '止吐藥空腹給，給藥後 1 小時再餵食', followUpRecommendation: '3 天後回診複查；若持續嘔吐請提早回來', internalNote: '飼主問能不能磨粉，已說可以' }),
    bean: appt(pets.bean, '14:30', { reason: '年度健檢＋腎指數追蹤', estimatedDurationMinutes: 30, status: 'arrived', checkinNumber: 4, checkinNumberHistory: [4], checkedInAt: at('14:27'), visitStartedAt: at('14:35'), labRequestedAt: at('14:37'), labDeliveredAt: at('14:38'), weightKg: 4.6, temperatureC: 38.6, recordId: recordIds.bean, visitNote: '飲水量增加約兩週，尿量也變多。\n[red]**SDMA 偏高**[/red]，CREA 2.1 比上次上升。', prescription: '腎臟處方飼料 k/d（繼續）\nAzodyl 每日 1 顆', internalNote: '抽血兩人保定，左前腳', specialCareNote: '回家多放幾個水碗，記錄每天喝水量', followUpRecommendation: '兩週後回診複驗腎指數' }),
    mimi: appt(pets.mimi, '14:45', { reason: '甲狀腺藥物調整', status: 'arrived', checkinNumber: 5, checkinNumberHistory: [5], checkedInAt: at('14:55') }),
    orange: appt(pets.orange, '14:45', { reason: '體重控制回診', status: 'scheduled' }),
    lucky: appt(pets.lucky, '15:30', { reason: '術前評估', status: 'scheduled', isSurgery: true, surgeryName: '結紮手術', estimatedDurationMinutes: 60 }),
    pudding: appt(null, '16:00', { petName: '布丁', ownerName: '許家瑜', ownerPhone: '0900123123', reason: '初診：打噴嚏', status: 'scheduled', intakeVerificationCode: '4821', intakeVerificationExpiresAt: at('16:00', tomorrow), intakeVerificationUsedAt: at('13:30') }),
    sugar: appt(pets.sugar, '16:30', { reason: '慢性腎病回診拿藥', status: 'scheduled', depositStatus: 'collected', depositDecidedAt: at('10:00', shiftDate(today, -6)) }),
  };
  // 豆豆這次看診的檢驗數值：IDEXX 填進來的，加上醫師先手打的 SDMA（跟 IDEXX 不同，留給比對視窗）。
  raw.bean.labValues = mergeLabValues([], { glucose: '118', cre: '2.1', bun: '32', sdma: '15', alt: '52', alp: '28', albumin: '3.2', rbc: '8.9', wbc: '9.6', platelets: '310' }, labItems);
  raw.milk.labValues = [];

  // ── 過去的看診（出席紀錄、歷次病歷日誌用）──
  const history = [
    appt(pets.orange, '10:15', { date: shiftDate(today, -58), reason: '預防針', status: 'completed', checkedInAt: at('10:27', shiftDate(today, -58)), latenessMinutes: 12, deskCompletedAt: at('10:50', shiftDate(today, -58)) }),
    appt(pets.orange, '15:00', { date: shiftDate(today, -21), reason: '體重控制', status: 'completed', checkedInAt: at('15:18', shiftDate(today, -21)), latenessMinutes: 18, deskCompletedAt: at('15:45', shiftDate(today, -21)) }),
    appt(pets.orange, '11:00', { date: shiftDate(today, -9), reason: '體重控制', status: 'cancelled', cancelReason: '下雨不方便出門', cancelledAt: at('09:12', shiftDate(today, -9)) }),
    appt(pets.bean, '15:00', { date: shiftDate(today, -84), reason: '腎指數追蹤', status: 'completed', checkedInAt: at('14:52', shiftDate(today, -84)), visitStartedAt: at('15:02', shiftDate(today, -84)), handoffAt: at('15:20', shiftDate(today, -84)), deskCompletedAt: at('15:28', shiftDate(today, -84)), weightKg: 4.8, temperatureC: 38.4, visitNote: 'CREA 1.9 略高，建議改腎臟處方飼料，三個月後追蹤。', specialCareNote: '多放幾個水碗，鼓勵喝水', followUpRecommendation: '三個月後追蹤腎指數' }),
  ];
  const appointments = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, build(Appointment, value)]));
  const historyDocs = history.map((value) => build(Appointment, value));

  // ── IDEXX 檢驗結果 ──
  const assay = (code, value, unit, referenceMin, referenceMax) => ({ code, value, unit, referenceMin, referenceMax, criticalMin: null, criticalMax: null, qualifier: '=' });
  const catalyst = build(LabResult, {
    _id: oid(), messageId: 'demo-1', diagnosticSetId: 'DEMO_CHEM_1', instrument: 'Catalyst_One', runAt: at('14:52'),
    client: { id: '', firstName: '雅婷', lastName: '林' }, patient: { id: String(pets.bean._id), name: '豆豆', species: 'FELINE' },
    assays: [assay('GLU', '118', 'mg/dL', 74, 159), assay('CREA', '2.1', 'mg/dL', 0.8, 2.4), assay('BUN', '32', 'mg/dL', 16, 36), assay('SDMA', '16', 'μg/dL', 0, 14), assay('ALT', '52', 'U/L', 12, 130), assay('ALKP', '28', 'U/L', 14, 111), assay('TP', '7.9', 'g/dL', 5.7, 8.9), assay('ALB', '3.2', 'g/dL', 2.3, 3.9), assay('GLOB', '4.7', 'g/dL', 2.8, 5.1), assay('PHOS', '5.9', 'mg/dL', 3.1, 7.5)],
    notes: [], petId: pets.bean._id, matchedAt: at('14:53'), matchSource: 'patient_id', appointmentId: appointments.bean._id, appliedAt: at('14:53'),
    filled: [{ key: 'glucose', label: '血糖（GLU）', value: '118' }, { key: 'cre', label: '腎臟功能（CRE）', value: '2.1' }, { key: 'bun', label: '腎臟功能（BUN）', value: '32' }, { key: 'alt', label: '肝臟酵素（ALT）', value: '52' }, { key: 'alp', label: '膽囊（ALP）', value: '28' }, { key: 'albumin', label: '肝臟功能（ALB）', value: '3.2' }],
    conflicts: [{ key: 'sdma', label: '腎臟功能（SDMA）', current: '15', idexx: '16' }], conflictsOpen: true, unmappedCodes: ['TP', 'GLOB', 'PHOS'], createdAt: at('14:53'),
  });
  const procyte = build(LabResult, {
    _id: oid(), messageId: 'demo-2', diagnosticSetId: 'DEMO_CBC_1', instrument: 'ProCyte_Dx', runAt: at('14:55'),
    client: { id: '', firstName: '雅婷', lastName: '林' }, patient: { id: String(pets.bean._id), name: '豆豆', species: 'FELINE' },
    assays: [assay('RBC', '8.9', 'M/μL', 6.54, 12.2), assay('HCT', '38.2', '%', 30.3, 52.3), assay('HGB', '12.1', 'g/dL', 9.8, 16.2), assay('WBC', '9.6', 'K/μL', 2.87, 17.02), assay('NEU', '6.8', 'K/μL', 2.3, 10.29), assay('LYM', '2.1', 'K/μL', 0.92, 6.88), assay('PLT', '310', 'K/μL', 151, 600)],
    notes: [], petId: pets.bean._id, matchedAt: at('14:56'), matchSource: 'patient_id', appointmentId: appointments.bean._id, appliedAt: at('14:56'),
    filled: [{ key: 'rbc', label: '紅血球', value: '8.9' }, { key: 'wbc', label: '白血球', value: '9.6' }, { key: 'platelets', label: '血小板', value: '310' }],
    conflicts: [], conflictsOpen: false, unmappedCodes: ['HCT', 'HGB', 'NEU', 'LYM'], createdAt: at('14:56'),
  });
  // 技術員在 IDEXX 主機上手打名字驗的：認不出是哪隻貓，進待確認清單。
  const unmatched = build(LabResult, {
    _id: oid(), messageId: 'demo-3', diagnosticSetId: 'DEMO_SNAP_1', instrument: 'SNAP_Pro', runAt: at('15:04'),
    client: { id: '', firstName: '', lastName: '黃' }, patient: { id: '', name: '咪咪', species: 'FELINE' },
    assays: [{ ...assay('FIV', 'Negative', '', null, null) }, { ...assay('FeLV', 'Negative', '', null, null) }],
    notes: [], petId: null, appointmentId: null, createdAt: at('15:05'),
  });
  const labResults = [catalyst, procyte, unmatched];

  // ── 藥單 ──
  const event = (action, actor, atTime, from, to, content = {}) => ({ action, actor, at: atTime, from, to, reason: '', ...content });
  const med = (id, p, data) => build(MedicationOrder, { _id: id, petId: p._id, ownerId: p.ownerId, petName: p.name, ownerName: ownerOf(p).name, ownerPhone: ownerOf(p).phone, ...data });
  const medications = [
    med(medIds.snow, pets.snow, { condition: '飼主來電：皮膚癢又復發，想先拿上次的藥', prescription: 'Apoquel 3.6 mg：每日一次，連續 7 天', note: '飼主下午 5 點來拿', status: 'review', createdAt: at('13:20'), history: [event('create', '櫃台', at('13:20'), '', 'review')] }),
    med(medIds.milk, pets.milk, { appointmentId: appointments.milk._id, fromVisit: true, prescription: appointments.milk.prescription, status: 'approved', approvedBy: '醫師', approvedAt: at('14:58'), createdAt: at('14:58'), history: [event('create', '醫師', at('14:58'), '', 'review'), event('approve', '醫師', at('14:58'), 'review', 'approved')] }),
    med(medIds.tiger, pets.tiger, { appointmentId: appointments.tiger._id, fromVisit: true, prescription: appointments.tiger.prescription, status: 'ready', approvedBy: '醫師', approvedAt: at('14:20'), packedBy: '櫃台', packedAt: at('14:24'), createdAt: at('14:20'), history: [event('create', '醫師', at('14:20'), '', 'review'), event('approve', '醫師', at('14:20'), 'review', 'approved'), event('ready', '櫃台', at('14:24'), 'approved', 'ready')] }),
    med(medIds.sugar, pets.sugar, { condition: '慢性腎病長期用藥', prescription: 'Azodyl 每日 1 顆\n腎臟處方飼料 k/d 2 包', status: 'collected', approvedBy: '醫師', approvedAt: at('11:00', yesterday), packedAt: at('11:20', yesterday), collectedAt: at('16:40', yesterday), createdAt: at('10:40', yesterday) }),
    med(medIds.beanPrev, pets.bean, { condition: '腎指數偏高追蹤', prescription: '腎臟處方飼料 k/d\nAzodyl 每日 1 顆', status: 'collected', approvedBy: '醫師', approvedAt: at('15:20', shiftDate(today, -84)), collectedAt: at('15:40', shiftDate(today, -84)), createdAt: at('15:10', shiftDate(today, -84)), history: [event('create', '櫃台', at('15:10', shiftDate(today, -84)), '', 'review'), event('approve', '醫師', at('15:20', shiftDate(today, -84)), 'review', 'approved')] }),
  ];

  // ── 病歷日誌（伺服器讀取時組出來的樣子）──
  const labsFor = (appointment) => labResults.filter((result) => String(result.appointmentId) === String(appointment._id));
  const visitNote = (appointment, entryDate) => {
    const note = build(ClinicalNote, { _id: oid(), petId: appointment.petId, entryDate, content: '', source: 'appointment', appointmentId: appointment._id });
    const labs = labsFor(appointment);
    return { ...note, content: appointmentJournalContent(appointment, labs), sections: appointmentJournalSections(appointment, labs), fields: appointmentJournalFields(appointment), editableContent: appointment.visitNote, readOnly: false };
  };
  const medicationNote = (order) => {
    const note = build(ClinicalNote, { _id: oid(), petId: order.petId, entryDate: order.createdAt, content: '', source: 'medication', medicationOrderId: order._id });
    return { ...note, content: medicationJournalContent(order), title: medicationJournalTitle(order), stage: medicationJournalStage(order), sections: medicationJournalSections(order), fields: medicationJournalFields(order), medicationStatus: order.status, editableContent: '', readOnly: true };
  };
  const manualNote = (p, entryDate, content, source = 'manual') => build(ClinicalNote, { _id: oid(), petId: p._id, entryDate, content, source });
  const beanPrevVisit = historyDocs[3];
  const clinicalNotes = [
    visitNote(appointments.bean, appointments.bean.visitStartedAt),
    visitNote(appointments.milk, appointments.milk.visitStartedAt),
    visitNote(appointments.tiger, appointments.tiger.visitStartedAt),
    visitNote(appointments.snow, appointments.snow.visitStartedAt),
    manualNote(pets.bean, at('16:10', shiftDate(today, -40)), '飼主來電：最近喝水變多，已提醒下次回診一起驗血。'),
    medicationNote(medications.find((order) => String(order._id) === String(medIds.beanPrev))),
    visitNote(beanPrevVisit, beanPrevVisit.visitStartedAt),
    manualNote(pets.bean, at('09:00', '2024-03-15'), '2019/06 初診，疫苗三劑完成。\n2021/11 牙結石，洗牙。\n2023/04 腎指數 CREA 1.6，追蹤。', 'legacy_import'),
  ].map((note) => ({ ...note, entryDate: note.entryDate }));
  // 阿虎的上傳影像待辦還沒完成：日誌上顯示「是」。

  // ── 健檢報告草稿（豆豆，連著這次看診）──
  const records = {
    bean: build(MedicalRecord, { _id: recordIds.bean, petId: pets.bean._id, templateId, templateVersion: 3, examType: '例行健檢', vet: '張醫師', visitDate: at('00:00'), status: 'draft', chiefComplaint: '年度健檢；飲水量增加約兩週', createdAt: at('14:27'), updatedAt: at('14:58') }),
    milk: build(MedicalRecord, { _id: recordIds.milk, petId: pets.milk._id, templateId, templateVersion: 3, examType: '例行健檢', vet: '張醫師', visitDate: at('00:00'), status: 'draft', createdAt: at('14:12'), updatedAt: at('14:12') }),
  };

  // ── 待辦 ──
  const todo = (data) => build(Todo, { _id: data._id ?? oid(), ...data });
  const todos = [
    todo({ _id: todoIds.tiger, content: '上傳影像 #阿虎', createdBy: 'front_desk', mentions: [{ petId: pets.tiger._id, petName: '阿虎', ownerName: '吳佩珊' }], createdAt: at('14:26') }),
    todo({ content: '叫貨：**腎臟處方飼料 k/d** 3 包', createdBy: 'front_desk', starred: true, dueDate: tomorrow, createdAt: at('11:30') }),
    todo({ content: '回電給 #雪球 的飼主確認回診時間', createdBy: 'vet', mentions: [{ petId: pets.snow._id, petName: '雪球', ownerName: '趙子涵' }], dueDate: today, createdAt: at('11:05') }),
    todo({ content: '[green]更換診間消毒液[/green]', createdBy: 'front_desk', status: 'done', doneAt: at('18:40', yesterday), doneBy: 'front_desk', createdAt: at('09:10', yesterday) }),
  ];
  const openTodos = sortOpenTodos(todos.filter((item) => item.status === 'open'));
  const doneTodos = todos.filter((item) => item.status === 'done');

  // ── 聊天 ──
  const chat = (sender, content, createdAt, extra = {}) => build(ChatMessage, { _id: oid(), sender, content, createdAt, ...extra });
  const note = (action, appointment) => appointmentNotification(appointment, action);
  const chatMessages = [
    chat('front_desk', note('check_in', appointments.tiger), at('13:56'), { auto: true }),
    chat('vet', note('handoff', appointments.tiger), at('14:20'), { auto: true }),
    chat('front_desk', note('desk_complete', appointments.tiger), at('14:26'), { auto: true }),
    chat('front_desk', note('check_in', appointments.bean), at('14:27'), { auto: true }),
    chat('vet', '#豆豆 腎指數要跟上次比，櫃台幫我調一下七月的紀錄', at('14:41'), { mentions: [{ petId: pets.bean._id, petName: '豆豆', ownerName: '林雅婷' }] }),
    chat('front_desk', '好，已經在暫存區了', at('14:42')),
    chat('front_desk', note('check_in', appointments.mimi), at('14:55'), { auto: true }),
    chat('vet', note('handoff', appointments.milk), at('14:58'), { auto: true }),
    chat('front_desk', '奶茶的飼主問止吐藥可不可以磨粉', at('15:02')),
  ];
  const pinnedPets = [{ _id: oid(), petId: pets.bean._id, pinnedBy: 'vet', source: 'mention', pinnedAt: at('14:41'), pet: { name: '豆豆', species: '貓', breed: pets.bean.breed, owner: { name: owners.lin.name, phone: owners.lin.phone } } }];

  // ── 初診表 ──
  const intakeSubmission = build(IntakeSubmission, {
    _id: oid(), owner: { name: '許家瑜', phone: '0900123123', email: 'hsu.jiayu@example.com', address: '台北市大安區（範例地址）' },
    pet: { name: '布丁', breed: 'Mixed', color: '奶油色', sex: 'female', neutered: 'no', birthDate: new Date('2025-06-01'), birthDateEstimated: true, householdCatCount: 2, foods: ['乾飼料', '罐頭'], feedingType: 'scheduled', mealsPerDay: 2, vaccineStatus: 'done', vaccineDate: '2026 年 8 月', medicalHistory: ['無'], allergyStatus: 'none', checkupStatus: 'none' },
    linkedAppointmentId: appointments.pudding._id, createdAt: at('13:30'),
  });
  appointments.pudding.intakeSubmissionId = intakeSubmission._id;
  const intakeCodeAppointment = build(Appointment, appt(null, '10:30', { date: tomorrow, petName: '小花', ownerName: '蔡宜蓁', ownerPhone: '0900321321', reason: '初診：結紮諮詢', status: 'scheduled', intakeVerificationCode: '3907', intakeVerificationExpiresAt: at('10:30', shiftDate(today, 2)) }));

  // ── 寄送歷程 ──
  const delivery = (p, recipient, eventName, startedAt, completedAt, extra = {}) => ({ _id: oid(), recordId: oid(), petName: p.name, ownerName: ownerOf(p).name, attemptId: String(oid()), event: eventName, recipient, error: '', startedAt, completedAt, latestAt: completedAt ?? startedAt, createdAt: completedAt ?? startedAt, recordExists: true, ...extra });
  const deliveryLogs = [
    delivery(pets.milk, 'chenzh0612@example.com', 'failed', at('11:02'), at('11:05'), { error: '退信：收件地址不存在' }),
    delivery(pets.tiger, 'wu.peishan@example.com', 'sent', at('10:40'), at('10:40')),
    delivery(pets.bean, 'lin.yating@example.com', 'sent', at('16:20', shiftDate(today, -84)), at('16:20', shiftDate(today, -84))),
    delivery(pets.snow, 'chao.zihan@example.com', 'uncertain', at('17:30', shiftDate(today, -3)), at('17:31', shiftDate(today, -3)), { error: '郵件伺服器沒有回應，無法確定是否已寄出' }),
  ];

  // ── 出席紀錄（只算這隻貓）──
  const allAppointments = [...Object.values(appointments), ...historyDocs];
  function attendanceFor(petId) {
    const mine = allAppointments.filter((item) => String(item.petId) === String(petId));
    const late = mine.filter((item) => ['arrived', 'pending_checkout', 'completed'].includes(item.status) && item.latenessMinutes > 0);
    const noShow = mine.filter((item) => item.status === 'no_show');
    const counts = {
      lateCount: late.length, lastLateDate: late.map((item) => item.date).sort().at(-1) ?? null,
      noShowCount: noShow.length, lastNoShowDate: noShow.map((item) => item.date).sort().at(-1) ?? null,
    };
    const rows = mine
      .filter((item) => item.status === 'no_show' || item.status === 'cancelled' || item.depositStatus || late.includes(item))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(attendanceRow);
    const required = counts.lateCount >= 2 || counts.noShowCount >= 1;
    return { items: rows, total: rows.length, page: 1, limit: 10, totalPages: 1, scope: 'pet', counts: { pet: counts, owner: counts }, deposit: { required, amount: 200, lateCount: counts.lateCount, noShowCount: counts.noShowCount, since: null, held: null } };
  }

  // ── 檢驗比對（伺服器即時重算過的樣子）──
  function conflictGroups(appointmentId = null) {
    return labResults
      .filter((result) => result.conflictsOpen && (!appointmentId || String(result.appointmentId) === String(appointmentId)))
      .map((result) => {
        const visit = allAppointments.find((item) => String(item._id) === String(result.appointmentId));
        return { id: result._id, instrument: result.instrument, runAt: result.runAt, petId: result.petId, petName: visit.petName, appointmentId: result.appointmentId, visitDate: visit.date, items: liveConflicts(result.conflicts, visit.labValues) };
      })
      .filter((group) => group.items.length);
  }
  function pendingLabResults() {
    return labResults
      .filter((result) => !result.petId && !result.dismissedAt)
      .map((result) => ({ ...result, candidates: rankCandidates(Object.values(appointments), result.patient?.name) }));
  }

  return {
    today, now, templateDoc: template, templateId, labItems, owners, pets, ownerOf, petWithOwner,
    appointments, historyDocs, allAppointments, labResults, medications, clinicalNotes, records, todos: [...openTodos, ...doneTodos],
    chatMessages, pinnedPets, intakeSubmission, intakeCodeAppointment, deliveryLogs, attendanceFor, conflictGroups, pendingLabResults,
  };
}
