// 病歷日誌的呈現與編輯規則。
// 掛號與藥單日誌由後端依來源欄位回傳分欄的 sections／fields（見 server/src/lib/clinicalNoteView.js），
// 這裡把它們排成報告式的「標籤｜內容」列，以及編輯表單的初始值與送出格式。
// 手動與舊系統匯入的日誌是自由文字，沒有 sections，整段顯示、整段編輯。
import { richTextLength, richTextToPlain } from '../../../shared/richText.js'
import { deskItemLabel, sortDeskItems } from '../../../shared/deskItems.js'

export function journalKind(note) {
  if (note?.appointmentId) return 'appointment'
  if (note?.medicationOrderId) return 'medication'
  if (note?.source === 'legacy_import') return 'legacy'
  return 'manual'
}

const KIND_LABELS = { appointment: '看診紀錄', medication: '領藥紀錄', legacy: '舊系統匯入', manual: '記事' }

export function journalKindLabel(note) {
  return KIND_LABELS[journalKind(note)]
}

const VITAL_KEYS = ['weightKg', 'temperatureC']
// 請轉告飼主是最容易漏講的一件事，櫃台端用警示樣式，日誌裡也一樣。
const WARNING_KEYS = new Set(['specialCareNote'])
const EMPHASIS_KEYS = new Set(['reason', 'prescription'])
// 可以上色、加粗的欄位（shared/richText.js）：卡片用 RichText 顯示、編輯用 RichTextEditor。
export const RICH_TEXT_KEYS = new Set(['visitNote', 'condition', 'prescription', 'note'])

const DESK_KEYS = ['imageUpload', 'deskItems']

// 櫃台處理那一列：items＝勾了哪些處理事項（key 陣列，由後端結構化的 groups 還原）、imageUpload＝上傳影像有沒有勾、
// uploadNote＝待辦完成後的「已完成　10/9 14:32」。什麼都沒勾（含「勾過又取消」的上傳影像）就不畫這一列。
function deskRow(sections) {
  const groups = sections.find((section) => section.key === 'deskItems')?.groups ?? []
  const items = sortDeskItems(groups.flatMap((group) => (group.items ?? []).map((item) => item.key)))
  const upload = sections.find((section) => section.key === 'imageUpload')
  const imageUpload = Boolean(upload) && String(upload.text).trim() !== '否'
  if (!items.length && !imageUpload) return null
  const done = imageUpload && String(upload.text).startsWith('已完成') ? String(upload.text) : ''
  return { key: 'deskItems', label: '櫃台處理', text: '', tone: 'default', emphasis: false, rich: false, desk: { items, imageUpload, uploadNote: done } }
}

// 檢視模式的櫃台處理列只列有勾的項目，一項一顆小標（全部選項的勾選框只在修改模式出現——
// 每筆日誌十二個勾選框、只勾一項也佔三列，比體重、紀錄、藥單還醒目，唯讀的勾選框也看起來點得動）。
// 「上傳影像」排第一（它在影像那一組的最前面），待辦完成了才打勾、帶完成時間；「不寄就診紀錄」用琥珀色，
// 跟報告清單、填寫頁上的同一件事同一個顏色。回傳 [{ key, label, done, time, tone }]。
export function deskChips(desk) {
  if (!desk) return []
  const chips = []
  if (desk.imageUpload) {
    const time = String(desk.uploadNote ?? '').replace(/^已完成\s*/, '')
    chips.push({ key: 'image_upload', label: '上傳影像', done: Boolean(desk.uploadNote), time: desk.uploadNote ? time : '', tone: 'default' })
  }
  for (const key of sortDeskItems(desk.items)) {
    chips.push(key === 'no_visit_record'
      ? { key, label: '不寄就診紀錄', done: false, time: '', tone: 'warning' }
      : { key, label: deskItemLabel(key), done: false, time: '', tone: 'default' })
  }
  return chips
}

// 報告的每一列：{ key, label, text, tone, emphasis, rich }；量測併成一列「生命徵象」，用 items 各自呈現。
// 檢驗兩列帶結構、不是一段文字：labs＝報告上的檢驗數值（一項一格），results＝IDEXX 原始結果（排成表格）。
// 沒有 sections（自由文字日誌、找不到來源）回 null，照舊整段顯示 content。
export function journalRows(note) {
  if (!Array.isArray(note?.sections)) return null
  const sections = note.sections.filter((section) => String(section?.text ?? '').trim())
  const vitals = sections.filter((section) => VITAL_KEYS.includes(section.key))
  const rows = []
  let deskRowDone = false
  for (const section of sections) {
    // 櫃台處理：處理事項與上傳影像併成同一列（檢視模式只列有勾的，見 deskChips）。
    if (DESK_KEYS.includes(section.key)) {
      if (!deskRowDone) {
        deskRowDone = true
        const row = deskRow(sections)
        if (row) rows.push(row)
      }
      continue
    }
    if (VITAL_KEYS.includes(section.key)) {
      if (section === vitals[0]) rows.push({ key: 'vitals', label: '生命徵象', items: vitals, tone: 'default', emphasis: false })
      continue
    }
    rows.push({
      key: section.key,
      label: section.label,
      text: section.text,
      tone: WARNING_KEYS.has(section.key) ? 'warning' : 'default',
      emphasis: EMPHASIS_KEYS.has(section.key),
      rich: RICH_TEXT_KEYS.has(section.key),
      ...(section.stage ? { stage: section.stage, medicationStatus: section.medicationStatus, needsRepack: section.needsRepack } : {}),
      ...(Array.isArray(section.items) && section.items.length ? { labs: section.items } : {}),
      ...(Array.isArray(section.results) && section.results.length ? { results: section.results } : {}),
      // 櫃台處理：依影像／收據／其他分組的結構化項目，畫成一組一行的徽章。
      ...(Array.isArray(section.groups) && section.groups.length ? { groups: section.groups } : {}),
      // 住院：唯讀的一列，點了到住院專區（其餘照護紀錄不進日誌）。
      ...(section.hospitalizationId ? { hospitalizationId: section.hospitalizationId } : {}),
      // 出院後多一份住院摘要：住院期間量的體重、體溫與檢驗結果（唯讀，即時引用）。
      ...(section.stay ? { stay: section.stay } : {}),
    })
  }
  return rows
}

// ── 編輯 ─────────────────────────────────────────────

// 表單欄位定義，順序＝畫面順序。multiline 決定用 Textarea 還是 Input；rich 的改用可上色的 RichTextEditor。
const APPOINTMENT_EDIT_FIELDS = [
  { key: 'reason', label: '來院原因', maxlength: 500 },
  { key: 'weightKg', label: '體重', unit: 'kg', numeric: true, step: '0.01' },
  { key: 'temperatureC', label: '體溫', unit: '°C', numeric: true, step: '0.1' },
  { key: 'visitNote', label: '本次簡易紀錄', multiline: true, rich: true, rows: 5, maxlength: 10000 },
  { key: 'prescription', label: '藥單', multiline: true, rich: true, rows: 4, maxlength: 10000 },
  { key: 'specialCareNote', label: '請轉告飼主', multiline: true, rows: 2, maxlength: 500, tone: 'warning' },
  { key: 'followUpRecommendation', label: '回診建議', multiline: true, rows: 2, maxlength: 500 },
]
const MEDICATION_EDIT_FIELDS = [
  { key: 'condition', label: '病況', multiline: true, rich: true, rows: 3, maxlength: 5000 },
  { key: 'prescription', label: '藥單', multiline: true, rich: true, rows: 4, maxlength: 10000, required: true },
  { key: 'note', label: '備註', multiline: true, rich: true, rows: 2, maxlength: 3000 },
]
const FREE_TEXT_FIELDS = [{ key: 'content', label: '內容', multiline: true, rows: 6, required: true }]

export function journalEditFields(note) {
  const kind = journalKind(note)
  if (kind === 'appointment' && note.fields) return APPOINTMENT_EDIT_FIELDS
  if (kind === 'medication' && note.fields) return MEDICATION_EDIT_FIELDS
  return FREE_TEXT_FIELDS
}

// 藥單階段徽章的顏色，跟藥單頁的狀態徽章同一套。
export function medicationStageTone(status) {
  return { review: 'bg-warning-surface text-warning', approved: 'bg-info-surface text-info', ready: 'bg-accent text-accent-foreground', collected: 'bg-success-surface text-success' }[status] || 'bg-sunken text-muted-foreground'
}

// 看診日誌每一列的畫面順序（後端 appointmentJournalSections 的順序，量測併成 vitals）。
const APPOINTMENT_ROW_ORDER = ['reason', 'vitals', 'labValues', 'idexx', 'visitNote', 'prescription', 'imageUpload', 'deskItems', 'reportDelivery', 'specialCareNote', 'followUpRecommendation', 'hospitalization']

// 編輯模式的版面：跟檢視同一個順序、同一種分列。能改的列變成輸入框（體重體溫併成一列），
// 改不到的列（檢驗、藥單）原樣留在原位；櫃台處理（處理事項＋上傳影像）換成勾選框，IDEXX 檢驗在原位換成可逐項修改的表格；
// 這樣按下「修改」畫面只有輸入框變了，其他列不會消失或跳位置。
// 回傳 [{ type: 'field'|'vitals'|'static'|'idexx', key, label?, field?, fields?, row? }]。
export function journalEditLayout(note) {
  const fields = journalEditFields(note)
  if (fields !== APPOINTMENT_EDIT_FIELDS) return fields.map((field) => ({ type: 'field', key: field.key, field }))
  const byKey = Object.fromEntries(fields.map((field) => [field.key, field]))
  const rows = new Map((journalRows(note) ?? []).map((row) => [row.key, row]))
  const layout = []
  for (const key of APPOINTMENT_ROW_ORDER) {
    if (key === 'vitals') layout.push({ type: 'vitals', key, label: '生命徵象', fields: [byKey.weightKg, byKey.temperatureC] })
    else if (byKey[key]) layout.push({ type: 'field', key, field: byKey[key], row: rows.get(key) })
    else if (key === 'idexx') { if (rows.get(key)?.results) layout.push({ type: 'idexx', key, label: rows.get(key).label }) }
    // 櫃台處理：處理事項與上傳影像合成一組勾選框，沒勾過也要出現（修改模式才能補勾）；檢視模式的兩列在這裡不單獨畫。
    else if (key === 'deskItems') layout.push({ type: 'desk', key, label: '櫃台處理' })
    else if (key === 'imageUpload') continue
    else if (rows.has(key)) layout.push({ type: 'static', key, row: rows.get(key) })
  }
  return layout
}

// 藥單日誌的日期跟著藥單建立時間走，改了也會在下一次藥單動作被覆寫回去，所以不給改。
export function journalDateEditable(note) {
  return journalKind(note) !== 'medication'
}

export function journalEditable(note) {
  return !note?.readOnly
}

export function journalEditForm(note) {
  const fields = journalEditFields(note)
  if (fields === FREE_TEXT_FIELDS) return { content: note?.editableContent ?? note?.content ?? '' }
  const form = Object.fromEntries(fields.map((field) => [field.key, note.fields[field.key] ?? '']))
  // 看診日誌另有櫃台處理的勾選（處理事項＋上傳影像），表單裡是陣列與布林。
  if (fields === APPOINTMENT_EDIT_FIELDS) {
    form.deskItems = sortDeskItems(note.fields.deskItems)
    form.imageUpload = Boolean(note.fields.imageUpload)
  }
  return form
}

function blank(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

// 帶格式的欄位只剩標記（例如 [red] [/red]）也算空白；字數只算純文字。
const fieldBlank = (field, value) => (field.rich ? blank(richTextToPlain(value)) : blank(value))
const fieldLength = (field, value) => (field.rich ? richTextLength(String(value ?? '').trim()) : String(value ?? '').trim().length)

// 回傳 PUT /clinical-notes/:id 的 body（不含 entryDate）。
export function journalEditPayload(note, form) {
  const fields = journalEditFields(note)
  if (fields === FREE_TEXT_FIELDS) return { content: String(form.content ?? '').trim() }
  const payload = Object.fromEntries(fields.map((field) => {
    const value = form[field.key]
    if (field.numeric) return [field.key, blank(value) ? null : Number(value)]
    return [field.key, String(value ?? '').trim()]
  }))
  if (fields === APPOINTMENT_EDIT_FIELDS) {
    payload.deskItems = sortDeskItems(form.deskItems)
    // 上傳影像只有跟目前存的不同才送：從沒勾過（null）的看診不能因為存檔被寫成「否」，日誌會多一行「上傳影像：否」。
    if (Boolean(form.imageUpload) !== Boolean(note.fields?.imageUpload)) payload.imageUpload = Boolean(form.imageUpload)
  }
  return { fields: payload }
}

// 送出前的檢查，回傳錯誤訊息（空字串＝可以送）。後端會再驗一次，這裡只是讓按鈕早點變灰、訊息講人話。
export function journalEditError(note, form) {
  const fields = journalEditFields(note)
  for (const field of fields) {
    const value = form[field.key]
    if (field.required && fieldBlank(field, value)) return `請填寫${field.label}`
    if (field.numeric && !blank(value) && (!Number.isFinite(Number(value)) || Number(value) < 0)) return `${field.label}必須是有效的非負數`
    if (field.maxlength && fieldLength(field, value) > field.maxlength) return `${field.label}最多 ${field.maxlength} 字`
  }
  // 日誌上還有改不到的內容（檢驗、IDEXX 檢驗）時，這幾欄全空也不算清空——只有檢驗、沒寫紀錄的看診就是這樣。
  const editableKeys = new Set([...fields.map((field) => field.key), 'reportDelivery', 'hospitalization'])
  const hasOtherContent = (note?.sections ?? []).some((section) => !editableKeys.has(section.key) && String(section?.text ?? '').trim())
  // 本來就沒有內容的看診（醫師開始看診就有日誌，不看有沒有填）一打開修改就報錯沒有意義；只在「原本有內容、被清光」時擋。
  const hadContent = hasOtherContent || fields.some((field) => !fieldBlank(field, note?.fields?.[field.key]))
  if (fields === APPOINTMENT_EDIT_FIELDS && hadContent && !hasOtherContent && fields.every((field) => fieldBlank(field, form[field.key]))) return '日誌內容不能全部清空'
  return ''
}

// 還在流程中的藥單從日誌改了內容會退回待醫師確認（後端 applyMedicationJournalEdit），先講清楚。
export function journalEditNotice(note) {
  if (journalKind(note) !== 'medication' || !note.fields) return ''
  if (note.medicationStatus === 'collected') return '這張藥單已領藥，修改只更正紀錄，會記在藥單的異動軌跡裡。'
  return '修改後這張藥單會退回「待醫師確認」；已包好的藥需要依新藥單重新包。'
}
