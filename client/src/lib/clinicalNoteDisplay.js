// 病歷日誌的呈現與編輯規則。
// 掛號與藥單日誌由後端依來源欄位回傳分欄的 sections／fields（見 server/src/lib/clinicalNoteView.js），
// 這裡把它們排成報告式的「標籤｜內容」列，以及編輯表單的初始值與送出格式。
// 手動與舊系統匯入的日誌是自由文字，沒有 sections，整段顯示、整段編輯。
import { richTextLength, richTextToPlain } from '../../../shared/richText.js'

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

// 報告的每一列：{ key, label, text, tone, emphasis, rich }；量測併成一列「生命徵象」，用 items 各自呈現。
// 沒有 sections（自由文字日誌、找不到來源）回 null，照舊整段顯示 content。
export function journalRows(note) {
  if (!Array.isArray(note?.sections)) return null
  const sections = note.sections.filter((section) => String(section?.text ?? '').trim())
  const vitals = sections.filter((section) => VITAL_KEYS.includes(section.key))
  const rows = []
  for (const section of sections) {
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
  return Object.fromEntries(fields.map((field) => [field.key, note.fields[field.key] ?? '']))
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
  return {
    fields: Object.fromEntries(fields.map((field) => {
      const value = form[field.key]
      if (field.numeric) return [field.key, blank(value) ? null : Number(value)]
      return [field.key, String(value ?? '').trim()]
    })),
  }
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
  if (fields === APPOINTMENT_EDIT_FIELDS && fields.every((field) => fieldBlank(field, form[field.key]))) return '日誌內容不能全部清空'
  return ''
}

// 還在流程中的藥單從日誌改了內容會退回待醫師確認（後端 applyMedicationJournalEdit），先講清楚。
export function journalEditNotice(note) {
  if (journalKind(note) !== 'medication' || !note.fields) return ''
  if (note.medicationStatus === 'collected') return '這張藥單已領藥，修改只更正紀錄，會記在藥單的異動軌跡裡。'
  return '修改後這張藥單會退回「待醫師確認」；已包好的藥需要依新藥單重新包。'
}
