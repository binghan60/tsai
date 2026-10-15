import Appointment from '../models/Appointment.js';
import MedicalRecord from '../models/MedicalRecord.js';
import HospitalizationDay from '../models/HospitalizationDay.js';
import { clinicToday } from './clinicTime.js';

// 貓咪的「最近體重」不另存，每次讀取時從量測紀錄挑日期最新的那一筆：
//   · 看診（報到之後的；待報到的可能是取消報到後留下的舊值，不算）的 weightKg；
//   · 已結案、沒被修訂取代的健檢報告上的體重（系統改版前的獨立報告只有這裡有）；
//   · 住院每天量的體重（hospitalizationDays）。
// 同一天住院體重優先（入院當天的看診是入院前量的），再來是看診，報告最後（報告只是結案那一刻的快照）。
// 都沒有量測紀錄時才用貓咪資料上手填的 weightKg（初診表、新增貓咪時填的），沒有日期。

const MEASURED_STATUSES = ['arrived', 'pending_checkout', 'completed'];

function validWeight(value) {
  if (value === null || value === undefined || value === '') return null;
  const kg = Number(value);
  return Number.isFinite(kg) && kg > 0 ? kg : null;
}

// 報告上的體重：結案時凍結的 sections 裡帶 role: 'weight' 的那一項（不寫死欄位，範本可以把體重收進 customValues），
// 沒有才看具名欄位。
export function recordWeight(record) {
  const item = (record?.sections ?? []).flatMap((section) => section.items ?? []).find((entry) => entry.role === 'weight');
  return validWeight(item?.value) ?? validWeight(record?.weightKg);
}

function timeOf(visit) {
  const at = visit.visitStartedAt ?? visit.checkedInAt ?? visit.scheduledAt;
  return at ? new Date(at).getTime() : 0;
}

// visits、records 是這隻貓的看診與已結案報告（不必先排序）；回 { kg, date } 或 null，date 是 YYYY-MM-DD，手填的值是 ''。
export function pickLatestWeight({ visits = [], records = [], days = [], fallbackKg = null } = {}) {
  const candidates = [];
  for (const day of days) {
    const kg = validWeight(day.weightKg);
    if (kg !== null && day.date) candidates.push({ kg, date: day.date, priority: 2, time: 0 });
  }
  for (const visit of visits) {
    if (!MEASURED_STATUSES.includes(visit.status)) continue;
    const kg = validWeight(visit.weightKg);
    if (kg !== null && visit.date) candidates.push({ kg, date: visit.date, priority: 1, time: timeOf(visit) });
  }
  for (const record of records) {
    if (record.status !== 'finalized' || record.supersededBy || !record.visitDate) continue;
    const kg = recordWeight(record);
    if (kg !== null) candidates.push({ kg, date: clinicToday(new Date(record.visitDate)), priority: 0, time: 0 });
  }
  candidates.sort((a, b) => b.date.localeCompare(a.date) || b.priority - a.priority || b.time - a.time);
  if (candidates.length) return { kg: candidates[0].kg, date: candidates[0].date };
  const fallback = validWeight(fallbackKg);
  return fallback === null ? null : { kg: fallback, date: '' };
}

// excludeAppointmentId：診療台開著這次看診時不算它自己——標頭有填顯示「本次」，沒填顯示上一次量的，
// 不會把這次清掉的值又當成最近體重顯示回來。
export async function latestPetWeight(pet, { excludeAppointmentId = null } = {}) {
  const visitFilter = { petId: pet._id, status: { $in: MEASURED_STATUSES }, weightKg: { $ne: null } };
  if (excludeAppointmentId) visitFilter._id = { $ne: excludeAppointmentId };
  const [visits, records, days] = await Promise.all([
    Appointment.find(visitFilter)
      .sort({ date: -1 })
      .limit(5)
      .select('date status weightKg visitStartedAt checkedInAt scheduledAt')
      .lean(),
    MedicalRecord.find({ petId: pet._id, status: 'finalized', supersededBy: null })
      .sort({ visitDate: -1 })
      .limit(10)
      .select('status supersededBy visitDate weightKg sections')
      .lean(),
    HospitalizationDay.find({ petId: pet._id, weightKg: { $ne: null } }).sort({ date: -1 }).limit(3).select('date weightKg').lean(),
  ]);
  return pickLatestWeight({ visits, records, days, fallbackKg: pet.weightKg });
}
