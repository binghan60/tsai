// 同一次檢驗（diagnosticSetId＋儀器）IDEXX 可能送好幾次：Resend 是原封不動重送，
// Replace／Restore 是更正或撤銷更正，抓檔程式重試也會重複上傳。這裡決定收到的這份要怎麼處理：
//   create    第一次收到
//   duplicate 內容跟已存的一樣，只記「又收到一次」
//   update    內容不同，以新的為準（更正）
//   stale     內容不同但訊息比已存的舊——抓檔順序亂掉時，不能讓舊版蓋掉新版
export function planLabResultImport(existing, incoming) {
  if (!existing) return 'create';
  if (contentKey(existing) === contentKey(incoming)) return 'duplicate';
  const existingAt = existing.messageAt ? new Date(existing.messageAt).getTime() : null;
  const incomingAt = incoming.messageAt ? new Date(incoming.messageAt).getTime() : null;
  if (existingAt !== null && incomingAt !== null && incomingAt < existingAt) return 'stale';
  return 'update';
}

// parseIdexxResult 的輸出 → 寫進 LabResult 的欄位（不含原始檔與配對欄位）。
export function labResultContent(parsed) {
  return {
    diagnosticSetId: parsed.diagnosticSetId,
    instrument: parsed.instrument,
    subType: parsed.subType,
    messageId: parsed.messageId,
    messageAt: parsed.messageAt,
    requisitionNumber: parsed.requisitionNumber,
    runAt: parsed.runAt,
    client: parsed.client,
    patient: parsed.patient,
    doctor: parsed.doctor,
    assays: parsed.assays,
    notes: parsed.notes,
  };
}

// 比對「檢驗內容」是否相同：訊息編號與送出時間每次重送都會變，不算內容。
// 一邊是剛解析的物件、一邊是資料庫讀回來的文件，欄位順序與空值寫法可能不同，所以逐欄組成固定順序再比。
function contentKey(result) {
  const time = (value) => (value ? new Date(value).toISOString() : null);
  const str = (value) => value ?? '';
  const num = (value) => value ?? null;
  const { client = {}, patient = {}, doctor = {} } = result;
  return JSON.stringify([
    str(result.requisitionNumber),
    time(result.runAt),
    [str(client.id), str(client.firstName), str(client.lastName)],
    [
      str(patient.id),
      str(patient.name),
      str(patient.species),
      str(patient.gender),
      str(patient.breed),
      patient.birthDate ?? null,
      patient.weight ? [num(patient.weight.value), str(patient.weight.unit)] : null,
    ],
    [str(doctor.firstName), str(doctor.lastName)],
    (result.assays ?? []).map((assay) => [
      str(assay.code),
      str(assay.value),
      str(assay.unit),
      num(assay.referenceMin),
      num(assay.referenceMax),
      num(assay.criticalMin),
      num(assay.criticalMax),
      str(assay.qualifier),
    ]),
    (result.notes ?? []).map(str),
  ]);
}
