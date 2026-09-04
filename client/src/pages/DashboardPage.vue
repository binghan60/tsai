<script setup>
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, ArrowRight, CalendarCheck, ClipboardCheck, Clock3, MailWarning, PawPrint, UsersRound } from '@lucide/vue'
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
    error.value = '目前無法讀取總儀表板，請稍後再試。'
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
  { label: '今日預約', value: today.value.total ?? 0, detail: '所有登記個案', to: '/appointments', icon: CalendarCheck, tone: 'bg-accent text-accent-foreground' },
  { label: '候診中', value: today.value.arrived ?? 0, detail: '已報到、尚未完成', to: '/appointments', icon: Clock3, tone: 'bg-warning-surface text-warning' },
  { label: '已完成', value: today.value.completed ?? 0, detail: '今日已看診完成', to: '/appointments', icon: ClipboardCheck, tone: 'bg-success-surface text-success' },
  { label: '取消／未到', value: (today.value.cancelled ?? 0) + (today.value.no_show ?? 0), detail: '需留意爽約情況', to: '/appointments', icon: AlertTriangle, tone: 'bg-muted text-muted-foreground' },
])
const alerts = computed(() => [
  { label: '寄送異常', value: delivery.value.failed ?? 0, detail: '寄送失敗或結果待確認', to: '/records?view=failed', tone: 'text-danger' },
  { label: '待寄報告', value: delivery.value.pending ?? 0, detail: '已結案，尚未完成交付', to: '/records?view=pending', tone: 'text-warning' },
  { label: '逾一天草稿', value: delivery.value.overdueDraftCount ?? 0, detail: '超過 24 小時未完成', to: '/records?view=drafts', tone: 'text-foreground' },
])
const funnelData = computed(() => [
  { label: '預約', value: month.value.total ?? 0 },
  { label: '已報到', value: month.value.checkedIn ?? 0 },
  { label: '已完成', value: month.value.completed ?? 0 },
].filter((item) => item.value > 0))

onMounted(fetchDashboard)
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5 xl:flex xl:min-h-[calc(100vh-2.5rem)] xl:flex-col xl:space-y-3">
    <Alert v-if="error" variant="destructive">
      <AlertDescription class="flex items-center justify-between gap-3"><span>{{ error }}</span><Button type="button" variant="outline" size="sm" :disabled="loading" @click="fetchDashboard">重新整理</Button></AlertDescription>
    </Alert>
    <ListSkeleton v-if="loading && !dashboard" :rows="7" />

    <template v-else-if="dashboard">
      <div><h2 class="text-base font-semibold text-foreground">今日診所</h2><p class="mt-0.5 text-sm text-muted-foreground xl:hidden">先看現場人流與看診進度。</p></div>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:gap-2">
        <router-link v-for="item in todayCards" :key="item.label" :to="item.to" class="group rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/45 hover:bg-muted/30 dark:shadow-none xl:flex xl:items-center xl:gap-3 xl:p-3">
          <div class="flex items-start justify-between gap-3 xl:contents"><span class="flex h-10 w-10 items-center justify-center rounded-lg xl:h-9 xl:w-9 xl:shrink-0" :class="item.tone"><component :is="item.icon" class="h-5 w-5" /></span><ArrowRight class="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 xl:hidden" /></div>
          <div class="xl:min-w-0 xl:flex-1">
            <p class="mt-6 text-4xl font-semibold leading-none tabular-nums text-foreground xl:mt-0 xl:text-xl">{{ item.value }}</p><p class="mt-3 text-sm font-medium text-foreground xl:mt-0.5 xl:text-xs">{{ item.label }}</p>
          </div>
          <p class="mt-1 text-xs text-muted-foreground xl:hidden">{{ item.detail }}</p>
        </router-link>
      </div>

      <Card v-if="alerts.some((item) => item.value)" class="border-warning/35 bg-warning-surface/45 shadow-sm dark:shadow-none">
        <CardContent class="grid gap-3 p-4 md:grid-cols-3 xl:gap-2 xl:p-2.5"><router-link v-for="item in alerts" :key="item.label" :to="item.to" class="flex items-center gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-card/60"><span class="text-2xl font-semibold tabular-nums xl:text-lg" :class="item.tone">{{ item.value }}</span><span class="min-w-0 flex-1"><span class="block text-sm font-medium text-foreground">{{ item.label }}</span><span class="block truncate text-xs text-muted-foreground xl:hidden">{{ item.detail }}</span></span><ArrowRight class="h-4 w-4 shrink-0 text-muted-foreground" /></router-link></CardContent>
      </Card>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:flex-1 xl:gap-3">
        <Card class="shadow-sm dark:shadow-none xl:gap-2 xl:py-3"><CardHeader class="xl:px-4"><CardTitle>本月服務量</CardTitle><CardDescription class="xl:hidden">近 8 週健檢／就診紀錄趨勢。</CardDescription></CardHeader><CardContent class="xl:flex xl:flex-1 xl:flex-col xl:px-4"><div class="mb-2 flex items-end justify-between gap-4 xl:mb-1 xl:shrink-0"><div><p class="text-3xl font-semibold tabular-nums text-foreground xl:text-xl">{{ dashboard.monthlyReportCount }}</p><p class="mt-1 text-sm text-muted-foreground">本月健檢／就診紀錄</p></div><span class="rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">{{ changeLabel(dashboard.monthlyReportCount, dashboard.previousMonthlyReportCount) }}</span></div><div class="h-[260px] w-full xl:h-auto xl:flex-1"><TechLineChart :data="dashboard.weeklyTrend ?? []" label="每週健檢／就診紀錄" /></div></CardContent></Card>

        <Card class="shadow-sm dark:shadow-none xl:gap-2 xl:py-3">
          <CardHeader class="xl:px-4"><CardTitle>本月概況</CardTitle><CardDescription class="xl:hidden">轉換漏斗、客戶成長與服務交付。</CardDescription></CardHeader>
          <CardContent class="space-y-4 xl:flex xl:flex-1 xl:flex-col xl:space-y-3 xl:px-4">
            <div class="xl:flex xl:flex-1 xl:flex-col">
              <p class="text-xs font-medium text-muted-foreground xl:shrink-0">預約轉換</p>
              <div v-if="funnelData.length" class="mt-1 h-[120px] w-full xl:mt-1 xl:h-auto xl:flex-1">
                <TechFunnelChart :data="funnelData" />
                <ul class="sr-only"><li v-for="item in funnelData" :key="item.label">{{ item.label }}：{{ item.value }} 筆</li></ul>
              </div>
              <p v-else class="mt-1 flex h-[120px] items-center text-sm text-muted-foreground xl:h-auto xl:flex-1">本月尚無預約資料</p>
              <p class="mt-1 text-xs text-muted-foreground xl:shrink-0">取消／未到：<span class="font-medium tabular-nums text-warning">{{ month.cancelledOrNoShow ?? 0 }}</span> 筆</p>
            </div>
            <div class="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm xl:shrink-0">
              <div><p class="text-lg font-semibold tabular-nums">{{ dashboard.monthlyNewOwnerCount }}</p><p class="text-xs text-muted-foreground">本月新增飼主</p></div>
              <div><p class="text-lg font-semibold tabular-nums">{{ dashboard.monthlyNewPetCount }}</p><p class="text-xs text-muted-foreground">本月新增寵物</p></div>
              <router-link to="/pets" class="flex items-center gap-1.5 text-xs text-primary hover:underline"><UsersRound class="h-3.5 w-3.5" />累計 {{ dashboard.ownerCount }} 位飼主</router-link>
              <router-link to="/pets" class="flex items-center gap-1.5 text-xs text-primary hover:underline"><PawPrint class="h-3.5 w-3.5" />累計 {{ dashboard.petCount }} 隻寵物</router-link>
            </div>
            <div class="grid grid-cols-3 gap-2 border-t border-border pt-3 text-sm xl:shrink-0">
              <div><p class="text-lg font-semibold tabular-nums text-success">{{ delivery.sent ?? 0 }}</p><p class="text-xs text-muted-foreground">已寄送</p></div>
              <div><p class="text-lg font-semibold tabular-nums text-warning">{{ delivery.pending ?? 0 }}</p><p class="text-xs text-muted-foreground">待完成交付</p></div>
              <div><p class="text-lg font-semibold tabular-nums" :class="delivery.failed ? 'text-danger' : 'text-foreground'">{{ delivery.successRate === null ? '—' : `${delivery.successRate}%` }}</p><p class="text-xs text-muted-foreground">寄送成功率</p></div>
            </div>
            <router-link to="/records?view=pending" class="flex shrink-0 items-center justify-between border-t border-border pt-3 text-sm text-primary hover:underline"><span><MailWarning class="mr-1 inline h-4 w-4" />前往處理報告交付</span><ArrowRight class="h-4 w-4" /></router-link>
          </CardContent>
        </Card>
      </div>
    </template>
  </section>
</template>
