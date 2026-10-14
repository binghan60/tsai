import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deskChips,
  journalDateEditable,
  journalEditError,
  journalEditFields,
  journalEditLayout,
  journalEditForm,
  journalEditNotice,
  journalEditPayload,
  journalKindLabel,
  journalRows,
} from './clinicalNoteDisplay.js'

const appointmentNote = {
  appointmentId: 'apt',
  sections: [
    { key: 'reason', label: '來院原因', text: '咳嗽' },
    { key: 'weightKg', label: '體重', text: '4.2 kg' },
    { key: 'temperatureC', label: '體溫', text: '38.5 °C' },
    { key: 'visitNote', label: '本次簡易紀錄', text: '安排檢查' },
    { key: 'specialCareNote', label: '請轉告飼主', text: '傷口勿舔舐' },
    { key: 'followUpRecommendation', label: '回診建議', text: '兩週後' },
  ],
  fields: { reason: '咳嗽', weightKg: 4.2, temperatureC: 38.5, visitNote: '安排檢查', specialCareNote: '傷口勿舔舐', followUpRecommendation: '兩週後' },
}

const medicationNote = {
  medicationOrderId: 'order',
  stage: '待包藥',
  medicationStatus: 'approved',
  sections: [{ key: 'prescription', label: '藥單', text: '抗生素' }],
  fields: { condition: '', prescription: '抗生素', note: '' },
}

test('each journal kind has its own label', () => {
  assert.equal(journalKindLabel(appointmentNote), '看診紀錄')
  assert.equal(journalKindLabel(medicationNote), '領藥紀錄')
  assert.equal(journalKindLabel({ source: 'legacy_import' }), '舊系統匯入')
  assert.equal(journalKindLabel({ source: 'manual' }), '記事')
})

test('free-text journals have no report rows and keep rendering their content', () => {
  assert.equal(journalRows({ content: '手動記事' }), null)
  assert.equal(journalRows(null), null)
})

test('appointment journal rows merge the measurements into one vitals row and keep reading order', () => {
  const rows = journalRows(appointmentNote)
  assert.deepEqual(rows.map((row) => row.key), ['reason', 'vitals', 'visitNote', 'specialCareNote', 'followUpRecommendation'])
  assert.deepEqual(rows[1].items.map((item) => item.text), ['4.2 kg', '38.5 °C'])
  assert.equal(rows.find((row) => row.key === 'specialCareNote').tone, 'warning')
  assert.equal(rows[0].emphasis, true)
})

test('櫃台處理：處理事項與上傳影像併成一列勾選框；什麼都沒勾（含勾過又取消）不畫', () => {
  const sections = (extra) => [{ key: 'reason', label: '來院原因', text: '咳嗽' }, ...extra]
  const groups = [
    { key: 'image', label: '影像', items: [{ key: 'image_usb', label: '影像USB' }] },
    { key: 'other', label: '其他', items: [{ key: 'prescription_given', label: '已給藥單' }] },
  ]
  const rows = journalRows({ appointmentId: 'apt', sections: sections([
    { key: 'imageUpload', label: '上傳影像', text: '已完成　10/9 14:32' },
    { key: 'deskItems', label: '櫃台處理', text: '影像USB、已給藥單', groups },
  ]) })
  const desk = rows.filter((row) => row.desk)
  assert.equal(desk.length, 1)
  assert.deepEqual(desk[0].desk, { items: ['image_usb', 'prescription_given'], imageUpload: true, uploadNote: '已完成　10/9 14:32' })
  assert.equal(rows.some((row) => row.key === 'imageUpload'), false, '上傳影像不再單獨一列')

  const onlyUpload = journalRows({ appointmentId: 'apt', sections: sections([{ key: 'imageUpload', label: '上傳影像', text: '是' }]) })
  assert.deepEqual(onlyUpload.find((row) => row.desk).desk, { items: [], imageUpload: true, uploadNote: '' })
  const untickedAgain = journalRows({ appointmentId: 'apt', sections: sections([{ key: 'imageUpload', label: '上傳影像', text: '否' }]) })
  assert.equal(untickedAgain.some((row) => row.desk), false)
})

test('a lone measurement still gets its vitals row', () => {
  const rows = journalRows({ appointmentId: 'apt', sections: [{ key: 'temperatureC', label: '體溫', text: '38 °C' }] })
  assert.deepEqual(rows.map((row) => [row.key, row.items.length]), [['vitals', 1]])
})

test('appointment edits send every journal field, numbers as numbers and blanks as null', () => {
  const form = journalEditForm(appointmentNote)
  assert.equal(form.weightKg, 4.2)
  form.weightKg = '4.5'
  form.temperatureC = ''
  form.reason = ' 咳嗽加劇 '
  assert.deepEqual(journalEditPayload(appointmentNote, form).fields, {
    reason: '咳嗽加劇', weightKg: 4.5, temperatureC: null, visitNote: '安排檢查', prescription: '', specialCareNote: '傷口勿舔舐', followUpRecommendation: '兩週後',
    deskItems: [],
  })

  // 櫃台處理：處理事項整組送；上傳影像只有跟目前存的不同才送（沒勾過的不能被存成「否」）。
  const desk = { ...appointmentNote, fields: { ...appointmentNote.fields, deskItems: ['receipt'], imageUpload: false } }
  const deskForm = journalEditForm(desk)
  assert.deepEqual([deskForm.deskItems, deskForm.imageUpload], [['receipt'], false])
  assert.equal('imageUpload' in journalEditPayload(desk, deskForm).fields, false)
  deskForm.deskItems = ['image_usb', 'receipt']
  deskForm.imageUpload = true
  const deskFields = journalEditPayload(desk, deskForm).fields
  assert.deepEqual([deskFields.deskItems, deskFields.imageUpload], [['image_usb', 'receipt'], true])
  // 修改模式的版面：處理事項與上傳影像合成一個勾選框列，沒勾過也有。
  assert.deepEqual(journalEditLayout(appointmentNote).filter((entry) => entry.type === 'desk').map((entry) => entry.key), ['deskItems'])
  assert.equal(journalEditError(appointmentNote, { ...form, weightKg: '-1' }), '體重必須是有效的非負數')
  const empty = Object.fromEntries(journalEditFields(appointmentNote).map((field) => [field.key, '']))
  assert.equal(journalEditError(appointmentNote, empty), '日誌內容不能全部清空')
  // 日誌上還有檢驗（改不到的段落）時，這幾欄全空也能存。
  const withLabs = { ...appointmentNote, sections: [{ key: 'idexx', label: 'IDEXX 檢驗', text: 'CREA 1.8' }] }
  assert.equal(journalEditError(withLabs, empty), '')
})

test('medication edits require a prescription, keep the date fixed and warn about re-review', () => {
  const form = journalEditForm(medicationNote)
  assert.equal(journalEditError(medicationNote, { ...form, prescription: ' ' }), '請填寫藥單')
  assert.deepEqual(journalEditPayload(medicationNote, form), { fields: { condition: '', prescription: '抗生素', note: '' } })
  assert.equal(journalDateEditable(medicationNote), false)
  assert.match(journalEditNotice(medicationNote), /待醫師確認/)
  assert.match(journalEditNotice({ ...medicationNote, medicationStatus: 'collected' }), /更正紀錄/)
})

test('free-text journals edit their whole content', () => {
  const note = { source: 'manual', content: '手動記事' }
  assert.deepEqual(journalEditForm(note), { content: '手動記事' })
  assert.deepEqual(journalEditPayload(note, { content: ' 改過 ' }), { content: '改過' })
  assert.equal(journalEditError(note, { content: '' }), '請填寫內容')
  assert.equal(journalDateEditable(note), true)
  assert.equal(journalEditNotice(note), '')
})

test('檢視模式的櫃台處理只列有勾的項目，上傳影像排第一、完成了帶時間', () => {
  assert.deepEqual(deskChips({ items: ['prescription_given', 'image_usb'], imageUpload: false, uploadNote: '' }).map((chip) => chip.label), ['影像USB', '已給藥單'])
  const [upload] = deskChips({ items: ['receipt'], imageUpload: true, uploadNote: '已完成　10/9 14:32' })
  assert.deepEqual([upload.label, upload.done, upload.time], ['上傳影像', true, '10/9 14:32'])
  assert.deepEqual(deskChips({ items: [], imageUpload: true, uploadNote: '' }).map((chip) => [chip.label, chip.done]), [['上傳影像', false]])
  assert.deepEqual(deskChips({ items: ['no_visit_record'], imageUpload: false, uploadNote: '' }).map((chip) => [chip.label, chip.tone]), [['不寄就診紀錄', 'warning']])
  assert.deepEqual(deskChips(null), [])
})
