<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import SurgeryBadge from './SurgeryBadge.vue'
import LatenessBadge from './LatenessBadge.vue'
import CheckinNumber from './CheckinNumber.vue'
import { visitTypeLabel } from '../lib/appointmentDisplay'
import { ArrowRight, ChevronDown, FileText, Pencil, Stethoscope, Undo2, X } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier'
import { useTextTemplates } from '../composables/useTextTemplates'
import { workflowState } from '../../../shared/appointmentWorkflow.js'
import { clinicalDraft, draftPatch, mergeClinicalUpdate } from '../lib/visitDraft'
import { ageLabel, clinicTimeInput } from '../lib/datetime'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import AppointmentMilestones from './AppointmentMilestones.vue'
import ClinicalNotesPanel from './ClinicalNotesPanel.vue'
import MechanismTooltip from './MechanismTooltip.vue'
import ModalDialog from './ModalDialog.vue'
import { Button } from './ui/button'
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import RichText from './RichText.vue'
import RichTextEditor from './RichTextEditor.vue'
import { richTextToPlain } from '../../../shared/richText.js'
import { Alert, AlertDescription } from './ui/alert'

// 就診工作區：在診療台右欄編輯單筆 appointment 的臨床欄位。
// 這裡會同步病患資料、歷次病歷日誌與表單草稿入口。
const props = defineProps({
  appointment: { type: Object, required: true },
})
const toast = useToast()
const notifyChat = useAppointmentNotifier()
const { openPicker } = useTextTemplates()
// start：還沒開始看診時按「開始看診」；close：從佇列關掉這筆；dirty：有沒有未存內容（佇列顯示藍點）；
// notes-updated：寵物／飼主備註改了，讓佇列上的備註標籤跟著更新。
const emit = defineEmits(['updated', 'open-record', 'start', 'close', 'dirty', 'notes-updated'])

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
const notes = ref([])
const notePage = ref(1)
const noteTotalPages = ref(1)
const notesLoading = ref(false)
const notesError = ref('')
let notesRequest = 0
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
const ownerFields = computed(() => {
  const data = owner.value
  const phone = data?.phone || props.appointment.ownerPhone || ''
  return [
    { label: '姓名', value: data?.name || props.appointment.ownerName || '' },
    { label: '手機', value: phone, class: phone ? 'tabular-nums' : '' },
    { label: '市話', value: data?.landline || '', class: data?.landline ? 'tabular-nums' : '' },
    { label: 'Email', value: data?.email || '', class: data?.email ? 'break-all' : '' },
    { label: '地址', value: data?.address || '' },
  ].filter((field) => field.value)
})
const petSummary = computed(() => {
  if (!pet.value) return props.appointment.species || ''
  const sex = { male: '公', female: '母' }[pet.value.sex] || ''
  const neutered = { yes: '已結紮', no: '未結紮' }[pet.value.neutered] || ''
  return [pet.value.breed || props.appointment.species, sex && neutered ? `${sex} ${neutered}` : sex || neutered, ageLabel(pet.value.birthDate, new Date(), '')].filter(Boolean).join(' · ')
})
// 醫療警示與一般紀錄分級：藥物過敏最高（實心紅）、病史次之（紅框），疫苗／健檢只是參考（灰）。
// 舊版四項同一個警示色排成一格一格，「對某藥過敏」跟「去年健檢過」看起來一樣重。
const medicalTags = computed(() => {
  if (!pet.value) return []
  const tags = []
  if (pet.value.allergyStatus === 'yes') tags.push({ key: 'allergy', label: `藥物過敏：${pet.value.allergyType || '有（未註明藥物）'}`, class: 'bg-danger-surface font-semibold text-danger' })
  const history = [pet.value.medicalHistory?.join('、'), pet.value.medicalHistoryOther].filter(Boolean).join('；')
  if (history) tags.push({ key: 'history', label: `病史：${history}`, class: 'bg-card text-danger ring-1 ring-inset ring-danger/60' })
  if (pet.value.allergyStatus === 'none') tags.push({ key: 'no-allergy', label: '無藥物過敏', class: 'bg-muted text-muted-foreground' })
  if (pet.value.vaccineStatus) tags.push({ key: 'vaccine', label: pet.value.vaccineStatus === 'done' ? `疫苗 ${pet.value.vaccineDate || '已注射'}` : '未注射疫苗', class: 'bg-muted text-muted-foreground' })
  if (pet.value.checkupStatus) tags.push({ key: 'checkup', label: pet.value.checkupStatus === 'done' ? `健檢 ${pet.value.checkupDate || '有'}` : '未健檢', class: 'bg-muted text-muted-foreground' })
  return tags
})

// 文字模板：三個文字欄各一顆按鈕，key 用 visit: 前綴（後端 /text-templates/fields 也認得）。
// 有選取範圍就取代選取，沒有就插在游標處；欄位是空的就直接放進去。
const TEMPLATE_FIELDS = {
  visitNote: { key: 'visit:visitNote', label: '本次簡易紀錄' },
  handoffNote: { key: 'visit:handoffNote', label: '給櫃台的交辦' },
  specialCareNote: { key: 'visit:specialCareNote', label: '請轉告飼主' },
}
function textareaId(field) {
  return `visit-${field}-${props.appointment._id}`
}
// 本次簡易紀錄是可上色的編輯器，游標與選取由編輯器自己記著，插入直接交給它；
// 文字模板本身是純文字，「存成模板」也只存純文字。
const visitNoteEditor = ref(null)
function openTemplates(field) {
  const meta = TEMPLATE_FIELDS[field]
  if (field === 'visitNote') {
    openPicker({
      itemKey: meta.key,
      label: meta.label,
      currentText: richTextToPlain(draft.visitNote),
      onInsert: (template, mode) => visitNoteEditor.value?.insertText(template.content, mode),
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
      if (mode === 'replace' || !base) {
        draft[field] = template.content
        return
      }
      const start = Math.min(selection?.start ?? base.length, base.length)
      const end = Math.min(selection?.end ?? start, base.length)
      draft[field] = `${base.slice(0, start)}${template.content}${base.slice(end)}`
    },
  })
}

const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 30000)
const timing = computed(() => {
  const parts = []
  if (props.appointment.checkedInAt) parts.push(`${clinicTimeInput(props.appointment.checkedInAt)} 報到`)
  if (props.appointment.visitStartedAt && !state.value.handedOff) parts.push(`看診 ${Math.max(0, Math.floor((now.value - new Date(props.appointment.visitStartedAt).getTime()) / 60000))} 分`)
  return parts.join(' · ')
})
const CONFLICT_LABELS = {
  visitNote: '本次簡易紀錄',
  internalNote: '內部備註',
  handoffNote: '給櫃台的交辦',
  specialCareNote: '請轉告飼主',
  followUpRecommendation: '回診建議',
  followUpReason: '回診原因',
  weightKg: '體重',
  temperatureC: '體溫',
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
    toast.success('已更新病患備註')
  } catch (err) {
    petNoteError.value = err.response?.status === 409
      ? '病患資料已由其他人更新，請重新載入後再修改。'
      : err.response?.data?.message || '病患備註儲存失敗，請重試。'
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
    ownerNoteError.value = err.response?.status === 409 ? '飼主資料已由其他人更新，請重新載入後再修改。' : err.response?.data?.message || '飼主備註儲存失敗，請重試。'
  } finally {
    ownerNoteSaving.value = false
  }
}
async function loadNotes(page = 1) {
  const token = ++notesRequest
  const petId = props.appointment.petId
  notes.value = []
  if (!petId) return
  notesLoading.value = true
  notesError.value = ''
  try {
    const { data } = await http.get(`/pets/${petId}/clinical-notes`, {
      params: { page, limit: 5, excludeAppointmentId: props.appointment._id },
    })
    if (disposed || token !== notesRequest || petId !== props.appointment.petId) return
    const totalPages = data.totalPages || 1
    if (page > totalPages) return await loadNotes(totalPages)
    notes.value = data.items || []
    notePage.value = page
    noteTotalPages.value = totalPages
  } catch {
    if (!disposed && token === notesRequest) notesError.value = '病歷日誌未能載入，請重試。'
  } finally {
    if (token === notesRequest) notesLoading.value = false
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
      error.value = err.response?.data?.message || '儲存失敗，請重試。'
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

watch(dirty, (value) => emit('dirty', String(props.appointment._id), value), { immediate: true })

function resolveConflict(keepLocal) {
  if (!keepLocal) for (const key of conflicts.value) draft[key] = baseline.value[key]
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
    error.value = err.response?.data?.message || '操作失敗，請重試。'
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
  emit('dirty', String(props.appointment._id), false)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <section class="flex min-h-0 flex-col" :aria-label="`${appointment.petName} 就診工作區`">
    <!-- 標頭跟內容一起捲動：標頭（備註、醫療警示）可能很高，固定住會把寫紀錄的空間壓得很小。
         只有底部的動作列固定，送交按鈕隨時按得到。 -->
    <div class="min-h-0 flex-1 overflow-y-auto">
    <header class="space-y-2.5 border-b border-border px-5 py-3">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <CheckinNumber :appointment="appointment" size="lg" />
        <h2 class="text-xl font-semibold">{{ appointment.petName }}</h2>
        <span v-if="petSummary || visitTypeLabel(appointment)" class="text-sm text-muted-foreground">{{ [petSummary, visitTypeLabel(appointment)].filter(Boolean).join(' · ') }}</span>
        <span class="text-sm text-muted-foreground">
          · 飼主 {{ owner?.name || appointment.ownerName || '待確認' }}<template v-if="owner?.phone || appointment.ownerPhone"> <span class="tabular-nums">{{ owner?.phone || appointment.ownerPhone }}</span></template>
        </span>
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="secondary" size="xs">飼主與進度<ChevronDown class="h-3.5 w-3.5" stroke-width="1.75" /></Button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-96 space-y-3 p-4">
            <dl v-if="ownerFields.length" class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div v-for="field in ownerFields" :key="field.label" class="min-w-0">
                <dt class="font-semibold text-muted-foreground">{{ field.label }}</dt>
                <dd class="mt-0.5 font-medium text-foreground" :class="field.class">{{ field.value }}</dd>
              </div>
            </dl>
            <p v-else class="text-sm text-muted-foreground">未提供飼主資料</p>
            <AppointmentMilestones :appointment="appointment" />
          </PopoverContent>
        </Popover>
        <span class="ml-auto text-xs text-muted-foreground">{{ timing }}</span>
        <Button variant="secondary" size="icon-sm" :aria-label="`關閉 ${appointment.petName} 的工作區`" @click="emit('close')"><X class="h-4 w-4" /></Button>
      </div>

      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span class="text-xs text-muted-foreground">來院原因</span>
        <span class="text-base font-semibold" :class="appointment.reason ? '' : 'text-muted-foreground'">{{ appointment.reason || '掛號時沒有填寫' }}</span>
        <SurgeryBadge v-if="appointment.isSurgery" :name="appointment.surgeryName" class="self-center" />
        <LatenessBadge :minutes="appointment.latenessMinutes" class="self-center" />
      </div>

      <div v-if="medicalTags.length" class="flex flex-wrap gap-2">
        <span v-for="tag in medicalTags" :key="tag.key" class="inline-flex min-h-7 items-center rounded-full px-3 text-xs leading-snug" :class="tag.class">{{ tag.label }}</span>
      </div>

      <!-- 寵物與飼主備註：會咬人、飼主難溝通這類事要在叫進診間前就看到，所以常駐顯示、不收合。 -->
      <div v-if="pet" class="grid gap-2 lg:grid-cols-2">
        <div class="min-w-0 rounded-lg px-3 py-2" :class="pet.notes || editingPetNote ? 'bg-warning-surface text-warning' : 'bg-field text-muted-foreground'">
          <div class="flex items-start gap-3">
            <span class="shrink-0 pt-0.5 text-xs font-semibold">寵物備註</span>
            <Textarea v-if="editingPetNote" v-model="petNoteDraft" class="min-w-0 flex-1 bg-card text-foreground" rows="2" maxlength="2000" :disabled="petNoteSaving" aria-label="寵物備註" placeholder="例：會咬人，保定需兩人" />
            <p v-else class="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-sm" :class="pet.notes ? 'font-medium' : ''">{{ pet.notes || '尚無備註' }}</p>
            <Button v-if="!editingPetNote" variant="secondary" size="xs" class="shrink-0" @click="startPetNoteEdit"><Pencil class="h-3.5 w-3.5" />編輯</Button>
          </div>
          <Alert v-if="petNoteError" variant="destructive" class="mt-2"><AlertDescription>{{ petNoteError }}</AlertDescription></Alert>
          <div v-if="editingPetNote" class="mt-2 flex justify-end gap-2">
            <Button variant="secondary" size="xs" :disabled="petNoteSaving" @click="cancelPetNoteEdit">取消</Button>
            <Button size="xs" :disabled="petNoteSaving" @click="savePetNote">{{ petNoteSaving ? '儲存中…' : '儲存備註' }}</Button>
          </div>
        </div>
        <div class="min-w-0 rounded-lg px-3 py-2" :class="owner?.notes || editingOwnerNote ? 'bg-warning-surface text-warning' : 'bg-field text-muted-foreground'">
          <div class="flex items-start gap-3">
            <span class="shrink-0 pt-0.5 text-xs font-semibold">飼主備註</span>
            <Textarea v-if="editingOwnerNote" v-model="ownerNoteDraft" class="min-w-0 flex-1 bg-card text-foreground" rows="2" maxlength="2000" :disabled="ownerNoteSaving" aria-label="飼主備註" placeholder="例：處置前先說明費用" />
            <p v-else class="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-sm" :class="owner?.notes ? 'font-medium' : ''">{{ owner ? owner.notes || '尚無備註' : '未提供飼主資料' }}</p>
            <Button v-if="owner && !editingOwnerNote" variant="secondary" size="xs" class="shrink-0" @click="startOwnerNoteEdit"><Pencil class="h-3.5 w-3.5" />編輯</Button>
          </div>
          <Alert v-if="ownerNoteError" variant="destructive" class="mt-2"><AlertDescription>{{ ownerNoteError }}</AlertDescription></Alert>
          <div v-if="editingOwnerNote" class="mt-2 flex justify-end gap-2">
            <Button variant="secondary" size="xs" :disabled="ownerNoteSaving" @click="cancelOwnerNoteEdit">取消</Button>
            <Button size="xs" :disabled="ownerNoteSaving" @click="saveOwnerNote">{{ ownerNoteSaving ? '儲存中…' : '儲存備註' }}</Button>
          </div>
        </div>
      </div>
    </header>

    <div v-if="error || contextError || conflicts.length" class="max-h-72 shrink-0 space-y-3 overflow-y-auto border-b border-border px-5 py-3">
      <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <div v-if="contextError" class="flex items-center gap-3 rounded-lg bg-warning-surface p-3 text-sm text-warning">
        <span class="flex-1">{{ contextError }}</span>
        <Button variant="secondary" size="xs" @click="loadContext">重新載入</Button>
      </div>
      <div v-if="conflicts.length" role="alert" class="space-y-3 rounded-xl bg-warning-surface p-4 text-sm text-warning">
        <p>此筆就診資料與其他更新衝突：{{ conflicts.map((key) => CONFLICT_LABELS[key]).join('、') }}。請選擇要保留的內容。</p>
        <div v-for="key in conflicts" :key="key" class="rounded-lg bg-card p-3 text-foreground">
          <p class="text-xs font-medium text-muted-foreground">{{ CONFLICT_LABELS[key] }} · 目前內容</p>
          <RichText v-if="key === 'visitNote' && baseline[key]" class="mt-1 text-sm" :text="baseline[key]" />
          <p v-else class="mt-1 whitespace-pre-wrap text-sm">{{ baseline[key] || '（空白）' }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" @click="resolveConflict(false)">使用目前內容</Button>
          <Button variant="secondary" size="sm" @click="resolveConflict(true)">保留我的修改</Button>
        </div>
      </div>
    </div>

    <!-- 看診紀錄與交辦在同一頁：左欄由上而下是紀錄 → 交給櫃台，右欄是歷次病歷日誌。
         早期拆成兩步，第二步左邊只是把紀錄再唯讀顯示一次；交辦區改成緊接在紀錄下方、
         用標題與分隔線獨立出來，寫完紀錄往下就會經過，不必多一次換頁。
         兩欄按 65:35 分配而不是把日誌欄寫死寬度：收合側邊欄多出來的寬度要兩欄一起分，
         不然全被紀錄欄吃掉、日誌欄動也不動。日誌欄保底 20rem，窄螢幕上報告卡才不會被擠爛。 -->
    <div class="grid xl:grid-cols-[minmax(0,65fr)_minmax(20rem,35fr)]">
      <div class="flex flex-col gap-4 p-5">
        <div class="grid grid-cols-2 gap-3">
          <label class="space-y-1.5 text-xs font-medium"
            ><span class="flex items-center gap-1.5">體重（kg）<MechanismTooltip text="儲存後會顯示在這次就診的引用式病歷日誌；若已建立健檢草稿，也會同步更新該草稿的體重。" /></span>
            <Input v-model="draft.weightKg" type="number" min="0" step="0.01" :disabled="!editable || committing" />
          </label>
          <label class="space-y-1.5 text-xs font-medium"
            ><span class="flex items-center gap-1.5">體溫（°C）<MechanismTooltip text="儲存後會顯示在這次就診的引用式病歷日誌；若已建立健檢草稿，也會同步更新該草稿的體溫。" /></span>
            <Input v-model="draft.temperatureC" type="number" min="0" step="0.1" :disabled="!editable || committing" />
          </label>
        </div>
        <!-- 用 div 不用 label：label 會把點擊轉給裡面第一個可點的元素，也就是編輯器工具列的粗體鈕。 -->
        <div class="space-y-1.5">
          <span class="flex items-center gap-2 text-xs font-medium">本次簡易紀錄<MechanismTooltip text="此內容與櫃台共用，病歷日誌只保留對本次就診的引用，因此在任一處修改都會立即反映最新內容。" /><span class="ml-auto font-normal text-muted-foreground">自動存入病歷日誌</span></span>
          <RichTextEditor ref="visitNoteEditor" :id="textareaId('visitNote')" v-model="draft.visitNote" aria-label="本次簡易紀錄" :min-rows="8" :disabled="!editable || committing" placeholder="輸入本次看診紀錄…">
            <template v-if="editable" #toolbar-end>
              <Button type="button" variant="secondary" size="icon-xs" class="size-8" aria-label="插入本次簡易紀錄的文字模板" title="文字模板" :disabled="committing" @mousedown.prevent @click="openTemplates('visitNote')"><FileText class="h-3.5 w-3.5" stroke-width="1.75" /></Button>
            </template>
          </RichTextEditor>
        </div>
        <label class="block space-y-1.5">
          <span class="flex items-center gap-2 text-xs font-medium">內部備註<MechanismTooltip text="僅供內部人員查看；儲存後會附在本次就診的引用式病歷日誌最後，不會出現在飼主報告。" /><span class="ml-auto font-normal text-muted-foreground">僅院內可見</span></span>
          <Textarea v-model="draft.internalNote" rows="3" maxlength="2000" class="field-sizing-fixed" :disabled="!editable || committing" placeholder="輸入僅供內部人員查看的備註…" />
        </label>

        <section class="space-y-4 border-t border-border pt-4" aria-labelledby="handoff-heading">
          <h3 id="handoff-heading" class="text-base font-semibold">交給櫃台</h3>
          <label class="block space-y-1.5">
            <span class="flex items-center gap-2 text-xs font-medium">給櫃台的交辦<span class="font-normal text-muted-foreground">收費、領藥、要開的證明</span></span>
            <span class="relative block">
              <Textarea :id="textareaId('handoffNote')" v-model="draft.handoffNote" rows="4" maxlength="1000" class="field-sizing-fixed pr-10" :disabled="!editable || committing" placeholder="輸入櫃台需要協助處理的事項…" />
              <Button v-if="editable" type="button" variant="secondary" size="icon-xs" class="absolute right-2 top-2" aria-label="插入給櫃台交辦的文字模板" title="文字模板" :disabled="committing" @click="openTemplates('handoffNote')"><FileText class="h-3.5 w-3.5" stroke-width="1.75" /></Button>
            </span>
          </label>
          <div class="grid gap-4 lg:grid-cols-2">
            <label class="block space-y-1.5">
              <span class="text-xs font-medium text-warning">請轉告飼主</span>
              <span class="relative block">
                <Textarea :id="textareaId('specialCareNote')" v-model="draft.specialCareNote" rows="4" maxlength="500" class="field-sizing-fixed pr-10" :disabled="!editable || committing" placeholder="輸入需要櫃台轉告飼主的提醒…" />
                <Button v-if="editable" type="button" variant="secondary" size="icon-xs" class="absolute right-2 top-2" aria-label="插入請轉告飼主的文字模板" title="文字模板" :disabled="committing" @click="openTemplates('specialCareNote')"><FileText class="h-3.5 w-3.5" stroke-width="1.75" /></Button>
              </span>
            </label>
            <label class="block space-y-1.5">
              <span class="flex items-center gap-1.5 text-xs font-medium">回診建議<MechanismTooltip text="這是給櫃台安排回診時看的建議文字；填寫本身不會自動建立掛號。" /></span>
              <Textarea v-model="draft.followUpRecommendation" rows="4" maxlength="500" class="field-sizing-fixed" :disabled="!editable || committing" placeholder="輸入建議回診時間或原因…" />
            </label>
          </div>
        </section>
      </div>
      <!-- 病歷日誌自己捲動，並在往下捲時黏在頂端，寫到交辦區時仍看得到歷次紀錄。 -->
      <div class="h-[32rem] p-5 xl:sticky xl:top-0 xl:h-[calc(100dvh-11rem)] xl:self-start xl:pl-0">
        <ClinicalNotesPanel :notes="notes" :loading="notesLoading" :error="notesError" :page="notePage" :total-pages="noteTotalPages" :pet-id="appointment.petId" full-record-label="完整病歷" fill class="h-full" @load="loadNotes" @saved="handleHistoricalNoteSaved" />
      </div>
    </div>
    </div>

    <footer class="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-field/40 px-5 py-3">
      <p class="text-xs text-muted-foreground" role="status">{{ !state.started && appointment.status === 'arrived' ? '尚未開始看診，可以先看資料' : savedLabel }}</p>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="secondary" :disabled="busy || (!appointment.recordId && !editable)" @click="appointment.recordId ? emit('open-record', appointment) : run('record')"><FileText class="h-4 w-4" />{{ appointment.recordId ? '開啟表單草稿' : '建立表單草稿' }}</Button>
        <MechanismTooltip label="查看表單草稿連動說明" text="首次建立時會帶入本次的來院原因、體重、體溫及已安排的回診時間。其後在此更新體重或體溫，也會同步到尚未結案的草稿。" />
        <Button v-if="state.completed" variant="secondary" :disabled="busy || !!appointment.reopenRequest?.requestedAt" @click="openReopenRequest">
          {{ appointment.reopenRequest?.requestedAt ? '已申請修改' : '申請修改' }}
        </Button>
        <Button v-else-if="state.handedOff" variant="secondary" :disabled="busy" @click="run('reclaim')"><Undo2 class="h-4 w-4" />取回修改</Button>
        <Button v-else-if="appointment.status === 'arrived' && !state.started" size="lg" :disabled="busy" @click="emit('start', appointment)"><Stethoscope class="h-4 w-4" />開始看診</Button>
        <Button v-else-if="editable" size="lg" :disabled="busy || !!conflicts.length" @click="run('handoff')">完成看診，送交櫃台<ArrowRight class="h-4 w-4" /></Button>
      </div>
    </footer>

    <ModalDialog v-if="reopenDialog" size="sm" @close="reopenDialog = false">
      <form class="flex flex-col" @submit.prevent="requestReopen">
        <div class="space-y-4 p-6 sm:p-7">
          <div>
            <DialogTitle>申請修改</DialogTitle>
            <DialogDescription class="mt-1 text-xs">可補充需要更正或重新處理的原因；櫃台核准後才能修改此筆就診。</DialogDescription>
          </div>
          <label class="block space-y-1.5">
            <span class="text-xs font-medium">修改原因（選填）</span>
            <Textarea v-model="reopenReason" rows="4" maxlength="500" autofocus placeholder="例如：補充用藥交辦、修正看診紀錄…" />
          </label>
          <Alert v-if="reopenError" variant="destructive"><AlertDescription>{{ reopenError }}</AlertDescription></Alert>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" @click="reopenDialog = false">取消</Button>
          <Button type="submit" :disabled="busy">送出申請</Button>
        </DialogFooter>
      </form>
    </ModalDialog>
  </section>
</template>
