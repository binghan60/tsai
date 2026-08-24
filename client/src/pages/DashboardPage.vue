<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, ArrowRight, CalendarClock, Check, ClipboardPlus, PawPrint, Trash2 } from '@lucide/vue'
import { http } from '../api/http'
import { clinicDateInput, formatDate as formatClinicDate, formatDateTime as formatClinicDateTime } from '../lib/datetime'
import { APPOINTMENT_STATUS_META } from '../lib/appointmentStatus'
import { DELIVERY_STATUS_META, RECORD_STATUS_META, getDeliveryStatus } from '../lib/recordStatus'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import EmptyState from '../components/EmptyState.vue'
import ListSkeleton from '../components/ListSkeleton.vue'
import PetPickerDialog from '../components/PetPickerDialog.vue'
import TrendBars from '../components/TrendBars.vue'
import { Alert, AlertDescription } from '../components/ui/alert'

const router = useRouter()
const loading = ref(true)
const error = ref('')
const dashboard = ref(null)
const deletingDraftId = ref('')
const draftToDiscard = ref(null)
const petPickerOpen = ref(false)

async function fetchDashboard() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await http.get('/dashboard')
    dashboard.value = data
  } catch (err) {
    error.value = '工作台資料暫時無法載入，請稍後重試'
  } finally {
    loading.value = false
  }
}

// 預約清單改成日期區間查詢後不再預設今天，這裡把當天日期一起帶過去，數字才對得上清單。
const todayLink = computed(() => `/appointments?from=${clinicDateInput()}&to=${clinicDateInput()}`)

// 今日門診依狀態拆開。每一格都連進預約頁的對應篩選，數字點得進去才算數。
const todayBreakdown = computed(() => {
  const today = dashboard.value?.todayAppointments ?? {}
  return [
    { key: 'scheduled', label: '待報到', count: today.scheduled ?? 0 },
    { key: 'arrived', label: '已報到', count: today.arrived ?? 0 },
    { key: 'completed', label: '已完成', count: today.completed ?? 0 },
    { key: 'no_show', label: '未到診', count: today.no_show ?? 0 },
  ].map((item) => ({
    ...item,
    dot: APPOINTMENT_STATUS_META[item.key]?.dotClass ?? 'bg-muted-foreground',
    to: `${todayLink.value}&view=${item.key}`,
  }))
})

// 報告流程分佈。數字一律用後端算好的 finalizedPendingCount／failedCount，不要在這裡從
// statusBreakdown 重算：那份加總必須跟 records.js 的 view 篩選條件逐字對齊（pending 含
// uncertain，failed 也含 uncertain），一在前端重算就會漏掉狀態——數字點得進清單，
// 兩邊對不上等於在騙人。
//
// 這裡刻意用四個數字而不是一條堆疊長條：「已寄送」是完成、其他三個是待辦，
// 混在同一條上只會讓長條變長代表資料變多，看不出有沒有事要做。
const reportFlow = computed(() => [
  { key: 'drafts', label: '草稿', count: dashboard.value?.draftCount ?? 0, to: '/records?view=drafts', dot: RECORD_STATUS_META.draft.dotClass, hint: '尚未結案' },
  { key: 'pending', label: '待寄送', count: dashboard.value?.finalizedPendingCount ?? 0, to: '/records?view=pending', dot: DELIVERY_STATUS_META.not_sent.dotClass, hint: '已結案，等寄出' },
  { key: 'sent', label: '已寄送', count: dashboard.value?.statusBreakdown?.sent ?? 0, to: '/records?view=sent', dot: DELIVERY_STATUS_META.sent.dotClass, hint: '飼主已收到' },
  { key: 'failed', label: '寄送異常', count: dashboard.value?.failedCount ?? 0, to: '/records?view=failed', dot: DELIVERY_STATUS_META.failed.dotClass, hint: '需要確認', danger: true },
])

// 橫幅只留給「真的卡住了」。草稿和待寄送是正常流程，每天開工作台都被一個大橫幅
// 告知「你有草稿」，那個橫幅就會被當成背景忽略掉，真的出事時反而看不見。
const attentionCount = computed(() => dashboard.value?.failedCount ?? 0)

async function discardDraft(item) {
  if (deletingDraftId.value) return
  deletingDraftId.value = item._id
  error.value = ''
  try {
    await http.delete(`/records/${item._id}`)
    draftToDiscard.value = null
    await fetchDashboard()
  } catch (err) {
    error.value = '捨棄草稿失敗，請稍後再試'
  } finally {
    deletingDraftId.value = ''
  }
}

function openDiscardDraft(item) {
  if (deletingDraftId.value) return
  draftToDiscard.value = item
}

function formatDate(value) {
  return formatClinicDate(value, '日期未填')
}

function formatDateTime(value) {
  return formatClinicDateTime(value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function recordLink(item) {
  return item.status === 'draft' ? `/records/${item._id}/edit` : `/records/${item._id}/preview`
}

function actionMeta(item) {
  if (item.status === 'draft') {
    return { label: RECORD_STATUS_META.draft.label, action: '繼續填寫', detail: `上次更新：${formatDateTime(item.updatedAt)}`, class: RECORD_STATUS_META.draft.class, buttonVariant: 'outline' }
  }
  const deliveryStatus = getDeliveryStatus(item)
  if (deliveryStatus === 'failed') {
    return { label: DELIVERY_STATUS_META.failed.label, action: '重試寄送', detail: '請確認收件信箱後重新寄送', class: DELIVERY_STATUS_META.failed.class, buttonVariant: 'destructive' }
  }
  if (deliveryStatus === 'uncertain') {
    return { label: DELIVERY_STATUS_META.uncertain.label, action: '確認後重寄', detail: '請先確認飼主是否已收到報告', class: DELIVERY_STATUS_META.uncertain.class, buttonVariant: 'destructive' }
  }
  if (deliveryStatus === 'sending') {
    return { label: DELIVERY_STATUS_META.sending.label, action: '查看報告', detail: '郵件正在傳送，請稍候確認結果', class: DELIVERY_STATUS_META.sending.class, buttonVariant: 'outline' }
  }
  return { label: DELIVERY_STATUS_META.not_sent.label, action: '寄送報告', detail: '報告已結案，可寄送給飼主', class: DELIVERY_STATUS_META.not_sent.class, buttonVariant: 'default' }
}

async function startRecordForPet(pet) {
  petPickerOpen.value = false
  await router.push(`/pets/${pet._id}/records/new`)
}

onMounted(fetchDashboard)
</script>

<template>
  <!--
    三層閱讀順序，由粗到細：
      1 現在   今日門診、異常警示
      2 分佈與趨勢   報告流程、近 6 週健檢量、本月概況
      3 明細   待辦清單、最近完成
    同一個數字只在其中一層出現一次。之前草稿數同時出現在優先處理卡、workStage 卡、
    待辦清單與狀態長條四個地方，那是這頁最主要的雜訊來源。
  -->
  <section class="mx-auto max-w-7xl space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-foreground">健檢工作台</h1>
        <p class="mt-1 text-sm text-muted-foreground">今日門診、報告流程與最近的健檢量一覽。</p>
      </div>
      <Button type="button" @click="petPickerOpen = true"><ClipboardPlus class="h-4 w-4" stroke-width="1.75" />新增健檢</Button>
    </div>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <ListSkeleton v-if="loading" :rows="6" />

    <template v-else>
      <!-- ── 第 1 層：現在 ────────────────────────────────────── -->
      <router-link
        v-if="attentionCount"
        to="/records?view=failed"
        class="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger-surface p-4 transition-colors hover:border-danger/60"
      >
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card/70 text-danger">
          <AlertTriangle class="h-5 w-5" stroke-width="1.75" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-base font-semibold text-danger">有 {{ attentionCount }} 份報告需要確認</span>
          <span class="mt-0.5 block text-sm text-muted-foreground">請先確認寄送結果，避免飼主漏收報告。</span>
        </span>
        <ArrowRight class="h-4 w-4 shrink-0 text-danger" stroke-width="1.75" />
      </router-link>

      <Card class="p-5 shadow-sm dark:shadow-none">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <CalendarClock class="h-5 w-5" stroke-width="1.75" />
            </span>
            <div>
              <CardTitle class="text-sm">今日門診</CardTitle>
              <p class="mt-0.5 text-xs text-muted-foreground">
                共 <strong class="text-sm font-semibold tabular-nums text-foreground">{{ dashboard.todayAppointments?.total ?? 0 }}</strong> 診次
                <template v-if="dashboard.todayAppointments?.cancelled"> · 已取消 {{ dashboard.todayAppointments.cancelled }}</template>
              </p>
            </div>
          </div>
          <Button as-child variant="outline" size="sm">
            <router-link :to="todayLink">查看預約<ArrowRight class="h-4 w-4" /></router-link>
          </Button>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <router-link
            v-for="item in todayBreakdown"
            :key="item.key"
            :to="item.to"
            class="rounded-lg border border-border bg-field px-3 py-2.5 transition-colors hover:border-primary/45 hover:bg-accent"
          >
            <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="item.count ? item.dot : 'bg-muted-foreground/40'" aria-hidden="true"></span>
              {{ item.label }}
            </span>
            <span class="mt-1 block text-xl font-semibold leading-none tabular-nums text-foreground">{{ item.count }}</span>
          </router-link>
        </div>
      </Card>

      <!-- ── 第 2 層：分佈與趨勢 ──────────────────────────────── -->
      <Card class="p-5 shadow-sm dark:shadow-none">
        <div class="flex items-center justify-between gap-3">
          <div>
            <CardTitle class="text-sm">報告流程</CardTitle>
            <CardDescription class="mt-0.5 text-xs">每一格都能點進對應的健檢紀錄佇列</CardDescription>
          </div>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <router-link
            v-for="stage in reportFlow"
            :key="stage.key"
            :to="stage.to"
            class="rounded-lg border px-3 py-2.5 transition-colors"
            :class="stage.danger && stage.count
              ? 'border-danger/40 bg-danger-surface hover:border-danger/60'
              : 'border-border bg-field hover:border-primary/45 hover:bg-accent'"
          >
            <span class="flex items-center gap-1.5 text-xs" :class="stage.danger && stage.count ? 'text-danger' : 'text-muted-foreground'">
              <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="stage.count ? stage.dot : 'bg-muted-foreground/40'" aria-hidden="true"></span>
              {{ stage.label }}
            </span>
            <span class="mt-1 block text-xl font-semibold leading-none tabular-nums" :class="stage.danger && stage.count ? 'text-danger' : 'text-foreground'">{{ stage.count }}</span>
            <span class="mt-1 block truncate text-xs text-muted-foreground">{{ stage.hint }}</span>
          </router-link>
        </div>
      </Card>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card class="p-5 shadow-sm dark:shadow-none">
          <CardTitle class="text-sm">近 6 週健檢量</CardTitle>
          <CardDescription class="mt-0.5 text-xs">依健檢日期計算，每根一週</CardDescription>
          <div class="mt-4">
            <TrendBars :data="dashboard.weeklyTrend ?? []" label="每週健檢量" />
          </div>
        </Card>

        <Card class="p-5 shadow-sm dark:shadow-none">
          <CardTitle class="text-sm">本月</CardTitle>
          <!-- 本月健檢沒有連結：清單頁還沒有月份篩選，連過去只會看到跟這個數字對不上的筆數。 -->
          <div class="mt-3 flex items-baseline gap-2">
            <span class="text-xl font-semibold leading-none tabular-nums text-foreground">{{ dashboard.monthlyReportCount ?? 0 }}</span>
            <span class="text-xs text-muted-foreground">份健檢</span>
          </div>
          <dl class="mt-4 space-y-2 border-t border-border pt-3 text-xs">
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted-foreground">本月新飼主</dt>
              <dd class="tabular-nums text-foreground">{{ dashboard.monthlyNewOwnerCount ?? 0 }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted-foreground">本月新寵物</dt>
              <dd class="tabular-nums text-foreground">{{ dashboard.monthlyNewPetCount ?? 0 }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3 border-t border-border pt-2">
              <dt class="text-muted-foreground">累計飼主 / 寵物</dt>
              <dd class="tabular-nums text-foreground">
                <router-link to="/owners" class="text-primary">{{ dashboard.ownerCount ?? 0 }}</router-link>
                /
                <router-link to="/pets" class="text-primary">{{ dashboard.petCount ?? 0 }}</router-link>
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <!-- ── 第 3 層：明細 ────────────────────────────────────── -->
      <div class="grid gap-4 xl:grid-cols-2">
        <Card class="gap-0 overflow-hidden py-0 shadow-sm dark:shadow-none">
          <CardHeader class="flex-row items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div>
              <CardTitle class="text-sm">待辦工作</CardTitle>
              <CardDescription class="mt-0.5 text-xs">寄送異常優先，其次是待寄送報告與草稿</CardDescription>
            </div>
            <Button as-child variant="outline" size="sm" class="shrink-0">
              <router-link to="/records?view=todo">查看全部<ArrowRight class="h-4 w-4" /></router-link>
            </Button>
          </CardHeader>
          <CardContent class="p-0">
            <div v-if="dashboard.actionRecords?.length" class="divide-y divide-border">
              <div v-for="item in dashboard.actionRecords" :key="item._id" class="flex min-h-16 items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/40">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <router-link :to="item.petId ? `/pets/${item.petId._id}` : recordLink(item)" class="truncate text-sm font-medium text-primary">{{ item.petId?.name || '寵物未找到' }}</router-link>
                    <span v-if="item.petId?.ownerId?.name" class="text-xs font-normal text-muted-foreground">{{ item.petId?.ownerId?.name }}</span>
                    <Badge variant="status" :class="actionMeta(item).class" class="shrink-0">{{ actionMeta(item).label }}</Badge>
                  </div>
                  <p class="mt-0.5 truncate text-xs text-muted-foreground">{{ actionMeta(item).detail }}<span v-if="item.visitDate"> · 健檢日 {{ formatDate(item.visitDate) }}</span></p>
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                  <Button as-child type="button" :variant="actionMeta(item).buttonVariant" size="sm">
                    <router-link :to="recordLink(item)">{{ actionMeta(item).action }}<ArrowRight class="h-4 w-4" /></router-link>
                  </Button>
                  <Button
                    v-if="item.status === 'draft'"
                    type="button"
                    variant="destructive"
                    size="icon-sm"
                    class="shrink-0"
                    :disabled="deletingDraftId === item._id"
                    :aria-label="`捨棄 ${item.petId?.name || '草稿'}`"
                    title="捨棄草稿"
                    @click="openDiscardDraft(item)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            <EmptyState v-else inset :icon="Check" title="目前沒有待處理工作" description="所有報告都已寄出，可以開始新的健檢。" />
          </CardContent>
        </Card>

        <Card class="gap-0 overflow-hidden py-0 shadow-sm dark:shadow-none">
          <CardHeader class="border-b border-border px-5 py-3">
            <CardTitle class="text-sm">最近完成</CardTitle>
            <CardDescription class="mt-0.5 text-xs">最近已成功寄送的健檢報告</CardDescription>
          </CardHeader>
          <CardContent class="p-0">
            <div v-if="dashboard.recentRecords?.length" class="divide-y divide-border">
              <router-link
                v-for="item in dashboard.recentRecords"
                :key="item._id"
                :to="recordLink(item)"
                class="block px-5 py-3 transition-colors hover:bg-muted/40"
              >
                <span class="block truncate text-sm font-medium text-primary">{{ item.petId?.name || '寵物未找到' }}</span>
                <span class="mt-0.5 block truncate text-xs text-muted-foreground">
                  {{ formatDate(item.visitDate) }} · {{ item.vet || '獸醫師未填' }}
                  <template v-if="item.petId?.ownerId?.name"> · {{ item.petId.ownerId.name }}</template>
                </span>
              </router-link>
            </div>
            <EmptyState v-else inset :icon="PawPrint" title="還沒有已寄送紀錄" />
          </CardContent>
        </Card>
      </div>
    </template>

    <ConfirmDialog
      :open="Boolean(draftToDiscard)"
      title="捨棄草稿"
      :description="`確定要捨棄 ${draftToDiscard?.petId?.name || '這份'} 的草稿嗎？此操作無法復原。`"
      confirm-label="捨棄草稿"
      :loading="Boolean(deletingDraftId)"
      @update:open="(value) => !value && (draftToDiscard = null)"
      @confirm="discardDraft(draftToDiscard)"
    />
    <PetPickerDialog :open="petPickerOpen" @close="petPickerOpen = false" @select="startRecordForPet" />
  </section>
</template>
