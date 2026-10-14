<script setup>
import { apiErrorMessage } from '../lib/apiError'
import { computed, reactive, ref } from 'vue'
import { Pencil, Pill } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useStaffIdentity } from '../composables/useStaffIdentity'
import { clinicDateInput, shortDate } from '../lib/datetime'
import {
  journalDateEditable,
  journalEditable,
  journalEditError,
  journalEditLayout,
  journalEditForm,
  journalEditNotice,
  journalEditPayload,
  journalKind,
  journalKindLabel,
  journalRows,
  medicationStageTone,
} from '../lib/clinicalNoteDisplay'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { DatePicker } from './ui/date-picker'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import LabResultGroups from './LabResultGroups.vue'
import ClinicalNoteRowValue from './ClinicalNoteRowValue.vue'
import DeskItemsChecklist from './DeskItemsChecklist.vue'
import RichTextEditor from './RichTextEditor.vue'
import DrugSuggestEditor from './DrugSuggestEditor.vue'

// 一則病歷日誌，排成一張小報告：標頭（日期、類型、進度）＋「標籤｜內容」列。
// 掛號與藥單日誌依後端回傳的分欄 sections 分列，每一欄都能就地修改並寫回來源（掛號／藥單）；
// 手動與舊系統匯入的日誌是自由文字，整段顯示、整段修改。
// 標頭右側的 actions slot 給使用端放額外按鈕（例如貓咪詳情頁的刪除）。
const props = defineProps({
  note: { type: Object, required: true },
  // 內文區額外的 class（例如貓咪詳情頁長日誌右側有浮動導航鈕，要讓出空間；只縮內文，標頭底色維持滿版）
  bodyClass: { type: [String, Array, Object], default: '' },
})

const emit = defineEmits(['saved'])
const toast = useToast()
const { identity } = useStaffIdentity()

const kind = computed(() => journalKind(props.note))
const rows = computed(() => journalRows(props.note))
const editable = computed(() => journalEditable(props.note))

const editing = ref(false)
const prescriptionEditor = ref(null)
const saving = ref(false)
const serverError = ref('')
const form = reactive({})
const entryDate = ref('')

const layout = computed(() => journalEditLayout(props.note))
// 連到這次看診的 IDEXX 結果：修改模式下可以改個別數值、或把整份移除（回到待確認清單）。
const labResults = computed(() => rows.value?.find((row) => row.results)?.results ?? [])
// IDEXX 表格在編輯版面的迴圈裡，ref 要用函式接，不然會變成陣列。
let labEditor = null
const setLabEditor = (el) => { labEditor = el }
const validation = computed(() => (editing.value ? journalEditError(props.note, form) : ''))
const notice = computed(() => journalEditNotice(props.note))

function startEdit() {
  for (const key of Object.keys(form)) delete form[key]
  Object.assign(form, journalEditForm(props.note))
  entryDate.value = clinicDateInput(props.note.entryDate) || ''
  serverError.value = ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  serverError.value = ''
}

async function save() {
  if (saving.value || validation.value) return
  saving.value = true
  serverError.value = ''
  try {
    // staff：在日誌上勾了「上傳影像」會新增待辦，待辦署名這台裝置的身分。
    const body = { ...journalEditPayload(props.note, form), staff: identity.value }
    if (journalDateEditable(props.note) && entryDate.value) body.entryDate = entryDate.value
    // 檢驗先送：最後那支日誌的 PUT 回來的內容才包含改過的檢驗。
    const lab = labEditor?.changes() ?? { removed: [], edits: [] }
    for (const { id, values } of lab.edits) await http.put(`/lab-results/${id}/values`, { values })
    for (const id of lab.removed) await http.post(`/lab-results/${id}/unmatch`)
    let data = null
    try {
      ({ data } = await http.put(`/clinical-notes/${props.note._id}`, body))
    } catch (err) {
      // 這則日誌只有檢驗、檢驗又全部移除了：日誌跟著消失，不算失敗。
      if (!(lab.removed.length && err?.response?.status === 404)) throw err
    }
    editing.value = false
    toast.success('已更新病歷日誌')
    emit('saved', { note: props.note, updated: data, content: data?.content ?? '' })
  } catch (err) {
    serverError.value = apiErrorMessage(err, '病歷日誌更新失敗，請重試。')
    toast.error(serverError.value)
  } finally {
    saving.value = false
  }
}

// 報告列：窄的時候標籤疊在內容上面，容器夠寬（@md）就變成左標籤右內容的兩欄。
const ROW = 'grid gap-1 px-4 py-2.5 @md:grid-cols-[6.5rem_minmax(0,1fr)] @md:gap-4'
const LABEL = 'text-xs font-medium @md:pt-0.5'

const kindBadgeClass = computed(() =>
  kind.value === 'appointment' ? 'bg-accent text-accent-foreground' : 'bg-muted text-foreground',
)
</script>

<template>
  <article class="@container overflow-hidden rounded-xl border border-border bg-card">
    <header class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/50 px-4 py-2">
      <time class="text-sm font-semibold tabular-nums" :datetime="note.entryDate">{{ shortDate(note.entryDate) }}</time>
      <Badge variant="status" :class="kindBadgeClass">{{ journalKindLabel(note) }}</Badge>
      <span v-if="note.stage" class="text-xs text-muted-foreground">{{ note.stage }}</span>
      <span class="ml-auto flex shrink-0 items-center gap-1">
        <Button v-if="editable && !editing" variant="secondary" size="xs" @click="startEdit"><Pencil class="h-3.5 w-3.5" stroke-width="1.75" />修改</Button>
        <slot v-if="!editing" name="actions" />
      </span>
    </header>

    <!-- 編輯：跟檢視同一套「標籤｜內容」列，改的就是眼前看到的那一格 -->
    <form v-if="editing" class="divide-y divide-border" @submit.prevent="save">
      <div v-if="journalDateEditable(note)" :class="ROW">
        <label :class="[LABEL, 'text-muted-foreground']" :for="`journal-date-${note._id}`">日期</label>
        <DatePicker :id="`journal-date-${note._id}`" v-model="entryDate" aria-label="日誌日期" class="w-44" :clearable="false" />
      </div>
      <template v-for="entry in layout" :key="entry.key">
        <div v-if="entry.type === 'field'" :class="[ROW, entry.field.tone === 'warning' ? 'bg-warning-surface' : '']">
          <label :class="[LABEL, entry.field.tone === 'warning' ? 'text-warning' : 'text-muted-foreground']" :for="`journal-${entry.key}-${note._id}`">
            {{ entry.field.label }}<span v-if="entry.field.required" class="text-danger"> *</span>
          </label>
          <div class="min-w-0 space-y-2">
            <!-- 藥單階段：放在內容區最上面，標籤欄只留標籤。 -->
            <div v-if="entry.row?.stage || entry.key === 'prescription'" class="flex flex-wrap items-center gap-1.5">
              <template v-if="entry.row?.stage"><Badge variant="status" :class="medicationStageTone(entry.row.medicationStatus)">{{ entry.row.stage }}</Badge><Badge v-if="entry.row.needsRepack" variant="status" class="bg-danger-surface text-danger">需重新包藥</Badge></template>
              <!-- 藥櫃鈕在這一列的右上角。 -->
              <Button v-if="entry.key === 'prescription'" type="button" variant="secondary" size="xs" class="ml-auto" :disabled="saving" @click="prescriptionEditor?.openPicker()"><Pill stroke-width="1.75" />藥櫃</Button>
            </div>
            <!-- 藥單欄位邊打邊跳藥櫃建議。 -->
            <component
              :is="entry.key === 'prescription' ? DrugSuggestEditor : RichTextEditor"
              :ref="(el) => { if (entry.key === 'prescription') prescriptionEditor = el }"
              v-if="entry.field.rich"
              :id="`journal-${entry.key}-${note._id}`"
              v-model="form[entry.key]"
              :aria-label="entry.field.label"
              :min-rows="entry.field.rows"
              :maxlength="entry.field.maxlength"
              :disabled="saving"
              class="bg-card"
            />
            <Textarea
              v-else-if="entry.field.multiline"
              :id="`journal-${entry.key}-${note._id}`"
              v-model="form[entry.key]"
              :rows="entry.field.rows"
              :maxlength="entry.field.maxlength"
              :disabled="saving"
              class="bg-card"
            />
            <Input v-else :id="`journal-${entry.key}-${note._id}`" v-model="form[entry.key]" :maxlength="entry.field.maxlength" :disabled="saving" class="bg-card" />
          </div>
        </div>
        <!-- 體重、體溫：檢視併成「生命徵象」一列，編輯也一列、兩格並排。 -->
        <div v-else-if="entry.type === 'vitals'" :class="ROW">
          <span :class="[LABEL, 'text-muted-foreground']">{{ entry.label }}</span>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div v-for="field in entry.fields" :key="field.key" class="flex items-center gap-2">
              <label class="text-xs text-muted-foreground" :for="`journal-${field.key}-${note._id}`">{{ field.label }}</label>
              <Input :id="`journal-${field.key}-${note._id}`" v-model="form[field.key]" type="text" inputmode="decimal" :disabled="saving" class="w-28 bg-card tabular-nums" />
              <span class="text-sm text-muted-foreground">{{ field.unit }}</span>
            </div>
          </div>
        </div>
        <!-- 櫃台處理：跟櫃台處理視窗同一組勾選框（影像、收據一次選一個）。 -->
        <div v-else-if="entry.type === 'desk'" :class="ROW">
          <span :class="[LABEL, 'text-muted-foreground']">{{ entry.label }}</span>
          <DeskItemsChecklist v-model:items="form.deskItems" v-model:image-upload="form.imageUpload" :id-prefix="`journal-desk-${note._id}`" :disabled="saving" />
        </div>
        <div v-else-if="entry.type === 'idexx'" :class="ROW">
          <span :class="[LABEL, 'text-muted-foreground']">{{ entry.label }}</span>
          <LabResultGroups :ref="setLabEditor" :results="labResults" :base-date="clinicDateInput(note.entryDate)" editable :disabled="saving" />
        </div>
        <!-- 改不到的列（檢驗、藥單、上傳影像）：原樣留在原位。 -->
        <div v-else :class="[ROW, entry.row.tone === 'warning' ? 'bg-warning-surface' : '']">
          <span :class="[LABEL, 'text-muted-foreground']">{{ entry.row.label }}</span>
          <ClinicalNoteRowValue :row="entry.row" :base-date="clinicDateInput(note.entryDate)" />
        </div>
      </template>
      <div class="space-y-3 px-4 py-3">
        <p v-if="notice" class="text-xs text-muted-foreground">{{ notice }}</p>
        <Alert v-if="serverError || validation" variant="destructive">
          <AlertDescription>{{ serverError || validation }}</AlertDescription>
        </Alert>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" :disabled="saving" @click="cancelEdit">取消</Button>
          <Button type="submit" size="sm" :disabled="saving || !!validation">{{ saving ? '儲存中…' : '儲存' }}</Button>
        </div>
      </div>
    </form>

    <dl v-else-if="rows" class="divide-y divide-border" :class="bodyClass">
      <div v-for="row in rows" :key="row.key" :class="[ROW, row.tone === 'warning' ? 'bg-warning-surface' : '']">
        <dt :class="[LABEL, row.tone === 'warning' ? 'text-warning' : 'text-muted-foreground']">{{ row.label }}</dt>
        <div class="min-w-0 space-y-1.5">
          <span v-if="row.stage" class="flex flex-wrap gap-1.5"><Badge variant="status" :class="medicationStageTone(row.medicationStatus)">{{ row.stage }}</Badge><Badge v-if="row.needsRepack" variant="status" class="bg-danger-surface text-danger">需重新包藥</Badge></span>
          <ClinicalNoteRowValue :row="row" :base-date="clinicDateInput(note.entryDate)" />
        </div>
      </div>
      <div v-if="!rows.length" class="px-4 py-2.5 text-sm text-muted-foreground">（沒有內容）</div>
    </dl>

    <p v-else class="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere" :class="bodyClass"><slot name="content">{{ note.content }}</slot></p>
  </article>
</template>

