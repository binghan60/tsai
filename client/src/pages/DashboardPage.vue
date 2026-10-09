<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import PatientLink from '../components/PatientLink.vue'
import { AlertTriangle, ArrowRight, ListTodo, Star } from '@lucide/vue'
import { clinicDateInput, clinicTimeInput, weekdayLabel } from '../lib/datetime'
import { DUE_TONE_CLASS, dueStatus } from '../lib/todoDisplay'
import { http } from '../api/http'
import { useTodosStore } from '../stores/todos'
import { useUtilityPanelStore } from '../stores/utilityPanel'
import { useStaffIdentity } from '../composables/useStaffIdentity'
import { useToast } from '../composables/useToast'
import { useClinicDateStore } from '../stores/clinicDate'
import { richTextToPlain } from '../../../shared/richText.js'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import EmptyState from '../components/EmptyState.vue'
import ListSkeleton from '../components/ListSkeleton.vue'
import PageHeader from '../components/PageHeader.vue'
import RichText from '../components/RichText.vue'

// 總覽（設計稿 R2-Dashboard）：由粗到細——寄送失敗橫幅（有才出現）→ 今天的門診四格 → 健檢報告四格
// → 近 8 週健檢量＋院內待辦。每一格都點得進對應的清單，數字口徑跟那份清單一致（後端 routes/dashboard.js）。
const loading = ref(true)
const error = ref('')
const dashboard = ref(null)
const todos = useTodosStore()
const panel = useUtilityPanelStore()
const { identity } = useStaffIdentity()
const toast = useToast()
// 這頁的數字都是今天的：從這裡點進掛號台、診療台要落在今天。
useClinicDateStore().reset()

async function fetchDashboard() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await http.get('/dashboard')
    dashboard.value = data
  } catch {
    error.value = '目前無法讀取總覽，請稍後再試。'
  } finally {
    loading.value = false
  }
}

// 頁首的時間：一分鐘更新一次就夠。
const now = ref(new Date())
let clock = null
onMounted(() => {
  fetchDashboard()
  if (!todos.loaded) todos.load()
  clock = setInterval(() => { now.value = new Date() }, 30_000)
})
onBeforeUnmount(() => clearInterval(clock))
const todayInput = computed(() => clinicDateInput(now.value))
const headerMeta = computed(() => {
  const [, month, day] = todayInput.value.split('-')
  return { time: clinicTimeInput(now.value), date: `${Number(month)} 月 ${Number(day)} 日 ${weekdayLabel(todayInput.value)}` }
})

const today = computed(() => dashboard.value?.today ?? {})
const reports = computed(() => dashboard.value?.reports ?? {})
const latestFailed = computed(() => dashboard.value?.latestFailed ?? null)

// 每格：標籤、數字、下面一行補充（多段用間距分開，不用分隔點）、要不要亮框。
const clinicCards = computed(() => [
  { label: '今日掛號', value: today.value.total ?? 0, details: [`上午 ${today.value.morning ?? 0}`, `下午 ${today.value.afternoon ?? 0}`], to: '/reception' },
  { label: '在院', value: today.value.onsite ?? 0, details: [`看診中 ${today.value.inVisit ?? 0}`, `候診 ${today.value.waiting ?? 0}`], to: '/reception?stage=onsite' },
  { label: '待櫃台處理', value: today.value.handoff ?? 0, details: ['飼主在櫃台等'], to: '/reception?stage=handoff', tone: 'warning' },
  { label: '已完成', value: today.value.completed ?? 0, details: [`待安排回診 ${today.value.followUpPending ?? 0}`], to: '/reception?stage=completed' },
])
const sentDelta = computed(() => {
  const delta = (reports.value.sentThisMonth ?? 0) - (reports.value.sentPreviousMonth ?? 0)
  return `比上月 ${delta >= 0 ? '+' : ''}${delta}`
})
const reportCards = computed(() => [
  { label: '草稿', value: reports.value.drafts ?? 0, details: [`超過一天 ${reports.value.overdueDrafts ?? 0}`], to: '/records?view=drafts' },
  { label: '待寄送', value: reports.value.pending ?? 0, details: ['結案了還沒寄'], to: '/records?view=pending' },
  { label: '寄送失敗', value: reports.value.failed ?? 0, details: ['需要重寄'], to: '/records?view=failed', tone: 'danger' },
  { label: '本月已寄出', value: reports.value.sentThisMonth ?? 0, details: [sentDelta.value], to: '/records?view=sent' },
])
// 有數字才亮框：待櫃台處理＝琥珀、寄送失敗＝紅。
const TONE = {
  // 用邊框＋一圈內側 ring 疊出 1.5px 的色框；不能用 box-shadow，會被卡片自己的 shadow-card 蓋掉。
  warning: { card: 'border-warning/50 ring-1 ring-inset ring-warning/25', value: 'text-warning' },
  danger: { card: 'border-danger/50 ring-1 ring-inset ring-danger/25', value: 'text-danger' },
}
const toneOf = (card) => (card.tone && card.value > 0 ? TONE[card.tone] : null)

const failedTarget = computed(() => ((reports.value.failed ?? 0) === 1 && latestFailed.value ? `/records/${latestFailed.value._id}/preview` : '/records?view=failed'))

// 近 8 週健檢量：單一序列的長條，只有最新一週標數字，其餘滑過看 tooltip（不用原生 title，
// 那個要停很久才出現、樣式也跟全站不一致），螢幕報讀器讀 sr-only 清單。
function monthDay(value) {
  const [, month, day] = clinicDateInput(value).split('-')
  return `${Number(month)}/${Number(day)}`
}
const weeks = computed(() => (dashboard.value?.weeklyTrend ?? []).map((week) => ({
  label: monthDay(week.weekStart),
  // weekEnd 是下一週的開頭（不含），往前 1 毫秒就是這週最後一天。
  range: `${monthDay(week.weekStart)}–${monthDay(new Date(new Date(week.weekEnd).getTime() - 1))}`,
  count: week.count ?? 0,
})))
const maxWeek = computed(() => Math.max(1, ...weeks.value.map((week) => week.count)))
const thisWeek = computed(() => weeks.value.at(-1)?.count ?? 0)

// 院內待辦：未完成的前幾筆（伺服器已排好：有期限的由早到晚，接著沒期限的）。
const openTodos = computed(() => todos.openItems.slice(0, 8))
const busyTodo = ref('')
async function completeTodo(item) {
  if (busyTodo.value) return
  busyTodo.value = item._id
  try {
    await todos.complete(item._id, identity.value)
  } catch {
    toast.error('操作失敗，請稍後再試')
  } finally {
    busyTodo.value = ''
  }
}
</script>

<template>
  <section class="flex flex-col gap-5 xl:min-h-[calc(100vh-2.5rem)]">
    <PageHeader title="總覽">
      <template #meta><span class="flex items-baseline gap-3 text-sm text-subtle-foreground"><span class="num">{{ headerMeta.time }}</span><span>{{ headerMeta.date }}</span></span></template>
      <template #actions>
        <Button as-child variant="soft"><router-link to="/reception">前往掛號台<ArrowRight stroke-width="1.75" /></router-link></Button>
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive">
      <AlertDescription class="flex items-center justify-between gap-3"><span>{{ error }}</span><Button type="button" variant="secondary" size="sm" :disabled="loading" @click="fetchDashboard">重新整理</Button></AlertDescription>
    </Alert>
    <ListSkeleton v-if="loading && !dashboard" :rows="7" />

    <template v-else-if="dashboard">
      <!-- 寄送失敗：有才出現，點名最近一份是哪隻、哪份、為什麼。 -->
      <div v-if="reports.failed" role="alert" class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-danger-surface px-4 py-2.5 text-danger">
        <AlertTriangle class="size-5 shrink-0" stroke-width="1.75" />
        <span class="font-semibold"><span class="num">{{ reports.failed }}</span> 份健檢報告寄送失敗</span>
        <span v-if="latestFailed" class="flex min-w-0 flex-wrap items-baseline gap-x-4 text-foreground">
          <PatientLink :pet-id="latestFailed.petId" quiet>{{ latestFailed.petName }}</PatientLink>
          <span v-if="latestFailed.error" class="min-w-0 truncate">{{ latestFailed.error }}</span>
        </span>
        <Button as-child variant="destructive" size="sm" class="ml-auto shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_35%,transparent)]">
          <router-link :to="failedTarget">查看並重寄<ArrowRight stroke-width="1.75" /></router-link>
        </Button>
      </div>

      <section v-for="group in [{ title: '今天的門診', link: '/reception', linkLabel: '掛號台', cards: clinicCards }, { title: '健檢報告', link: '/records', linkLabel: '全部報告', cards: reportCards }]" :key="group.title" class="flex flex-col gap-3" :aria-label="group.title">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold">{{ group.title }}</h2>
          <router-link :to="group.link" class="ml-auto text-sm font-semibold text-primary hover:underline">{{ group.linkLabel }}</router-link>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <router-link
            v-for="card in group.cards"
            :key="card.label"
            :to="card.to"
            class="group flex flex-col gap-1.5 rounded-xl border bg-card px-4 py-3.5 shadow-card transition-colors hover:border-primary/45"
            :class="toneOf(card)?.card ?? 'border-border'"
          >
            <span class="flex items-center gap-1.5">
              <span class="text-sm font-semibold text-muted-foreground">{{ card.label }}</span>
              <ArrowRight class="ml-auto size-4.5 text-subtle-foreground transition-transform group-hover:translate-x-0.5" stroke-width="1.75" />
            </span>
            <span class="num text-display font-semibold" :class="toneOf(card)?.value ?? 'text-foreground'">{{ card.value }}</span>
            <span class="flex flex-wrap gap-x-4 text-xs text-subtle-foreground"><span v-for="detail in card.details" :key="detail">{{ detail }}</span></span>
          </router-link>
        </div>
      </section>

      <div class="grid gap-3.5 xl:flex-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section class="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card px-4.5 py-4 shadow-card" aria-labelledby="dashboard-trend-title">
          <div class="flex items-baseline gap-2">
            <h3 id="dashboard-trend-title" class="text-base font-semibold">近 8 週健檢量</h3>
            <span class="text-xs text-subtle-foreground">本週 <span class="num">{{ thisWeek }}</span> 份</span>
          </div>
          <TooltipProvider :delay-duration="0" disable-hoverable-content>
            <div class="flex min-h-64 flex-1 items-end gap-1.5 border-b border-border-strong" aria-hidden="true">
              <Tooltip v-for="(week, index) in weeks" :key="week.label">
                <!-- 整欄都是觸發範圍（不只長條本身）：0 份那週只有 2px 高，只認長條會幾乎滑不到。 -->
                <TooltipTrigger as-child>
                  <div class="group flex h-full flex-1 cursor-default flex-col items-center justify-end gap-1.5 rounded-t-md transition-colors hover:bg-hover">
                    <span v-if="index === weeks.length - 1" class="num text-sm font-semibold">{{ week.count }}</span>
                    <!-- 0 也留 2px 的底：「這週是 0」跟「沒有這週」要看得出差別。 -->
                    <span class="block w-3/5 rounded-t-xs bg-chart-1 transition-colors group-hover:bg-primary" :style="{ height: `max(2px, ${(week.count / maxWeek) * 85}%)` }"></span>
                    <span class="num pb-1 text-2xs" :class="index === weeks.length - 1 ? 'font-semibold text-foreground' : 'text-subtle-foreground'">{{ week.label }}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" :side-offset="4">
                  <span class="num">{{ week.range }}</span><span class="font-semibold"><span class="num">{{ week.count }}</span> 份</span>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
          <ul class="sr-only"><li v-for="week in weeks" :key="week.label">{{ week.range }}：{{ week.count }} 份</li></ul>
        </section>

        <section class="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-4.5 py-4 shadow-card" aria-labelledby="dashboard-todo-title">
          <div class="flex items-center gap-2">
            <h3 id="dashboard-todo-title" class="text-base font-semibold">院內待辦</h3>
            <span class="num text-xs text-subtle-foreground">{{ todos.openCount }}</span>
            <button type="button" class="ml-auto text-sm font-semibold text-primary hover:underline" @click="panel.open('todos')">全部待辦</button>
          </div>
          <EmptyState v-if="todos.loaded && !openTodos.length" :icon="ListTodo" title="目前沒有未完成的待辦" description="從右側工具欄的「待辦」新增。" inset />
          <ul v-else>
            <li v-for="item in openTodos" :key="item._id" class="flex items-center gap-2.5 border-b border-border py-2">
              <!-- 這裡只列未完成的，勾下去就完成、從清單消失；樣子跟待辦面板的勾選框一致。 -->
              <Checkbox
                class="size-6 rounded-md"
                :model-value="false"
                :disabled="busyTodo === item._id"
                :aria-label="`完成：${richTextToPlain(item.content)}`"
                @update:model-value="completeTodo(item)"
              />
              <Star v-if="item.starred" class="size-4 shrink-0 fill-warning text-warning" stroke-width="1.75" role="img" aria-label="已置頂" />
              <button type="button" class="min-w-0 flex-1 text-left hover:text-primary" @click="panel.open('todos')"><RichText tag="span" one-line class="block" :text="item.content" v-tip.overflow="richTextToPlain(item.content)" /></button>
              <span v-if="dueStatus(item.dueDate, todayInput)" class="inline-flex h-6 shrink-0 items-center rounded-full px-2 text-2xs leading-none font-semibold" :class="DUE_TONE_CLASS[dueStatus(item.dueDate, todayInput).tone]">{{ dueStatus(item.dueDate, todayInput).label }}</span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </section>
</template>
