<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { AlertTriangle, ArrowRight, Check, ClipboardPlus, FileText, PawPrint, Pencil, Trash2, Users } from '@lucide/vue'
import { http } from '../api/http'
import { formatDate as formatClinicDate, formatDateTime as formatClinicDateTime } from '../lib/datetime'
import { DELIVERY_STATUS_META, RECORD_STATUS_META, getDeliveryStatus } from '../lib/recordStatus'
import { useTheme } from '../composables/useTheme'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import PetPickerDialog from '../components/PetPickerDialog.vue'
import { Alert, AlertDescription } from '../components/ui/alert'

const router = useRouter()
const loading = ref(true)
const { isDark } = useTheme()
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

const stats = computed(() => [
  { label: '飼主', value: dashboard.value?.ownerCount ?? '—', icon: Users, to: '/owners' },
  { label: '寵物', value: dashboard.value?.petCount ?? '—', icon: PawPrint, to: '/pets' },
  // 本月健檢沒有 to：清單頁還沒有日期區間篩選，連過去只會看到跟卡片對不上的筆數。
  { label: '本月健檢', value: dashboard.value?.monthlyReportCount ?? '—', icon: FileText },
])

const workStages = computed(() => {
  const breakdown = dashboard.value?.statusBreakdown ?? {}
  return [
    {
      key: 'drafts',
      label: '完成草稿',
      count: dashboard.value?.draftCount ?? 0,
      description: '補齊健檢內容並結案',
      action: '查看草稿',
      to: '/records?view=drafts',
      icon: Pencil,
      class: 'border-amber-200 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-500/5',
    },
    {
      key: 'pending',
      label: '寄送報告',
      count: (breakdown.finalized ?? 0) + (breakdown.sending ?? 0),
      description: '已結案，等待寄送給飼主',
      action: '查看待寄送',
      to: '/records?view=pending',
      icon: FileText,
      class: 'border-sky-200 bg-sky-50/60 dark:border-sky-500/25 dark:bg-sky-500/5',
    },
    {
      key: 'attention',
      label: '處理異常',
      count: (breakdown.failed ?? 0) + (breakdown.uncertain ?? 0),
      description: '確認寄送結果或重新寄送',
      action: '處理異常',
      to: '/records?view=failed',
      icon: AlertTriangle,
      class: 'border-red-200 bg-red-50/60 dark:border-red-500/25 dark:bg-red-500/5',
    },
  ]
})

const primaryAction = computed(() => {
  const stages = workStages.value
  const attention = stages[2]
  if (attention.count) return { ...attention, title: `有 ${attention.count} 份報告需要確認`, detail: '請先確認寄送結果，避免飼主漏收報告。' }
  const pending = stages[1]
  if (pending.count) return { ...pending, title: `有 ${pending.count} 份報告待寄送`, detail: '報告已結案，下一步是寄送給飼主。' }
  const drafts = stages[0]
  if (drafts.count) return { ...drafts, title: `有 ${drafts.count} 份草稿待完成`, detail: '完成填寫並結案後，才能寄送正式報告。' }
  return {
    title: '目前沒有待處理的健檢報告',
    detail: '可以開始一份新的健檢紀錄。',
    action: '新增健檢',
    icon: Check,
    class: 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/5',
    to: '',
  }
})

// 圖表分類色依主題切換：深色卡片（--card #121b22 底）要比一般品牌色再深一階才有足夠對比，
// 淺色（Belle Époque）則用古董金等較深的色階。draft／sent 兩色深淺共用。
const statusColors = computed(() =>
  isDark.value
    ? {
        draft: 'bg-zinc-500',
        finalized: 'bg-brand-600',
        sending: 'bg-sky-600',
        sent: 'bg-emerald-600',
        failed: 'bg-red-600',
        uncertain: 'bg-amber-500',
      }
    : {
        draft: 'bg-zinc-500',
        finalized: 'bg-amber-800',
        sending: 'bg-sky-700',
        sent: 'bg-emerald-600',
        failed: 'bg-red-700',
        uncertain: 'bg-amber-600',
      },
)

const statusSegments = computed(() => {
  const values = { draft: 0, finalized: 0, sending: 0, sent: 0, failed: 0, uncertain: 0, ...(dashboard.value?.statusBreakdown ?? {}) }
  const total = Math.max(values.draft + values.finalized + values.sending + values.sent + values.failed + values.uncertain, 1)
  const colors = statusColors.value
  return [
    { key: 'draft', label: '草稿', value: values.draft, width: (values.draft / total) * 100, class: colors.draft },
    { key: 'finalized', label: '已結案待寄送', value: values.finalized, width: (values.finalized / total) * 100, class: colors.finalized },
    { key: 'sending', label: '寄送中', value: values.sending, width: (values.sending / total) * 100, class: colors.sending },
    { key: 'sent', label: '已寄送', value: values.sent, width: (values.sent / total) * 100, class: colors.sent },
    { key: 'failed', label: '寄送失敗', value: values.failed, width: (values.failed / total) * 100, class: colors.failed },
    { key: 'uncertain', label: '結果待確認', value: values.uncertain, width: (values.uncertain / total) * 100, class: colors.uncertain },
  ]
})

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
    return { label: '繼續填寫', detail: `更新 ${formatDateTime(item.updatedAt)}`, class: RECORD_STATUS_META.draft?.class }
  }
  const deliveryStatus = getDeliveryStatus(item)
  if (deliveryStatus === 'failed') {
    return { label: '處理失敗', detail: '寄送失敗，請確認信箱或重新寄送', class: DELIVERY_STATUS_META.failed?.class }
  }
  if (deliveryStatus === 'uncertain') {
    return { label: '確認結果', detail: '寄送結果不明，需要人工確認', class: DELIVERY_STATUS_META.uncertain?.class }
  }
  if (deliveryStatus === 'sending') {
    return { label: '查看進度', detail: '報告正在寄送中', class: DELIVERY_STATUS_META.sending?.class }
  }
  return { label: '寄送報告', detail: '報告已結案，尚未寄送', class: DELIVERY_STATUS_META.not_sent?.class }
}

async function startRecordForPet(pet) {
  petPickerOpen.value = false
  await router.push(`/pets/${pet._id}/records/new`)
}

onMounted(fetchDashboard)
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-foreground">健檢工作台</h1>
        <p class="mt-1 text-sm text-muted-foreground">快速找到寵物、繼續草稿或建立新的健檢紀錄。</p>
      </div>
      <Button type="button" @click="petPickerOpen = true"><ClipboardPlus class="h-4 w-4" stroke-width="1.75" />新增健檢</Button>
    </div>

    <Alert v-if="error" variant="destructive"
      ><AlertDescription>{{ error }}</AlertDescription></Alert
    >
    <p v-else-if="loading" class="text-sm text-muted-foreground" role="status">載入工作台…</p>

    <template v-else>
      <Card class="p-5 shadow-sm">
        <div class="mb-3 flex items-center justify-between"><CardTitle class="text-sm">報告狀態</CardTitle><span class="text-xs text-muted-foreground">流程概況</span></div>
        <div class="flex h-3 overflow-hidden rounded-full bg-muted/60"><div v-for="segment in statusSegments" :key="segment.key" :class="segment.class" :style="{ width: `${segment.width}%` }"></div></div>

        <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          <span v-for="segment in statusSegments" :key="segment.key" class="flex items-center gap-2 text-sm text-foreground"
            ><span class="h-2 w-2 shrink-0 rounded-full" :class="segment.class" aria-hidden="true"></span>{{ segment.label }} <strong>{{ segment.value }}</strong></span
          >
        </div>
      </Card>

      <Card class="border p-5 shadow-sm dark:shadow-none" :class="primaryAction.class">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-start gap-3">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card/80 text-foreground shadow-sm dark:bg-card/30">
              <component :is="primaryAction.icon" class="h-5 w-5" stroke-width="1.75" />
            </div>
            <div>
              <p class="text-xs font-medium text-muted-foreground">現在優先處理</p>
              <h2 class="mt-1 text-base font-semibold text-foreground">{{ primaryAction.title }}</h2>
              <p class="mt-1 text-sm text-muted-foreground">{{ primaryAction.detail }}</p>
            </div>
          </div>
          <Button v-if="primaryAction.to" as-child class="shrink-0"
            ><router-link :to="primaryAction.to">{{ primaryAction.action }}<ArrowRight class="h-4 w-4" /></router-link
          ></Button>
          <Button v-else type="button" class="shrink-0" @click="petPickerOpen = true"><ClipboardPlus class="h-4 w-4" />{{ primaryAction.action }}</Button>
        </div>
      </Card>

      <div class="grid gap-3 md:grid-cols-3">
        <router-link v-for="stage in workStages" :key="stage.key" :to="stage.to" class="rounded-xl border p-4 transition-colors hover:bg-card/70" :class="stage.class">
          <div class="flex items-start justify-between gap-3">
            <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-card/80 text-foreground dark:bg-card/30"><component :is="stage.icon" class="h-4 w-4" stroke-width="1.75" /></span>
            <span class="text-2xl font-semibold tabular-nums text-foreground">{{ stage.count }}</span>
          </div>
          <h3 class="mt-3 text-sm font-semibold text-foreground">{{ stage.label }}</h3>
          <p class="mt-1 text-xs text-muted-foreground">{{ stage.description }}</p>
          <span class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-foreground">{{ stage.action }}<ArrowRight class="h-3.5 w-3.5" /></span>
        </router-link>
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card v-for="stat in stats" :key="stat.label" class="border p-0 shadow-sm dark:shadow-none" :class="stat.emphasis && stat.value ? 'border-belle-300 dark:border-brand-500/50' : ' '">
          <component :is="stat.to ? RouterLink : 'div'" :to="stat.to" class="flex flex-row items-center gap-3 rounded-xl p-4" :class="stat.to ? 'transition-colors hover:bg-muted/40 ' : ''">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400"><component :is="stat.icon" class="h-5 w-5" /></div>
            <div class="min-w-0">
              <div class="text-xl font-semibold tabular-nums text-foreground">{{ stat.value }}</div>
              <div class="text-xs text-muted-foreground">{{ stat.label }}</div>
            </div>
          </component>
        </Card>
      </div>

      <div class="grid gap-4 xl:grid-cols-2">
        <Card class="gap-0 overflow-hidden py-0 shadow-sm">
          <CardHeader class="flex-row items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div><CardTitle class="text-sm">待辦工作</CardTitle><CardDescription class="mt-0.5 text-xs">寄送異常優先，其次是待寄送報告與草稿</CardDescription></div>
            <AlertTriangle v-if="dashboard.failedCount" class="h-5 w-5 text-red-600 dark:text-red-300" />
            <Check v-else class="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent class="p-0">
            <div v-if="dashboard.actionRecords?.length" class="divide-y divide-border">
              <div v-for="item in dashboard.actionRecords" :key="item._id" class="flex min-h-[72px] items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40">
                <router-link :to="recordLink(item)" class="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-foreground"
                      >{{ item.petId?.name || '寵物未找到' }}<span class="ml-2 font-normal text-muted-foreground">{{ item.petId?.ownerId?.name }}</span></span
                    >
                    <span class="mt-0.5 block truncate text-xs text-muted-foreground">{{ formatDate(item.visitDate) }} · {{ actionMeta(item).detail }}</span>
                  </span>
                  <span class="flex shrink-0 items-center gap-2">
                    <Badge variant="status" :class="actionMeta(item).class">{{ actionMeta(item).label }}</Badge>
                    <ArrowRight class="h-4 w-4 text-muted-foreground" stroke-width="1.75" />
                  </span>
                </router-link>
                <Button v-if="item.status === 'draft'" type="button" variant="destructive" size="icon" class="h-11 w-11 shrink-0" :disabled="deletingDraftId === item._id" :aria-label="`捨棄 ${item.petId?.name || '草稿'}`" title="捨棄草稿" @click="openDiscardDraft(item)">
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div v-else class="px-5 py-10 text-center">
              <Check class="mx-auto h-7 w-7 text-emerald-600" />
              <p class="mt-2 text-sm text-muted-foreground">目前沒有待處理工作</p>
            </div>
          </CardContent>
        </Card>

        <Card class="gap-0 overflow-hidden py-0 shadow-sm">
          <CardHeader class="flex-row items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div><CardTitle class="text-sm">最近完成紀錄</CardTitle><CardDescription class="mt-0.5 text-xs">最近已成功寄送的健檢報告</CardDescription></div>
            <FileText class="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent class="p-0">
            <div v-if="dashboard.recentRecords?.length" class="divide-y divide-border">
              <div v-for="item in dashboard.recentRecords" :key="item._id" class="flex min-h-16 items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40">
                <router-link :to="recordLink(item)" class="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span class="min-w-0"
                    ><span class="block truncate text-sm font-medium text-foreground"
                      >{{ item.petId?.name || '寵物未找到' }}<span class="ml-2 font-normal text-muted-foreground">{{ item.petId?.ownerId?.name }}</span></span
                    ><span class="block text-xs text-muted-foreground">{{ formatDate(item.visitDate) }} · {{ item.vet || '獸醫師未填' }}</span></span
                  >
                  <span class="flex shrink-0 flex-wrap justify-end gap-1.5"
                    ><Badge variant="status" :class="RECORD_STATUS_META[item.status]?.class">{{ RECORD_STATUS_META[item.status]?.label }}</Badge
                    ><Badge v-if="item.status !== 'draft'" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(item)]?.class">{{ DELIVERY_STATUS_META[getDeliveryStatus(item)]?.label }}</Badge></span
                  >
                </router-link>
              </div>
            </div>
            <div v-else class="px-5 py-10 text-center">
              <PawPrint class="mx-auto h-7 w-7 text-muted-foreground" />
              <p class="mt-2 text-sm text-muted-foreground">目前沒有已寄送紀錄</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog :open="Boolean(draftToDiscard)" title="捨棄草稿" :description="`確定要捨棄 ${draftToDiscard?.petId?.name || '這份'} 的草稿嗎？此操作無法復原。`" confirm-label="捨棄草稿" :loading="Boolean(deletingDraftId)" @update:open="(value) => !value && (draftToDiscard = null)" @confirm="discardDraft(draftToDiscard)" />
      <PetPickerDialog :open="petPickerOpen" @close="petPickerOpen = false" @select="startRecordForPet" />
    </template>
  </section>
</template>
