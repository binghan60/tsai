<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Stethoscope, Ticket, Undo2, X } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useClinicSync } from '../composables/useClinicSync'
import { useSearchQueryParam } from '../composables/useSearchQueryParam'
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier'
import { clinicDateInput, clinicTimeInput, shiftDateInput, weekdayLabel } from '../lib/datetime'
import { workflowFilter, workflowState } from '../../../shared/appointmentWorkflow.js'
import { usePinnedPetsStore } from '../stores/pinnedPets'
import VisitWorkspace from '../components/VisitWorkspace.vue'
import PinnedPetsList from '../components/PinnedPetsList.vue'
import EmptyState from '../components/EmptyState.vue'
import ListSkeleton from '../components/ListSkeleton.vue'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { DatePicker } from '../components/ui/date-picker'

// 醫師診療台：左欄是今日病患（手上的、候診、今日排程），右欄是可以同時開好幾筆的就診工作區。
// 刻意不做成「點一筆就換頁」——醫師手上常常同時有好幾隻動物在跑（等一隻的檢驗結果
// 時先看下一隻），換頁或 Modal 都會擋住這種來回切換。
//
// 左欄每一筆都直接列出來院原因與寵物／飼主備註：醫師看今天的排程是為了先準備器材，
// 「會咬人」「飼主很難溝通」要在叫進診間之前就知道，不能藏在點開之後。
const router = useRouter()
const toast = useToast()
const notifyChat = useAppointmentNotifier()
const pinnedPets = usePinnedPetsStore()
const today = clinicDateInput()
const date = useSearchQueryParam('date', today)

const items = ref([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const templates = ref([])
// 寵物／飼主備註存在主檔上，列表 API 另外回一份以 id 為鍵的對照表（見 routes/appointments.js）。
const patientNotes = ref({ pets: {}, owners: {} })
// 各工作區回報的「有未儲存內容」，佇列上顯示藍點。
const dirtyIds = reactive({})
// 同時開著的病患，順序就是「我手上的」的順序，各自的未儲存輸入留在各自的工作區元件裡。
//
// 存進 localStorage 是必要的：診間電腦被重新整理、當掉重開、或不小心關掉分頁時，
// 醫師手上那幾隻動物不能跟著消失——留在畫面上的工作區就是他的待辦清單。
// 綁 date 是因為換日期本來就會清空，隔天開機也不該還原昨天的病患。
const TABS_STORAGE_KEY = 'clinic.vetConsoleTabs'
function restoreTabs(forDate) {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || 'null')
    if (!saved || saved.date !== forDate) return { openIds: [], activeId: '', collapsedGroups: {} }
    return {
      openIds: Array.isArray(saved.openIds) ? saved.openIds.map(String) : [],
      activeId: String(saved.activeId || ''),
      collapsedGroups: saved.collapsedGroups && typeof saved.collapsedGroups === 'object' ? saved.collapsedGroups : {},
    }
  } catch {
    return { openIds: [], activeId: '', collapsedGroups: {} }
  }
}
const restored = restoreTabs(date.value)
const openIds = ref(restored.openIds)
const activeId = ref(restored.activeId)
// 最下面三個參考用的群組預設收起；使用者展開過就記住。
const collapsedGroups = ref({ pinned: true, handoff: true, completed: true, ...restored.collapsedGroups })
const now = ref(Date.now())
let clock
let request = 0

const byId = computed(() => new Map(items.value.map((item) => [String(item._id), item])))
const openTabs = computed(() => openIds.value.map((id) => byId.value.get(id)).filter(Boolean))
const active = computed(() => byId.value.get(activeId.value) || null)
const isOpen = (item) => openIds.value.includes(String(item._id))
const waiting = computed(() => queue('waiting').filter((item) => !isOpen(item)))
const visitingElsewhere = computed(() => queue('visiting').filter((item) => !isOpen(item)))
const scheduled = computed(() => items.value.filter((item) => workflowFilter(item, 'scheduled') && !isOpen(item)).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)))
const handedOff = computed(() => queue('handoff').filter((item) => !isOpen(item)))
const finished = computed(() => queue('completed').filter((item) => !isOpen(item)))
const onsiteCount = computed(() => items.value.filter((item) => workflowFilter(item, 'onsite') || workflowFilter(item, 'handoff')).length)
const scheduledCount = computed(() => items.value.filter((item) => workflowFilter(item, 'scheduled')).length)

const mainGroups = computed(() => [
  { key: 'mine', label: '我手上的', list: openTabs.value },
  { key: 'waiting', label: '候診中', list: waiting.value },
  { key: 'visiting', label: '看診中（未開啟）', list: visitingElsewhere.value, hideWhenEmpty: true },
  { key: 'scheduled', label: '今日排程 · 待報到', list: scheduled.value, hint: '依時段' },
])

function toggleGroup(key) {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
}

function queue(filter) {
  return items.value.filter((item) => workflowFilter(item, filter)).sort((a, b) => new Date(a.checkedInAt || a.scheduledAt) - new Date(b.checkedInAt || b.scheduledAt))
}

function minutesSince(value) {
  if (!value) return null
  return Math.max(0, Math.floor((now.value - new Date(value).getTime()) / 60000))
}
function latenessLabel(appointment) {
  return appointment.latenessMinutes > 0 ? `遲到 ${appointment.latenessMinutes} 分` : ''
}
function statusMeta(item) {
  const state = workflowState(item)
  if (state.completed) return '已完成'
  if (state.handedOff) return '已交櫃台'
  if (state.started) return `看診 ${minutesSince(item.visitStartedAt)} 分`
  if (item.status === 'arrived') return item.checkedInAt ? `已等 ${minutesSince(item.checkedInAt)} 分` : '候診中'
  if (item.status === 'scheduled') return item.time ? `${item.time} 掛號` : '未報到'
  return ''
}
function notesFor(item) {
  return [
    { key: 'pet', label: '寵物', text: item.petId ? patientNotes.value.pets[String(item.petId)] : '' },
    { key: 'owner', label: '飼主', text: item.ownerId ? patientNotes.value.owners[String(item.ownerId)] : '' },
  ].filter((note) => note.text)
}

async function refresh() {
  const token = ++request
  const requested = date.value
  try {
    const { data } = await http.get('/appointments', { params: { date: requested } })
    if (token !== request) return
    items.value = data.items || []
    patientNotes.value = { pets: data.patientNotes?.pets || {}, owners: data.patientNotes?.owners || {} }
    error.value = ''
    // 已經不存在的病患（換日期、被刪除）自動關掉，避免停在一筆看不到的病患上。
    openIds.value = openIds.value.filter((id) => items.value.some((item) => String(item._id) === id))
    if (!openIds.value.includes(activeId.value)) activeId.value = openIds.value.at(-1) || ''
  } catch {
    if (token === request) error.value = '資料更新失敗，請重新載入；目前顯示的可能不是最新進度。'
  } finally {
    if (token === request) loading.value = false
  }
}

function applyUpdate(item) {
  if (item.date !== date.value) {
    items.value = items.value.filter((p) => String(p._id) !== String(item._id))
    return
  }
  const index = items.value.findIndex((p) => String(p._id) === String(item._id))
  if (index < 0) items.value.push(item)
  // __v 只會往前走；比目前手上的舊就是遲到的廣播，丟掉。
  else if ((item.__v ?? 0) >= (items.value[index].__v ?? 0)) items.value[index] = item
}

const { connected } = useClinicSync(date, refresh, applyUpdate)

// 重新整理要回到原本開著的那幾筆，所以每次開關／切換都寫回去。
watch(
  [openIds, activeId, collapsedGroups, date],
  () => {
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ date: date.value, openIds: openIds.value, activeId: activeId.value, collapsedGroups: collapsedGroups.value }))
    } catch {
      /* 無痕視窗或停用儲存時就只是不還原，不影響看診。 */
    }
  },
  { deep: true },
)

watch(date, () => {
  loading.value = true
  items.value = []
  openIds.value = []
  activeId.value = ''
  refresh()
})

// 點卡片只開啟工作區（可以先看資料）；真正開始看診要按「看診」／「開始看診」。
function openPatient(appointment) {
  const id = String(appointment._id)
  if (!openIds.value.includes(id)) openIds.value.push(id)
  activeId.value = id
}

async function startVisit(appointment) {
  if (busy.value || appointment.visitStartedAt || appointment.handoffAt || appointment.deskCompletedAt) return
  busy.value = true
  try {
    const { data } = await http.post(`/appointments/${appointment._id}/workflow/start`, { version: appointment.__v ?? 0 })
    applyUpdate(data)
    openPatient(data)
    toast.success('已開始看診')
  } catch (err) {
    toast.error(err.response?.data?.message || '開始看診失敗，請稍後重試')
  } finally {
    busy.value = false
  }
}

function closeTab(id) {
  // 工作區卸載時不會替你存檔；自動儲存只要 1.2 秒，等它存完再關。
  if (dirtyIds[id]) {
    toast.error('這筆還有內容正在儲存，請稍候再關閉')
    return
  }
  openIds.value = openIds.value.filter((item) => item !== id)
  if (activeId.value === id) activeId.value = openIds.value.at(-1) || ''
}

function onWorkspaceUpdate(appointment, action) {
  applyUpdate(appointment)
  if (action === 'handoff') {
    notifyChat(appointment, 'handoff')
    toast.success('已送交櫃台')
    closeTab(String(appointment._id))
  } else if (action === 'reclaim') {
    notifyChat(appointment, 'reclaim')
    toast.success('已取回，可以繼續修改')
  }
}

function onDirty(id, value) {
  if (value) dirtyIds[id] = true
  else delete dirtyIds[id]
}

function onNotesUpdated({ kind, id, notes }) {
  const bucket = kind === 'pet' ? 'pets' : 'owners'
  const next = { ...patientNotes.value[bucket] }
  if (notes.trim()) next[id] = notes.trim()
  else delete next[id]
  patientNotes.value = { ...patientNotes.value, [bucket]: next }
}

async function reclaim(appointment) {
  if (busy.value) return
  busy.value = true
  try {
    const { data } = await http.post(`/appointments/${appointment._id}/workflow/reclaim`, { version: appointment.__v ?? 0 })
    applyUpdate(data)
    notifyChat(data, 'reclaim')
    openPatient(data)
  } catch (err) {
    toast.error(err.response?.data?.message || '取回失敗，請稍後重試')
  } finally {
    busy.value = false
  }
}

async function loadTemplates() {
  try {
    const { data } = await http.get('/settings/form-templates')
    templates.value = data
  } catch {
    /* 表單選項只影響「建立正式表單」，載不到不擋看診。 */
  }
}

onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30000)
  loadTemplates()
  refresh()
})
onBeforeUnmount(() => {
  request += 1
  clearInterval(clock)
})
</script>

<template>
  <div class="flex flex-col gap-3 xl:h-[calc(100dvh-2.5rem)]">
    <header class="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold">醫師診療台</h1>
        <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{{ date }}（{{ weekdayLabel(date) }}）<template v-if="date === today"> · 現在 {{ clinicTimeInput(new Date(now)) }}</template></span>
          <span class="inline-flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full" :class="connected ? 'bg-success' : 'bg-warning'"></span>{{ connected ? '即時同步' : '重新連線中' }}</span>
        </p>
      </div>
      <div class="ml-auto flex items-center gap-1">
        <Button variant="secondary" size="icon-sm" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft class="h-4 w-4" /></Button>
        <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-40" />
        <Button variant="secondary" size="icon-sm" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight class="h-4 w-4" /></Button>
        <Button variant="secondary" size="sm" :disabled="date === today" @click="date = today">今天</Button>
      </div>
    </header>

    <Alert v-if="error" variant="destructive" class="flex items-center justify-between gap-3">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button variant="secondary" size="sm" @click="refresh"><RefreshCw class="h-4 w-4" />重試</Button>
    </Alert>

    <div class="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
      <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card xl:w-100 xl:shrink-0" aria-label="今日病患">
        <header class="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <h2 class="text-base font-semibold">今日病患</h2>
          <span class="ml-auto inline-flex h-6 items-center rounded-full bg-accent px-3 text-xs font-medium leading-none text-accent-foreground">在院 {{ onsiteCount }} · 待到 {{ scheduledCount }}</span>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
          <ListSkeleton v-if="loading" :rows="4" />
          <template v-else>
            <template v-for="group in mainGroups" :key="group.key">
              <div v-if="group.list.length || !group.hideWhenEmpty" class="pt-2">
                <p class="flex items-center gap-2 px-1.5 pb-1.5 text-xs font-semibold text-muted-foreground">
                  {{ group.label }}<span class="font-normal">{{ group.list.length }}</span><span v-if="group.hint" class="ml-auto font-normal">{{ group.hint }}</span>
                </p>
                <p v-if="!group.list.length" class="px-1.5 pb-1 text-xs text-muted-foreground">{{ group.key === 'mine' ? '點下面任一位病患開啟工作區' : '目前沒有' }}</p>
                <article
                  v-for="item in group.list"
                  :key="item._id"
                  class="mb-2 cursor-pointer rounded-xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  :class="String(item._id) === activeId ? 'border-primary bg-accent' : 'border-border bg-card hover:bg-field'"
                  role="button"
                  tabindex="0"
                  :aria-label="`開啟 ${item.petName}`"
                  @click="openPatient(item)"
                  @keydown.enter.self.prevent="openPatient(item)"
                  @keydown.space.self.prevent="openPatient(item)"
                >
                  <div class="flex items-start gap-2.5">
                    <span v-if="group.key === 'scheduled'" class="w-11 shrink-0 pt-0.5 text-sm font-semibold tabular-nums">{{ item.time || '未定' }}</span>
                    <span v-else-if="item.checkinNumber != null" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums" :class="workflowState(item).started ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'">{{ item.checkinNumber }}</span>
                    <span v-else class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground" title="未取號"><Ticket class="h-4 w-4" /><span class="sr-only">未取號</span></span>

                    <div class="min-w-0 flex-1 space-y-1">
                      <div class="flex items-center gap-1.5">
                        <span class="truncate text-sm font-semibold" :class="String(item._id) === activeId ? 'text-accent-foreground' : ''">{{ item.petName }}</span>
                        <span class="shrink-0 text-xs text-muted-foreground">{{ [item.species, item.visitType === 'new' ? '初診' : item.visitType === 'return' ? '回診' : ''].filter(Boolean).join(' · ') }}</span>
                        <span v-if="group.key !== 'scheduled'" class="ml-auto shrink-0 text-xs text-muted-foreground">{{ statusMeta(item) }}</span>
                        <span v-if="dirtyIds[String(item._id)]" class="h-2 w-2 shrink-0 rounded-full bg-primary" title="有尚未儲存的內容"><span class="sr-only">有尚未儲存的內容</span></span>
                      </div>
                      <p class="text-sm font-medium leading-snug" :class="item.reason ? 'text-foreground' : 'text-muted-foreground'">{{ item.reason || '未填來院原因' }}</p>
                      <p v-if="item.isSurgery || latenessLabel(item)" class="text-xs font-semibold text-danger">
                        <template v-if="item.isSurgery">手術{{ item.surgeryName ? '：' + item.surgeryName : '' }}</template><template v-if="item.isSurgery && latenessLabel(item)"> · </template>{{ latenessLabel(item) }}
                      </p>
                      <p v-for="note in notesFor(item)" :key="note.key" class="line-clamp-2 whitespace-pre-wrap wrap-anywhere rounded-md bg-warning-surface px-2 py-1 text-xs font-medium text-warning" :title="note.text">
                        <span class="font-semibold">{{ note.label }}：</span>{{ note.text }}
                      </p>
                      <p v-if="item.internalNote" class="line-clamp-1 text-xs text-muted-foreground" :title="item.internalNote"><span class="font-medium text-foreground">掛號備註：</span>{{ item.internalNote }}</p>
                    </div>

                    <Button v-if="group.key === 'waiting'" size="xs" class="shrink-0" :disabled="busy" @click.stop="startVisit(item)"><Stethoscope class="h-4 w-4" />看診</Button>
                    <Button v-else-if="group.key === 'mine'" variant="secondary" size="icon-xs" class="shrink-0" :aria-label="`關閉 ${item.petName}`" @click.stop="closeTab(String(item._id))"><X class="h-3.5 w-3.5" /></Button>
                  </div>
                </article>
              </div>
            </template>

            <!-- 參考用的三組收在最下面：暫存區、已交櫃台（可取回）、今日已完成。 -->
            <div class="mt-2 space-y-1.5 border-t border-border pt-2">
              <template v-for="group in [
                { key: 'pinned', label: '暫存區', count: pinnedPets.items.length },
                { key: 'handoff', label: '已交櫃台', count: handedOff.length },
                { key: 'completed', label: '今日已完成', count: finished.length },
              ]" :key="group.key">
                <button type="button" class="flex min-h-10 w-full items-center gap-2 rounded-lg bg-field px-3 text-left text-sm hover:bg-muted" :aria-expanded="!collapsedGroups[group.key]" @click="toggleGroup(group.key)">
                  <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform" :class="collapsedGroups[group.key] ? '-rotate-90' : ''" />
                  {{ group.label }}<span class="font-semibold tabular-nums">{{ group.count }}</span>
                </button>
                <div v-if="!collapsedGroups[group.key]" class="px-1 pb-1">
                  <PinnedPetsList v-if="group.key === 'pinned'" />
                  <template v-else>
                    <p v-if="!group.count" class="px-2 py-2 text-xs text-muted-foreground">目前沒有</p>
                    <div v-for="item in group.key === 'handoff' ? handedOff : finished" :key="item._id" class="flex min-h-10 items-center gap-2 rounded-lg px-2 hover:bg-field">
                      <button type="button" class="min-w-0 flex-1 truncate bg-transparent text-left text-sm font-medium text-primary" @click="openPatient(item)">{{ item.petName }}<span class="ml-2 text-xs font-normal text-muted-foreground">{{ item.reason }}</span></button>
                      <Button v-if="group.key === 'handoff'" variant="secondary" size="xs" :disabled="busy" @click="reclaim(item)"><Undo2 class="h-4 w-4" />取回</Button>
                      <span v-else-if="latenessLabel(item)" class="shrink-0 text-xs font-medium text-danger">{{ latenessLabel(item) }}</span>
                    </div>
                  </template>
                </div>
              </template>
            </div>
          </template>
        </div>
      </section>

      <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="看診工作區">
        <!-- 每個開著的病患各自掛一個工作區並用 v-show 切換，不是共用一個再換 props——
             元件被銷毀重建就等於把還沒存檔的輸入丟掉，那正是要避免的事。 -->
        <VisitWorkspace
          v-for="tab in openTabs"
          v-show="String(tab._id) === activeId"
          :key="tab._id"
          class="min-h-0 flex-1"
          :appointment="tab"
          :templates="templates"
          @updated="onWorkspaceUpdate"
          @start="startVisit"
          @close="closeTab(String(tab._id))"
          @dirty="onDirty"
          @notes-updated="onNotesUpdated"
          @open-record="(appointment) => router.push({ path: `/records/${appointment.recordId}/edit`, query: { visit: appointment._id, visitDate: appointment.date } })"
        />
        <EmptyState v-if="!active && !loading" :icon="CalendarClock" title="從左邊選一位病患" description="點卡片可以先看資料，按「看診」才會記錄開始時間。可以同時開好幾位，切換不會清空已輸入的內容。" inset />
      </section>
    </div>
  </div>
</template>
