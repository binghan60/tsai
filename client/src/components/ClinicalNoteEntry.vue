<script setup>
import { computed, reactive, ref } from 'vue'
import { Pencil } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { clinicDateInput, formatDate } from '../lib/datetime'
import {
  journalDateEditable,
  journalEditable,
  journalEditError,
  journalEditFields,
  journalEditForm,
  journalEditNotice,
  journalEditPayload,
  journalKind,
  journalKindLabel,
  journalRows,
} from '../lib/clinicalNoteDisplay'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { DatePicker } from './ui/date-picker'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'

// 一則病歷日誌，排成一張小報告：標頭（日期、類型、進度）＋「標籤｜內容」列。
// 掛號與藥單日誌依後端回傳的分欄 sections 分列，每一欄都能就地修改並寫回來源（掛號／藥單）；
// 手動與舊系統匯入的日誌是自由文字，整段顯示、整段修改。
// 標頭右側的 actions slot 給使用端放額外按鈕（例如寵物詳情頁的刪除）。
const props = defineProps({
  note: { type: Object, required: true },
  // 內文區額外的 class（例如寵物詳情頁長日誌右側有浮動導航鈕，要讓出空間；只縮內文，標頭底色維持滿版）
  bodyClass: { type: [String, Array, Object], default: '' },
})

const emit = defineEmits(['saved'])
const toast = useToast()

const kind = computed(() => journalKind(props.note))
const rows = computed(() => journalRows(props.note))
const editable = computed(() => journalEditable(props.note))

const editing = ref(false)
const saving = ref(false)
const serverError = ref('')
const form = reactive({})
const entryDate = ref('')

const fields = computed(() => journalEditFields(props.note))
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
    const body = { ...journalEditPayload(props.note, form) }
    if (journalDateEditable(props.note) && entryDate.value) body.entryDate = entryDate.value
    const { data } = await http.put(`/clinical-notes/${props.note._id}`, body)
    editing.value = false
    toast.success('已更新病歷日誌')
    emit('saved', { note: props.note, updated: data, content: data?.content ?? '' })
  } catch (err) {
    serverError.value = err.response?.data?.message || '病歷日誌更新失敗，請重試。'
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
      <time class="text-sm font-semibold tabular-nums" :datetime="note.entryDate">{{ formatDate(note.entryDate) }}</time>
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
      <div
        v-for="field in fields"
        :key="field.key"
        :class="[ROW, field.tone === 'warning' ? 'bg-warning-surface' : '']"
      >
        <label :class="[LABEL, field.tone === 'warning' ? 'text-warning' : 'text-muted-foreground']" :for="`journal-${field.key}-${note._id}`">
          {{ field.label }}<span v-if="field.required" class="text-danger"> *</span>
        </label>
        <Textarea
          v-if="field.multiline"
          :id="`journal-${field.key}-${note._id}`"
          v-model="form[field.key]"
          :rows="field.rows"
          :maxlength="field.maxlength"
          :disabled="saving"
          class="bg-card"
        />
        <div v-else-if="field.numeric" class="flex items-center gap-2">
          <Input
            :id="`journal-${field.key}-${note._id}`"
            v-model="form[field.key]"
            type="number"
            min="0"
            :step="field.step"
            :disabled="saving"
            class="w-32 bg-card tabular-nums"
          />
          <span class="text-sm text-muted-foreground">{{ field.unit }}</span>
        </div>
        <Input v-else :id="`journal-${field.key}-${note._id}`" v-model="form[field.key]" :maxlength="field.maxlength" :disabled="saving" class="bg-card" />
      </div>
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
        <dd v-if="row.items" class="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span v-for="item in row.items" :key="item.key">
            <span class="mr-1.5 text-xs text-muted-foreground">{{ item.label }}</span>
            <span class="font-medium tabular-nums">{{ item.text }}</span>
          </span>
        </dd>
        <dd
          v-else
          class="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere"
          :class="[row.emphasis ? 'font-semibold' : '', row.tone === 'warning' ? 'text-warning' : '']"
        >{{ row.text }}</dd>
      </div>
      <div v-if="!rows.length" class="px-4 py-2.5 text-sm text-muted-foreground">（沒有內容）</div>
    </dl>

    <p v-else class="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere" :class="bodyClass"><slot name="content">{{ note.content }}</slot></p>
  </article>
</template>

