<script setup>
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, ArrowRight, CalendarCheck, Cat, ClipboardCheck, Clock3, MailWarning, UsersRound } from '@lucide/vue'
import { clinicDateInput, weekdayLabel } from '../lib/datetime'
import { http } from '../api/http'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import ListSkeleton from '../components/ListSkeleton.vue'
import PageHeader from '../components/PageHeader.vue'
import TechLineChart from '../components/charts/TechLineChart.vue'
import TechFunnelChart from '../components/charts/TechFunnelChart.vue'

const loading = ref(true)
const error = ref('')
const dashboard = ref(null)

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

function changeLabel(current, previous) {
  if (!previous) return current ? '本月新增' : '尚無資料'
  const percent = Math.round(((current - previous) / previous) * 100)
  return `${percent >= 0 ? '+' : ''}${percent}% 較上月`
}

const today = computed(() => dashboard.value?.today ?? {})
const month = computed(() => dashboard.value?.monthlyAppointments ?? {})
const delivery = computed(() => dashboard.value?.delivery ?? {})
const todayCards = computed(() => [
  // 每一格都點得進掛號台對應的那一段（?stage= 是掛號台流程列的篩選）。
  { label: '今日預約', value: today.value.total ?? 0, detail: '所有登記的掛號', to: '/reception', icon: CalendarCheck, tone: 'bg-accent text-accent-foreground' },
  { label: '在院', value: today.value.arrived ?? 0, detail: '已報到、還沒完成', to: '/reception?stage=onsite', icon: Clock3, tone: 'bg-warning-surface text-warning' },
  { label: '已完成', value: today.value.completed ?? 0, detail: '今天看完的', to: '/reception?stage=completed', icon: ClipboardCheck, tone: 'bg-success-surface text-success' },
  { label: '取消／未到', value: (today.value.cancelled ?? 0) + (today.value.no_show ?? 0), detail: '要留意爽約', to: '/reception', icon: AlertTriangle, tone: 'bg-sunken text-muted-foreground' },
])
const alerts = computed(() => [
  { label: '寄送異常', value: delivery.value.failed ?? 0, detail: '寄送失敗或結果待確認', to: '/records?view=failed', tone: 'text-danger' },
  { label: '待寄報告', value: delivery.value.pending ?? 0, detail: '已結案，尚未完成交付', to: '/records?view=pending', tone: 'text-warning' },
  { label: '逾一天草稿', value: delivery.value.overdueDraftCount ?? 0, detail: '超過 24 小時未完成', to: '/records?view=drafts', tone: 'text-foreground' },
])
const todayLabel = computed(() => {
  const date = clinicDateInput()
  return `${date.slice(5).replace('-', '/')}（${weekdayLabel(date)}）`
})
const funnelData = computed(() => [
  { label: '預約', value: month.value.total ?? 0 },
  { label: '已報到', value: month.value.checkedIn ?? 0 },
  { label: '已完成', value: month.value.completed ?? 0 },
].filter((item) => item.value > 0))

onMounted(fetchDashboard)
</script>

<template>
  <section class="flex flex-col gap-5 xl:min-h-[calc(100vh-2.5rem)]">
    <PageHeader title="總覽">
      <template #meta><span class="num text-lg text-subtle-foreground">{{ todayLabel }}</span></template>
    </PageHeader>

    <Alert v-if="error" variant="destructive">
      <AlertDescription class="flex items-center justify-between gap-3"><span>{{ error }}</span><Button type="button" variant="secondary" size="sm" :disabled="loading" @click="fetchDashboard">重新整理</Button></AlertDescription>
    </Alert>
    <ListSkeleton v-if="loading && !dashboard" :rows="7" />

    <template v-else-if="dashboard">
      <!-- 現在：今天的人流。每一格都點得進對應的清單。 -->
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <router-link v-for="item in todayCards" :key="item.label" :to="item.to" class="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-card transition-colors hover:border-primary/45">
          <span class="flex size-12 shrink-0 items-center justify-center rounded-xl" :class="item.tone"><component :is="item.icon" class="size-6" stroke-width="1.75" /></span>
          <span class="min-w-0 flex-1">
            <span class="num block text-xl leading-none font-semibold">{{ item.value }}</span>
            <span class="mt-1.5 block font-semibold">{{ item.label }}</span>
            <span class="block truncate text-sm text-muted-foreground">{{ item.detail }}</span>
          </span>
          <ArrowRight class="size-5 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" stroke-width="1.75" />
        </router-link>
      </div>

      <!-- 報告交付的例外：有才出現。 -->
      <div v-if="alerts.some((item) => item.value)" class="grid gap-3 md:grid-cols-3">
        <router-link v-for="item in alerts.filter((alert) => alert.value)" :key="item.label" :to="item.to" class="flex items-center gap-3 rounded-xl bg-warning-surface px-4 py-3 transition-colors hover:bg-warning/15">
          <span class="num text-xl font-semibold" :class="item.tone">{{ item.value }}</span>
          <span class="min-w-0 flex-1"><span class="block font-semibold text-foreground">{{ item.label }}</span><span class="block truncate text-sm text-muted-foreground">{{ item.detail }}</span></span>
          <ArrowRight class="size-5 shrink-0 text-subtle-foreground" stroke-width="1.75" />
        </router-link>
      </div>

      <div class="grid gap-4 xl:flex-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card class="xl:gap-2">
          <CardHeader>
            <CardTitle>本月健檢報告</CardTitle>
            <CardDescription>近 8 週每週的健檢報告數</CardDescription>
          </CardHeader>
          <CardContent class="xl:flex xl:flex-1 xl:flex-col">
            <div class="mb-3 flex items-end justify-between gap-4">
              <router-link to="/records?view=all" class="group">
                <span class="num block text-xl font-semibold group-hover:text-primary">{{ dashboard.monthlyReportCount }}</span>
                <span class="text-sm text-muted-foreground">本月健檢報告</span>
              </router-link>
              <span class="rounded-full bg-accent px-3 py-1 text-sm font-semibold text-accent-foreground">{{ changeLabel(dashboard.monthlyReportCount, dashboard.previousMonthlyReportCount) }}</span>
            </div>
            <div class="h-[260px] w-full xl:h-auto xl:flex-1"><TechLineChart :data="dashboard.weeklyTrend ?? []" label="每週健檢報告" /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>本月概況</CardTitle></CardHeader>
          <CardContent class="space-y-5 xl:flex xl:flex-1 xl:flex-col">
            <div class="xl:flex xl:flex-1 xl:flex-col">
              <p class="spec-label">掛號轉換</p>
              <div v-if="funnelData.length" class="mt-1 h-[120px] w-full xl:h-auto xl:flex-1">
                <TechFunnelChart :data="funnelData" />
                <ul class="sr-only"><li v-for="item in funnelData" :key="item.label">{{ item.label }}：{{ item.value }} 筆</li></ul>
              </div>
              <p v-else class="mt-1 flex h-[120px] items-center text-muted-foreground xl:h-auto xl:flex-1">本月還沒有掛號資料</p>
              <p class="mt-1 text-sm text-muted-foreground">取消／未到 <span class="num font-semibold text-warning">{{ month.cancelledOrNoShow ?? 0 }}</span> 筆</p>
            </div>
            <div class="grid grid-cols-2 gap-3 border-t border-border pt-4">
              <router-link to="/pets" class="group"><span class="num block text-lg font-semibold group-hover:text-primary">{{ dashboard.monthlyNewOwnerCount }}</span><span class="text-sm text-muted-foreground">本月新增飼主</span></router-link>
              <router-link to="/pets" class="group"><span class="num block text-lg font-semibold group-hover:text-primary">{{ dashboard.monthlyNewPetCount }}</span><span class="text-sm text-muted-foreground">本月新增貓咪</span></router-link>
              <router-link to="/pets" class="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><UsersRound class="size-4" stroke-width="1.75" />累計 <span class="num">{{ dashboard.ownerCount }}</span> 位飼主</router-link>
              <router-link to="/pets" class="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><Cat class="size-4" stroke-width="1.75" />累計 <span class="num">{{ dashboard.petCount }}</span> 隻貓咪</router-link>
            </div>
            <div class="grid grid-cols-3 gap-3 border-t border-border pt-4">
              <router-link to="/records?view=sent" class="group"><span class="num block text-lg font-semibold text-success">{{ delivery.sent ?? 0 }}</span><span class="text-sm text-muted-foreground group-hover:text-foreground">已寄送</span></router-link>
              <router-link to="/records?view=pending" class="group"><span class="num block text-lg font-semibold text-warning">{{ delivery.pending ?? 0 }}</span><span class="text-sm text-muted-foreground group-hover:text-foreground">待交付</span></router-link>
              <router-link to="/records/deliveries" class="group"><span class="num block text-lg font-semibold" :class="delivery.failed ? 'text-danger' : 'text-foreground'">{{ delivery.successRate === null ? '—' : `${delivery.successRate}%` }}</span><span class="text-sm text-muted-foreground group-hover:text-foreground">寄送成功率</span></router-link>
            </div>
            <router-link to="/records?view=pending" class="flex items-center justify-between border-t border-border pt-4 font-medium text-primary hover:underline"><span class="flex items-center gap-2"><MailWarning class="size-5" stroke-width="1.75" />處理報告交付</span><ArrowRight class="size-5" stroke-width="1.75" /></router-link>
          </CardContent>
        </Card>
      </div>
    </template>
  </section>
</template>
