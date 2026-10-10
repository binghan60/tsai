<script setup>
import { usePetClinicalNotes } from '../composables/usePetClinicalNotes'
import { apiErrorMessage } from '../lib/apiError.js'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import PatientLink from './PatientLink.vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ArrowRight, FileText, FlaskConical, Pencil, Stethoscope, Undo2 } from '@lucide/vue'
import SurgeryBadge from './SurgeryBadge.vue'
import LatenessBadge from './LatenessBadge.vue'
import CheckinNumber from './CheckinNumber.vue'
import SpecGrid from './SpecGrid.vue'
import SpecCell from './SpecCell.vue'
import PetSex from './PetSex.vue'
import DestTag from './DestTag.vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier'
import { useTextTemplates } from '../composables/useTextTemplates'
import { canRequestLab, labRequestDelivered, useLabRequest } from '../composables/useLabRequest'
import { workflowState } from '../../../shared/appointmentWorkflow.js'
import { clinicalDraft, draftPatch, mergeClinicalUpdate, takeBaseline } from '../lib/visitDraft'
import { ageLabel, clinicTimeInput } from '../lib/datetime'
import { medicalHistoryText } from '../lib/petDisplay'
import ClinicalNotesPanel from './ClinicalNotesPanel.vue'
import VisitLabTable from './VisitLabTable.vue'
import LabImportDialog from './LabImportDialog.vue'
import LabFillStatus from './LabFillStatus.vue'
import LabConflictDialog from './LabConflictDialog.vue'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import RichText from './RichText.vue'
import RichTextEditor from './RichTextEditor.vue'
import { richTextToPlain } from '../../../shared/richText.js'
import { catBreedLabel } from '../../../shared/catBreeds.js'
import { Alert, AlertDescription } from './ui/alert'

// 看診工作區：診療台右欄編輯單筆掛號的看診內容。
// 看診（這筆掛號）是唯一存放處：病歷日誌即時讀它，報到時建立的健檢報告草稿也預設跟著它走
// （體重、體溫、回診日期、檢驗數值），醫師在報告裡改過的欄位才不再跟。
// 檢驗數值不在這裡填（診療台的檢驗區塊已拿掉），改在健檢報告填寫頁輸入、寫回看診。
// 每個欄位旁的小標記（日誌／報告／院內）說的就是這件事：寫在這裡的東西會去哪裡。
const props = defineProps({
  appointment: { type: Object, required: true },
})
const toast = useToast()
const notifyChat = useAppointmentNotifier()
const { openPicker } = useTextTemplates()
// start：還沒開始看診時按「開始看診」；
// notes-updated：貓咪／飼主備註改了，讓佇列上的備註標籤跟著更新。
const emit = defineEmits(['updated', 'open-record', 'start', 'notes-updated'])

const labTable = ref(null)
const labImportOpen = ref(false)
// 填入狀態燈號的明細按了「比對」：開 IDEXX 與報告數值的比對視窗。
const labConflictGroup = ref(null)

// 送 IDEXX 不走看診的自動存檔，也不動掛號的版本號：它只是一個時間戳記，跟正在打的紀錄互不影響。
const labRequest = useLabRequest()
async function toggleLabRequest(requested) {
  const data = await labRequest.setLabRequest(props.appointment, requested)
  if (data) emit('updated', data, 'lab-request')
}

const draft = reactive(clinicalDraft(props.appointment))
const baseline = ref(clinicalDraft(props.appointment))
const conflicts = ref([])
const busy = ref(false)
const committing = ref(false)
const error = ref('')
const reopenDialog = ref(false)
const reopenReason = ref('')
const reopenError = ref('')
const savedAt = ref(null)
const pet = ref(null)
const { notes, page: notePage, totalPages: noteTotalPages, loading: notesLoading, error: notesError, load: loadNotes } = usePetClinicalNotes({
  petId: () => props.appointment.petId,
  excludeAppointmentId: () => props.appointment._id,
})
const contextError = ref('')
const editingOwnerNote = ref(false)
const ownerNoteDraft = ref('')
const ownerNoteSaving = ref(false)
const ownerNoteError = ref('')
const editingPetNote = ref(false)
const petNoteDraft = ref('')
const petNoteSaving = ref(false)
const petNoteError = ref('')
let timer
let disposed = false
let savePromise = null
let queued = null

const state = computed(() => workflowState(props.appointment))
// 送交櫃台後即鎖定；櫃台完成前可取回修改，完成後需申請核准。
const editable = computed(() => state.value.started && !state.value.handedOff && !state.value.completed)
const dirty = computed(() => Object.keys(draftPatch(draft, baseline.value)).length > 0)
const owner = computed(() => (typeof pet.value?.ownerId === 'object' ? pet.value.ownerId : null))
// 飼主聯絡資料與就診時間直接攤在標頭的規格欄（曾經收在 Info 彈出框裡，使用者要一眼看到）。
const ownerFields = computed(() => {
  const data = owner.value
  return [
    { label: '市話', value: data?.landline || '', mono: true },
    { label: 'Email', value: data?.email || '' },
    { label: '地址', value: data?.address || '' },
  ].filter((field) => field.value)
})
const age = computed(() => ageLabel(pet.value?.birthDate, new Date(), '', { estimated: pet.value?.birthDateEstimated }))
// 醫療警示分級：藥物過敏最高（實心紅）、病史次之（紅框），疫苗／健檢只是參考（灰）。
const medicalTags = computed(() => {
  if (!pet.value) return []
  const tags = []
  if (pet.value.allergyStatus === 'yes') tags.push({ key: 'allergy', label: pet.value.allergyType ? `藥物過敏：${pet.value.allergyType}` : '藥物過敏', class: 'bg-danger-surface font-semibold text-danger' })
  const history = medicalHistoryText(pet.value)
  if (history) tags.push({ key: 'history', label: `病史：${history}`, class: 'bg-card text-danger shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_55%,transparent)]' })
  if (pet.value.allergyStatus === 'none') tags.push({ key: 'no-allergy', label: '無藥物過敏', class: 'bg-success-surface text-success' })
  // 狀態預設是 'unknown'：不知道就不出標籤，不能當成「未注射／未健檢」。
  if (['done', 'none'].includes(pet.value.vaccineStatus)) tags.push({ key: 'vaccine', label: pet.value.vaccineStatus === 'done' ? `疫苗 ${pet.value.vaccineDate || '已注射'}` : '未注射疫苗', class: pet.value.vaccineStatus === 'done' ? 'bg-success-surface text-success' : 'bg-warning-surface text-warning' })
  if (['done', 'none'].includes(pet.value.checkupStatus)) tags.push({ key: 'checkup', label: pet.value.checkupStatus === 'done' ? `健檢 ${pet.value.checkupDate || '有'}` : '未健檢', class: pet.value.checkupStatus === 'done' ? 'bg-success-surface text-success' : 'bg-warning-surface text-warning' })
  return tags
})

// 文字模板：三個文字欄各一顆按鈕，key 用 visit: 前綴（後端 /text-templates/fields 也認得）。
const TEMPLATE_FIELDS = {
  visitNote: { key: 'visit:visitNote', label: '本次簡易紀錄' },
  specialCareNote: { key: 'visit:specialCareNote', label: '請轉告飼主' },
}
function textareaId(field) {
  return `visit-${field}-${props.appointment._id}`
}
// 本次簡易紀錄是可上色的編輯器，插入直接交給它（模板的粗體與顏色一起帶入）；
// 請轉告飼主是純文字欄位，只取模板的文字。
const visitNoteEditor = ref(null)
function openTemplates(field) {
  const meta = TEMPLATE_FIELDS[field]
  if (field === 'visitNote') {
    openPicker({
      itemKey: meta.key,
      label: meta.label,
      currentText: richTextToPlain(draft.visitNote),
      currentRichText: String(draft.visitNote ?? ''),
      onInsert: (template, mode) => visitNoteEditor.value?.insertRichText(template.content, mode),
    })
    return
  }
  const input = document.getElementById(textareaId(field))
  const selection = input && Number.isInteger(input.selectionStart) ? { start: input.selectionStart, end: input.selectionEnd } : null
  openPicker({
    itemKey: meta.key,
    label: meta.label,
    currentText: String(draft[field] ?? ''),
    onInsert(template, mode) {
      const base = String(draft[field] ?? '')
      const text = richTextToPlain(template.content)
      if (mode === 'replace' || !base) {
        draft[field] = text
        return
      }
      const start = Math.min(selection?.start ?? base.length, base.length)
      const end = Math.min(selection?.end ?? start, base.length)
      draft[field] = `${base.slice(0, start)}${text}${base.slice(end)}`
    },
  })
}

const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 30000)
const visitMinutes = computed(() => (props.appointment.visitStartedAt && !state.value.handedOff ? Math.max(0, Math.floor((now.value - new Date(props.appointment.visitStartedAt).getTime()) / 60000)) : null))
const CONFLICT_LABELS = {
  visitNote: '本次簡易紀錄',
  prescription: '藥單',
  internalNote: '內部備註',
  specialCareNote: '請轉告飼主',
  followUpRecommendation: '回診建議',
  weightKg: '體重',
  temperatureC: '體溫',
}
function conflictLabel(key) {
  return CONFLICT_LABELS[key]
}
function conflictValue(key) {
  return baseline.value[key]
}
const savedLabel = computed(() => {
  if (busy.value) return '儲存中…'
  if (conflicts.value.length) return '有資料衝突，請先選擇保留內容'
  if (state.value.handedOff && !state.value.completed) return '已交櫃台，取回後才能編輯'
  if (state.value.completed) return '已結案，核准修改後才能編輯'
  if (dirty.value) return '尚未儲存'
  if (savedAt.value) return `${savedAt.value.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 已儲存`
  return '已儲存'
})

// 父層 appointment 更新時，保留使用者未儲存的草稿並標記衝突欄位。
function receive(incoming) {
  if (disposed) return
  if (busy.value) {
    queued = incoming
    return
  }
  const merged = mergeClinicalUpdate(draft, baseline.value, incoming)
  Object.assign(draft, merged.draft)
  baseline.value = merged.baseline
  if (merged.conflicts.length) conflicts.value = [...new Set([...conflicts.value, ...merged.conflicts])]
}
watch(
  () => props.appointment,
  (incoming) => receive(incoming),
)

async function loadContext() {
  pet.value = null
  if (!props.appointment.petId) return
  const petId = props.appointment.petId
  try {
    const [{ data: patient }] = await Promise.all([http.get(`/pets/${petId}`), loadNotes(notePage.value)])
    if (disposed || props.appointment.petId !== petId) return
    pet.value = patient
    if (!editingOwnerNote.value) ownerNoteDraft.value = patient?.ownerId?.notes || ''
    if (!editingPetNote.value) petNoteDraft.value = patient?.notes || ''
    contextError.value = ''
  } catch {
    contextError.value = '病史或病歷日誌未能載入，請重新載入確認。'
  }
}

function startOwnerNoteEdit() {
  ownerNoteDraft.value = owner.value?.notes || ''
  ownerNoteError.value = ''
  editingOwnerNote.value = true
}

function cancelOwnerNoteEdit() {
  ownerNoteDraft.value = owner.value?.notes || ''
  ownerNoteError.value = ''
  editingOwnerNote.value = false
}

function startPetNoteEdit() {
  petNoteDraft.value = pet.value?.notes || ''
  petNoteError.value = ''
  editingPetNote.value = true
}

function cancelPetNoteEdit() {
  petNoteDraft.value = pet.value?.notes || ''
  petNoteError.value = ''
  editingPetNote.value = false
}

async function savePetNote() {
  const currentPet = pet.value
  if (!currentPet || petNoteSaving.value) return
  petNoteSaving.value = true
  petNoteError.value = ''
  try {
    const { data } = await http.put(`/pets/${currentPet._id}`, {
      notes: petNoteDraft.value.trim(),
      expectedVersion: currentPet.__v,
    })
    pet.value = { ...pet.value, notes: data.notes || '', __v: data.__v }
    petNoteDraft.value = data.notes || ''
    emit('notes-updated', { kind: 'pet', id: String(currentPet._id), notes: data.notes || '' })
    editingPetNote.value = false
    toast.success('已更新貓咪備註')
  } catch (err) {
    petNoteError.value = err.response?.status === 409
      ? '貓咪資料已由其他人更新，請重新載入後再修改。'
      : apiErrorMessage(err, '貓咪備註儲存失敗，請重試。')
  } finally {
    petNoteSaving.value = false
  }
}

async function saveOwnerNote() {
  const currentOwner = owner.value
  if (!currentOwner || ownerNoteSaving.value) return
  ownerNoteSaving.value = true
  ownerNoteError.value = ''
  try {
    const { data } = await http.put(`/owners/${currentOwner._id}`, {
      name: currentOwner.name,
      phone: currentOwner.phone,
      landline: currentOwner.landline || '',
      email: currentOwner.email || '',
      address: currentOwner.address || '',
      notes: ownerNoteDraft.value.trim(),
      expectedVersion: currentOwner.__v,
    })
    pet.value = { ...pet.value, ownerId: data }
    ownerNoteDraft.value = data.notes || ''
    emit('notes-updated', { kind: 'owner', id: String(currentOwner._id), notes: data.notes || '' })
    editingOwnerNote.value = false
    toast.success('已更新飼主備註')
  } catch (err) {
    ownerNoteError.value = err.response?.status === 409 ? '飼主資料已由其他人更新，請重新載入後再修改。' : apiErrorMessage(err, '飼主備註儲存失敗，請重試。')
  } finally {
    ownerNoteSaving.value = false
  }
}
loadContext()

async function save() {
  clearTimeout(timer)
  if (savePromise) {
    await savePromise
    return dirty.value ? save() : true
  }
  if (!dirty.value) return true
  if (!editable.value || conflicts.value.length || busy.value) return false
  // 存檔期間繼續打的字不能改到這份快照，合併時才認得出哪些是送出之後才打的。
  const snapshot = { ...draft }
  const patch = draftPatch(snapshot, baseline.value)
  busy.value = true
  error.value = ''
  savePromise = (async () => {
    try {
      const { data } = await http.post(`/appointments/${props.appointment._id}/workflow/clinical`, { version: props.appointment.__v ?? 0, ...patch })
      // 後端回傳最新版 appointment，合併時保留本機仍未送出的輸入。
      const merged = mergeClinicalUpdate(draft, snapshot, data)
      Object.assign(draft, merged.draft)
      baseline.value = merged.baseline
      savedAt.value = new Date()
      emit('updated', data)
      return true
    } catch (err) {
      error.value = apiErrorMessage(err, '儲存失敗，請重試。')
      return false
    } finally {
      savePromise = null
      busy.value = false
      if (queued) {
        const update = queued
        queued = null
        receive(update)
      }
    }
  })()
  return savePromise
}

watch(
  draft,
  () => {
    clearTimeout(timer)
    if (dirty.value && editable.value && !conflicts.value.length) timer = setTimeout(save, 1200)
  },
  { deep: true },
)

// 診療台一次只掛一個工作區，換貓或送交櫃台後就卸載；卸載前由診療台呼叫這裡，把還在等的自動存檔立刻送出。
// 回傳 false（存檔失敗、有衝突待處理）時診療台會留在這筆，輸入才不會跟著元件一起消失。
function flush() {
  return editable.value ? save() : true
}
defineExpose({ flush })

function resolveConflict(keepLocal) {
  if (!keepLocal) for (const key of conflicts.value) takeBaseline(draft, baseline.value, key)
  conflicts.value = []
  error.value = ''
  if (keepLocal) save()
}

async function run(action, payload = {}) {
  if (busy.value || conflicts.value.length) return false
  committing.value = true
  try {
    if (!(await save())) return false
    if (dirty.value && !(await save())) return false
    busy.value = true
    error.value = ''
    const { data } = await http.post(`/appointments/${props.appointment._id}/workflow/${action}`, {
      version: props.appointment.__v ?? 0,
      ...payload,
    })
    baseline.value = clinicalDraft(data)
    Object.assign(draft, clinicalDraft(data))
    emit('updated', data, action)
    if (action === 'record' && data.recordId) emit('open-record', data)
    return true
  } catch (err) {
    error.value = apiErrorMessage(err, '操作失敗，請重試。')
    return false
  } finally {
    busy.value = false
    committing.value = false
    if (queued) {
      const update = queued
      queued = null
      receive(update)
    }
  }
}

function openReopenRequest() {
  reopenReason.value = ''
  reopenError.value = ''
  reopenDialog.value = true
}

async function requestReopen() {
  const reason = reopenReason.value.trim()
  const submitted = await run('request-reopen', { reason })
  if (!submitted) {
    reopenError.value = error.value || '申請修改失敗，請重試。'
    return
  }
  reopenDialog.value = false
  toast.success('已送出修改申請，等待櫃台核准。')
}

function handleHistoricalNoteSaved({ note, content }) {
  notifyChat(props.appointment, 'visit_data', {
    changedParts: ['歷次病歷日誌'],
    snapshot: { fieldLabel: '歷次病歷日誌', before: note.content || '', after: content || '' },
  })
  loadNotes(notePage.value)
}

function beforeUnload(event) {
  if (!dirty.value && !busy.value) return
  save()
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(async () => {
  if (!dirty.value || !editable.value) return true
  if (await save()) return true
  toast.error(`「${props.appointment.petName}」還有內容沒有儲存成功，請先處理再離開`)
  return false
})

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
  clearInterval(clock)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <section class="flex min-h-0 flex-col" :aria-label="`${appointment.petName} 看診工作區`">
    <!-- 標頭跟內容一起捲動：標頭（備註、醫療警示）可能很高，固定住會把寫紀錄的空間壓得很小。
         只有底部的動作列固定，送交按鈕隨時按得到。 -->
    <!-- 版面依工作區自己的寬度排（container query），不看視窗寬度：1600px 開著側滑面板時工作區只剩五百多 px，
         照視窗寬度排的兩欄會被擠爛。 -->
    <div class="@container/visit min-h-0 flex-1 overflow-y-auto">
      <header class="space-y-4 border-b border-border px-6 pt-5 pb-4">
        <!-- 第一排：號碼牌在左，右邊是名字，名字下面一排規格：貓咪靠左、飼主與就診時間靠右，小標題在同一條線上。
             放不下時飼主整組換到下一行、跟貓咪規格同一條左緣（justify-between 在只剩一項的行會靠左）。 -->
        <div class="flex items-start gap-4">
          <CheckinNumber :appointment="appointment" size="lg" />
          <div class="min-w-0 flex-1 space-y-2.5">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-xl leading-tight font-semibold"><PatientLink :pet-id="appointment.petId">{{ appointment.petName }}</PatientLink></h2>
              <Badge v-if="appointment.visitType === 'new'" variant="status" class="bg-info-surface text-info">初診</Badge>
            </div>
            <div class="flex flex-wrap items-start justify-between gap-x-8 gap-y-2.5">
              <SpecGrid>
                <SpecCell label="品種">{{ catBreedLabel(pet?.breed) || appointment.species }}</SpecCell>
                <SpecCell v-if="pet?.sex === 'male' || pet?.sex === 'female'" label="性別"><PetSex :sex="pet.sex" :neutered="pet.neutered" with-label /></SpecCell>
                <SpecCell v-if="age" label="年齡">{{ age }}</SpecCell>
                <SpecCell v-if="draft.weightKg !== '' || pet?.weightKg != null" label="體重" mono>
                  {{ draft.weightKg !== '' ? draft.weightKg : pet.weightKg }} kg
                  <span v-if="draft.weightKg !== ''" class="rounded-sm bg-accent px-1.5 py-0.5 font-sans text-2xs leading-none font-semibold text-accent-foreground">本次</span>
                </SpecCell>
              </SpecGrid>
              <!-- 飼主與就診時間分成兩組：欄位多時各自整組換行，不會把時間切在飼主資料中間。 -->
              <div class="flex min-w-0 flex-wrap items-start gap-x-8 gap-y-2.5">
                <SpecGrid class="min-w-0">
                  <SpecCell label="飼主"><PatientLink v-if="owner?.name || appointment.ownerName" :pet-id="appointment.petId" quiet>{{ owner?.name || appointment.ownerName }}</PatientLink></SpecCell>
                  <SpecCell v-if="owner?.phone || appointment.ownerPhone" label="電話" mono>{{ owner?.phone || appointment.ownerPhone }}</SpecCell>
                  <SpecCell v-for="field in ownerFields" :key="field.label" :label="field.label" :mono="field.mono">
                    <span class="max-w-60 truncate" v-tip.overflow="field.value">{{ field.value }}</span>
                  </SpecCell>
                </SpecGrid>
                <SpecGrid>
                  <SpecCell label="預約" mono>{{ appointment.time }}</SpecCell>
                  <SpecCell v-if="appointment.checkedInAt" label="報到" mono>{{ clinicTimeInput(appointment.checkedInAt) }}</SpecCell>
                  <SpecCell v-if="visitMinutes !== null" label="看診" mono>{{ visitMinutes }} 分</SpecCell>
                  <SpecCell v-if="appointment.handoffAt" label="交櫃台" mono>{{ clinicTimeInput(appointment.handoffAt) }}</SpecCell>
                  <SpecCell v-if="appointment.deskCompletedAt" label="完成" mono>{{ clinicTimeInput(appointment.deskCompletedAt) }}</SpecCell>
                </SpecGrid>
              </div>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <span class="spec-label">來院原因</span>
          <span class="text-lg font-semibold">{{ appointment.reason }}</span>
          <SurgeryBadge v-if="appointment.isSurgery" :name="appointment.surgeryName" class="self-center" />
          <LatenessBadge :minutes="appointment.latenessMinutes" class="self-center" />
        </div>

        <div v-if="medicalTags.length" class="flex flex-wrap gap-2">
          <span v-for="tag in medicalTags" :key="tag.key" class="inline-flex min-h-8 items-center rounded-full px-3 text-sm leading-snug" :class="tag.class">{{ tag.label }}</span>
        </div>

        <!-- 貓咪與飼主備註：會咬人、飼主難溝通這類事要在叫進診間前就看到，所以常駐顯示、不收合。 -->
        <div v-if="pet" class="grid gap-2 @2xl/visit:grid-cols-2">
          <div class="min-w-0 rounded-lg px-3.5 py-2.5" :class="pet.notes || editingPetNote ? 'bg-warning-surface text-warning' : 'bg-sunken text-muted-foreground'">
            <div class="flex items-start gap-3">
              <span class="shrink-0 pt-0.5 text-sm font-semibold">貓咪備註</span>
              <Textarea v-if="editingPetNote" v-model="petNoteDraft" class="min-w-0 flex-1 text-foreground" rows="2" maxlength="2000" :disabled="petNoteSaving" aria-label="貓咪備註" placeholder="例：會咬人，保定需兩人" />
              <p v-else class="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere font-medium">{{ pet.notes }}</p>
              <Button v-if="!editingPetNote" variant="secondary" size="icon-xs" class="shrink-0" aria-label="編輯貓咪備註" @click="startPetNoteEdit"><Pencil stroke-width="1.75" /></Button>
            </div>
            <Alert v-if="petNoteError" variant="destructive" class="mt-2"><AlertDescription>{{ petNoteError }}</AlertDescription></Alert>
            <div v-if="editingPetNote" class="mt-2 flex justify-end gap-2">
              <Button variant="secondary" size="xs" :disabled="petNoteSaving" @click="cancelPetNoteEdit">取消</Button>
              <Button size="xs" :disabled="petNoteSaving" @click="savePetNote">{{ petNoteSaving ? '儲存中…' : '儲存備註' }}</Button>
            </div>
          </div>
          <div class="min-w-0 rounded-lg px-3.5 py-2.5" :class="owner?.notes || editingOwnerNote ? 'bg-warning-surface text-warning' : 'bg-sunken text-muted-foreground'">
            <div class="flex items-start gap-3">
              <span class="shrink-0 pt-0.5 text-sm font-semibold">飼主備註</span>
              <Textarea v-if="editingOwnerNote" v-model="ownerNoteDraft" class="min-w-0 flex-1 text-foreground" rows="2" maxlength="2000" :disabled="ownerNoteSaving" aria-label="飼主備註" placeholder="例：處置前先說明費用" />
              <p v-else class="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere font-medium">{{ owner?.notes }}</p>
              <Button v-if="owner && !editingOwnerNote" variant="secondary" size="icon-xs" class="shrink-0" aria-label="編輯飼主備註" @click="startOwnerNoteEdit"><Pencil stroke-width="1.75" /></Button>
            </div>
            <Alert v-if="ownerNoteError" variant="destructive" class="mt-2"><AlertDescription>{{ ownerNoteError }}</AlertDescription></Alert>
            <div v-if="editingOwnerNote" class="mt-2 flex justify-end gap-2">
              <Button variant="secondary" size="xs" :disabled="ownerNoteSaving" @click="cancelOwnerNoteEdit">取消</Button>
              <Button size="xs" :disabled="ownerNoteSaving" @click="saveOwnerNote">{{ ownerNoteSaving ? '儲存中…' : '儲存備註' }}</Button>
            </div>
          </div>
        </div>
      </header>

      <div v-if="error || contextError || conflicts.length" class="max-h-72 shrink-0 space-y-3 overflow-y-auto border-b border-border px-6 py-3">
        <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
        <div v-if="contextError" class="flex items-center gap-3 rounded-lg bg-warning-surface p-3 text-warning">
          <span class="flex-1">{{ contextError }}</span>
          <Button variant="secondary" size="xs" @click="loadContext">重新載入</Button>
        </div>
        <div v-if="conflicts.length" role="alert" class="space-y-3 rounded-xl bg-warning-surface p-4 text-warning">
          <p>這筆看診資料與其他更新衝突：{{ conflicts.map(conflictLabel).join('、') }}。請選擇要保留的內容。</p>
          <div v-for="key in conflicts" :key="key" class="rounded-lg bg-card p-3 text-foreground">
            <p class="text-sm font-medium text-muted-foreground">{{ conflictLabel(key) }}（目前內容）</p>
            <RichText v-if="['visitNote', 'prescription'].includes(key) && conflictValue(key)" class="mt-1" :text="conflictValue(key)" />
            <p v-else class="mt-1 whitespace-pre-wrap">{{ conflictValue(key) || '（空白）' }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" @click="resolveConflict(false)">使用目前內容</Button>
            <Button variant="secondary" size="sm" @click="resolveConflict(true)">保留我的修改</Button>
          </div>
        </div>
      </div>

      <!-- 左欄由上而下：量測 → 本次簡易紀錄 → 藥單 → 內部備註 → 交給櫃台；右欄是歷次病歷日誌。
           兩欄按 65:35 分配，日誌欄保底 20rem，窄螢幕上報告卡才不會被擠爛。 -->
      <div class="grid @4xl/visit:grid-cols-[minmax(0,65fr)_minmax(20rem,35fr)]">
        <div class="flex flex-col gap-6 px-6 py-5">
          <section class="space-y-3" :aria-labelledby="`measure-heading-${appointment._id}`">
            <div class="flex items-center gap-2"><h3 :id="`measure-heading-${appointment._id}`" class="text-base font-semibold">量測</h3><DestTag :to="['journal', 'report']" /></div>
            <!-- 量測用文字框＋數字鍵盤，不用 type="number"：數字框在空白時按上下鍵或滾輪會直接帶入最小值 0，
                 醫師捲動工作區時游標停在體溫欄，就莫名其妙存了 0 °C。填寫頁的量測欄位也是這樣做。 -->
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <Label :for="`visit-weight-${appointment._id}`">體重</Label>
                <div class="relative"><Input :id="`visit-weight-${appointment._id}`" v-model="draft.weightKg" type="text" inputmode="decimal" class="num pr-11" :disabled="!editable || committing" /><span class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-subtle-foreground">kg</span></div>
              </div>
              <div class="space-y-1.5">
                <Label :for="`visit-temp-${appointment._id}`">體溫</Label>
                <div class="relative"><Input :id="`visit-temp-${appointment._id}`" v-model="draft.temperatureC" type="text" inputmode="decimal" class="num pr-11" :disabled="!editable || committing" /><span class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-subtle-foreground">°C</span></div>
              </div>
            </div>
          </section>

          <!-- 檢驗報告：這隻貓當天的 IDEXX 原始結果（不是健檢報告上的數值），只顯示不能改，
               放在本次簡易紀錄正上方，醫師邊看邊打紀錄。它是參考資料、不是這裡寫的東西，所以沒有去處標記。 -->
          <section class="space-y-2" :aria-labelledby="`lab-heading-${appointment._id}`">
            <div class="flex items-center gap-2">
              <h3 :id="`lab-heading-${appointment._id}`" class="text-base font-semibold">檢驗報告</h3>
              <Badge v-if="labTable?.abnormal" variant="status" class="bg-danger-surface text-danger">異常 <span class="num">{{ labTable.abnormal }}</span> 項</Badge>
              <!-- 這些結果有哪些數值進了健檢報告（燈號＋點開的明細）。 -->
              <LabFillStatus :pet-id="String(appointment.petId ?? '')" :appointment-id="String(appointment._id)" :base-date="appointment.date" :version="appointment.__v ?? 0" @compare="labConflictGroup = $event" />
              <!-- 技術員在 IDEXX 主機上手打名字驗的結果不會自己歸過來：從這裡挑當天還沒認領的那一份。 -->
              <Button v-if="appointment.petId" variant="soft" size="sm" class="ml-auto" @click="labImportOpen = true"><FlaskConical stroke-width="1.75" />匯入檢驗結果</Button>
            </div>
            <VisitLabTable ref="labTable" :appointment="appointment" />
            <LabImportDialog v-if="labImportOpen" :appointment="appointment" @close="labImportOpen = false" @imported="labTable?.reload()" />
            <LabConflictDialog v-if="labConflictGroup" :group="labConflictGroup" @close="labConflictGroup = null" @resolved="labConflictGroup = null" />
          </section>

          <!-- 用 div 不用 label：label 會把點擊轉給裡面第一個可點的元素，也就是編輯器工具列的粗體鈕。 -->
          <section class="space-y-2" :aria-labelledby="`note-heading-${appointment._id}`">
            <div class="flex items-center gap-2"><h3 :id="`note-heading-${appointment._id}`" class="text-base font-semibold">本次簡易紀錄</h3><DestTag to="journal" /></div>
            <RichTextEditor ref="visitNoteEditor" :id="textareaId('visitNote')" v-model="draft.visitNote" aria-label="本次簡易紀錄" :min-rows="8" :disabled="!editable || committing" placeholder="輸入本次看診紀錄…">
              <template v-if="editable" #toolbar-end>
                <Button type="button" variant="secondary" size="icon-xs" aria-label="插入本次簡易紀錄的文字模板" v-tip="'文字模板'" :disabled="committing" @mousedown.prevent @click="openTemplates('visitNote')"><FileText stroke-width="1.75" /></Button>
              </template>
            </RichTextEditor>
          </section>

          <!-- 藥單：跟本次簡易紀錄一樣寫進這次看診的病歷日誌；送交櫃台時在藥單新增一筆（待包藥）。 -->
          <section class="space-y-2" :aria-labelledby="`prescription-heading-${appointment._id}`">
            <div class="flex items-center gap-2"><h3 :id="`prescription-heading-${appointment._id}`" class="text-base font-semibold">藥單</h3><DestTag :to="['journal', 'medication']" /></div>
            <RichTextEditor :id="textareaId('prescription')" v-model="draft.prescription" aria-label="藥單" :min-rows="4" :disabled="!editable || committing" />
          </section>

          <section class="space-y-2">
            <div class="flex items-center gap-2"><Label :for="`visit-internal-${appointment._id}`" class="text-base font-semibold text-foreground">內部備註</Label><DestTag to="internal" /></div>
            <Textarea :id="`visit-internal-${appointment._id}`" v-model="draft.internalNote" rows="3" maxlength="2000" class="field-sizing-fixed" :disabled="!editable || committing" placeholder="只給院內看，不進病歷日誌與健檢報告" />
          </section>

          <section class="space-y-4 border-t border-border pt-5" :aria-labelledby="`handoff-heading-${appointment._id}`">
            <div>
              <h3 :id="`handoff-heading-${appointment._id}`" class="text-base font-semibold">交給櫃台</h3>
              <p class="text-sm text-muted-foreground">櫃台處理時會先看到這兩欄；收費與領藥由櫃台直接處理，系統不計價。</p>
            </div>
            <div class="grid gap-4 @2xl/visit:grid-cols-2">
              <div class="space-y-1.5">
                <div class="flex items-center gap-2"><Label :for="textareaId('specialCareNote')" class="text-warning">請轉告飼主</Label><DestTag to="journal" /></div>
                <div class="relative">
                  <Textarea :id="textareaId('specialCareNote')" v-model="draft.specialCareNote" rows="4" maxlength="500" class="field-sizing-fixed pr-11" :disabled="!editable || committing" placeholder="例：傷口勿舔舐，三天後回來拆線" />
                  <Button v-if="editable" type="button" variant="secondary" size="icon-xs" class="absolute top-1.5 right-1.5" aria-label="插入請轉告飼主的文字模板" v-tip="'文字模板'" :disabled="committing" @click="openTemplates('specialCareNote')"><FileText stroke-width="1.75" /></Button>
                </div>
              </div>
              <div class="space-y-1.5">
                <div class="flex items-center gap-2"><Label :for="`visit-followup-${appointment._id}`">回診建議</Label><DestTag to="journal" /></div>
                <Textarea :id="`visit-followup-${appointment._id}`" v-model="draft.followUpRecommendation" rows="4" maxlength="500" class="field-sizing-fixed" :disabled="!editable || committing" placeholder="例：兩週後回診複查腎指數" />
              </div>
            </div>
          </section>
        </div>
        <!-- 病歷日誌自己捲動，並在往下捲時黏在頂端，寫到交給櫃台時仍看得到歷次紀錄。 -->
        <div class="h-128 px-6 py-5 @4xl/visit:sticky @4xl/visit:top-0 @4xl/visit:h-[calc(100dvh-11rem)] @4xl/visit:self-start @4xl/visit:pl-0">
          <ClinicalNotesPanel :notes="notes" :loading="notesLoading" :error="notesError" :page="notePage" :total-pages="noteTotalPages" :pet-id="appointment.petId" full-record-label="完整病歷" fill class="h-full" @load="loadNotes" @saved="handleHistoricalNoteSaved" />
        </div>
      </div>
    </div>

    <footer class="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-sunken px-6 py-3">
      <p class="text-sm text-muted-foreground" role="status">{{ !state.started && appointment.status === 'arrived' ? '尚未開始看診，可以先看資料' : savedLabel }}</p>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <!-- 送 IDEXX：按下去才把貓咪送到 IDEXX 主機的待驗清單（報到不自動送，不是每次看診都驗血）。
             跟其他動作放同一排，不用捲動就按得到；伺服器沒開這個功能就不出現。 -->
        <template v-if="labRequest.enabled.value && canRequestLab(appointment)">
          <template v-if="appointment.labRequestedAt">
            <Badge v-if="labRequestDelivered(appointment)" variant="status" class="bg-info-surface text-info"><FlaskConical class="size-4" stroke-width="1.75" aria-hidden="true" />已送 IDEXX <span class="num">{{ clinicTimeInput(appointment.labRequestedAt) }}</span></Badge>
            <Badge v-else variant="status" class="bg-warning-surface text-warning"><FlaskConical class="size-4" stroke-width="1.75" aria-hidden="true" />尚未送到 IDEXX</Badge>
            <Button variant="secondary" :disabled="labRequest.busy.value" @click="toggleLabRequest(false)">取消送 IDEXX</Button>
          </template>
          <Button v-else variant="soft" :disabled="labRequest.busy.value" @click="toggleLabRequest(true)"><FlaskConical stroke-width="1.75" />送 IDEXX</Button>
        </template>
        <Button variant="soft" :disabled="busy || (!appointment.recordId && !editable)" @click="appointment.recordId ? emit('open-record', appointment) : run('record')"><FileText stroke-width="1.75" />{{ appointment.recordId ? '開啟健檢報告' : '建立健檢報告' }}</Button>
        <Button v-if="state.completed" variant="secondary" :disabled="busy || !!appointment.reopenRequest?.requestedAt" @click="openReopenRequest">
          {{ appointment.reopenRequest?.requestedAt ? '已申請修改' : '申請修改' }}
        </Button>
        <Button v-else-if="state.handedOff" :disabled="busy" @click="run('reclaim')"><Undo2 stroke-width="1.75" />取回修改</Button>
        <Button v-else-if="appointment.status === 'arrived' && !state.started" :disabled="busy" @click="emit('start', appointment)"><Stethoscope stroke-width="1.75" />開始看診</Button>
        <template v-else-if="editable">
          <!-- 按錯貓、或看到一半飼主離開：退回候診，櫃台才能取消報到。已經寫的內容留著。 -->
          <Button variant="secondary" :disabled="busy" @click="run('unstart')"><Undo2 stroke-width="1.75" />取消看診</Button>
          <Button :disabled="busy || !!conflicts.length" @click="run('handoff')">完成看診，送交櫃台<ArrowRight stroke-width="1.75" /></Button>
        </template>
      </div>
    </footer>

    <Dialog :open="reopenDialog" @update:open="(value) => (reopenDialog = value)">
      <DialogContent size="sm">
        <form class="flex flex-col" @submit.prevent="requestReopen">
          <DialogHeader>
            <DialogTitle>申請修改</DialogTitle>
            <DialogDescription>櫃台核准後才能修改這筆看診。</DialogDescription>
          </DialogHeader>
          <div class="space-y-3 px-6 pb-5">
            <div class="space-y-1.5">
              <Label for="reopen-reason">修改原因</Label>
              <Textarea id="reopen-reason" v-model="reopenReason" rows="4" maxlength="500" autofocus placeholder="例如：補充用藥、修正看診紀錄" />
            </div>
            <Alert v-if="reopenError" variant="destructive"><AlertDescription>{{ reopenError }}</AlertDescription></Alert>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" @click="reopenDialog = false">取消</Button>
            <Button type="submit" :disabled="busy">送出申請</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>
</template>
