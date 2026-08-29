<script setup>
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, ArrowRight, CalendarCheck, ClipboardCheck, Clock3, MailWarning, PawPrint, UserRoundPlus, UsersRound } from '@lucide/vue'
import { http } from '../api/http'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import ListSkeleton from '../components/ListSkeleton.vue'
import PageHeader from '../components/PageHeader.vue'
import TechLineChart from '../components/charts/TechLineChart.vue'
import TechDonutChart from '../components/charts/TechDonutChart.vue'

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
  <section class="mx-auto max-w-7xl space-y-5">
    <Alert v-if="error" variant="destructive">
      <AlertDescription class="flex items-center justify-between gap-3"><span>{{ error }}</span><Button type="button" variant="outline" size="sm" :disabled="loading" @click="fetchDashboard">重新整理</Button></AlertDescription>
    </Alert>
    <ListSkeleton v-if="loading && !dashboard" :rows="7" />

    <template v-else-if="dashboard">
      <div><h2 class="text-base font-semibold text-foreground">今日診所</h2><p class="mt-0.5 text-sm text-muted-foreground">先看現場人流與看診進度。</p></div>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <router-link v-for="item in todayCards" :key="item.label" :to="item.to" class="group rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/45 hover:bg-muted/30 dark:shadow-none">
          <div class="flex items-start justify-between gap-3"><span class="flex h-10 w-10 items-center justify-center rounded-lg" :class="item.tone"><component :is="item.icon" class="h-5 w-5" /></span><ArrowRight class="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div>
          <p class="mt-6 text-4xl font-semibold leading-none tabular-nums text-foreground">{{ item.value }}</p><p class="mt-3 text-sm font-medium text-foreground">{{ item.label }}</p><p class="mt-1 text-xs text-muted-foreground">{{ item.detail }}</p>
        </router-link>
      </div>

      <Card v-if="alerts.some((item) => item.value)" class="border-warning/35 bg-warning-surface/45 shadow-sm dark:shadow-none">
        <CardContent class="grid gap-3 p-4 md:grid-cols-3"><router-link v-for="item in alerts" :key="item.label" :to="item.to" class="flex items-center gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-card/60"><span class="text-2xl font-semibold tabular-nums" :class="item.tone">{{ item.value }}</span><span class="min-w-0 flex-1"><span class="block text-sm font-medium text-foreground">{{ item.label }}</span><span class="block truncate text-xs text-muted-foreground">{{ item.detail }}</span></span><ArrowRight class="h-4 w-4 shrink-0 text-muted-foreground" /></router-link></CardContent>
      </Card>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card class="shadow-sm dark:shadow-none"><CardHeader><CardTitle>本月服務量</CardTitle><CardDescription>近 8 週健檢／就診紀錄趨勢。</CardDescription></CardHeader><CardContent><div class="mb-2 flex items-end justify-between gap-4"><div><p class="text-3xl font-semibold tabular-nums text-foreground">{{ dashboard.monthlyReportCount }}</p><p class="mt-1 text-sm text-muted-foreground">本月健檢／就診紀錄</p></div><span class="rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">{{ changeLabel(dashboard.monthlyReportCount, dashboard.previousMonthlyReportCount) }}</span></div><div class="h-[260px] w-full"><TechLineChart :data="dashboard.weeklyTrend ?? []" label="每週健檢／就診紀錄" /></div></CardContent></Card>
        <Card class="shadow-sm dark:shadow-none"><CardHeader><CardTitle>預約轉換</CardTitle><CardDescription>從預約到完成看診的本月漏斗。</CardDescription></CardHeader><CardContent><div v-if="funnelData.length" class="h-[240px] w-full"><TechDonutChart :data="funnelData" name="預約轉換" /></div><p v-else class="flex h-[240px] items-center justify-center text-sm text-muted-foreground">本月尚無預約資料</p><p class="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">取消／未到：<span class="font-medium tabular-nums text-warning">{{ month.cancelledOrNoShow ?? 0 }}</span> 筆</p></CardContent></Card>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card class="shadow-sm dark:shadow-none"><CardHeader><CardTitle>客戶成長</CardTitle><CardDescription>本月新增與目前累計客戶基礎。</CardDescription></CardHeader><CardContent class="grid grid-cols-2 gap-4"><div class="rounded-lg bg-field p-4"><UserRoundPlus class="h-4 w-4 text-primary" /><p class="mt-5 text-2xl font-semibold tabular-nums">{{ dashboard.monthlyNewOwnerCount }}</p><p class="mt-1 text-sm text-muted-foreground">本月新增飼主</p></div><div class="rounded-lg bg-field p-4"><PawPrint class="h-4 w-4 text-primary" /><p class="mt-5 text-2xl font-semibold tabular-nums">{{ dashboard.monthlyNewPetCount }}</p><p class="mt-1 text-sm text-muted-foreground">本月新增寵物</p></div><router-link to="/owners" class="flex items-center gap-2 text-sm text-primary hover:underline"><UsersRound class="h-4 w-4" />累計 {{ dashboard.ownerCount }} 位飼主</router-link><router-link to="/pets" class="flex items-center gap-2 text-sm text-primary hover:underline"><PawPrint class="h-4 w-4" />累計 {{ dashboard.petCount }} 隻寵物</router-link></CardContent></Card>
        <Card class="shadow-sm dark:shadow-none"><CardHeader><CardTitle>服務交付</CardTitle><CardDescription>已結案報告是否順利送達飼主。</CardDescription></CardHeader><CardContent class="grid grid-cols-3 gap-3"><div><p class="text-2xl font-semibold tabular-nums text-success">{{ delivery.sent ?? 0 }}</p><p class="mt-1 text-xs text-muted-foreground">已寄送</p></div><div><p class="text-2xl font-semibold tabular-nums text-warning">{{ delivery.pending ?? 0 }}</p><p class="mt-1 text-xs text-muted-foreground">待完成交付</p></div><div><p class="text-2xl font-semibold tabular-nums" :class="delivery.failed ? 'text-danger' : 'text-foreground'">{{ delivery.successRate === null ? '—' : `${delivery.successRate}%` }}</p><p class="mt-1 text-xs text-muted-foreground">寄送成功率</p></div><router-link to="/records?view=pending" class="col-span-3 mt-2 flex items-center justify-between border-t border-border pt-3 text-sm text-primary hover:underline"><span><MailWarning class="mr-1 inline h-4 w-4" />前往處理報告交付</span><ArrowRight class="h-4 w-4" /></router-link></CardContent></Card>
      </div>
    </template>
  </section>
</template>
