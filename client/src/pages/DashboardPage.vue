<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { AlertTriangle, ArrowRight, Check, FileText, PawPrint, Pencil, Trash2, Users } from '@lucide/vue';
import { http } from '../api/http';
import { formatDate as formatClinicDate, formatDateTime as formatClinicDateTime } from '../lib/datetime';
import { DELIVERY_STATUS_META, RECORD_STATUS_META, getDeliveryStatus } from '../lib/recordStatus';
import { useTheme } from '../composables/useTheme';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { Alert, AlertDescription } from '../components/ui/alert';

const loading = ref(true);
const { isDark } = useTheme();
const error = ref('');
const dashboard = ref(null);
const deletingDraftId = ref('');
const draftToDiscard = ref(null);

async function fetchDashboard() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/dashboard');
    dashboard.value = data;
  } catch (err) {
    error.value = '工作台資料暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
}

const stats = computed(() => [
  { label: '飼主', value: dashboard.value?.ownerCount ?? '—', icon: Users, to: '/owners' },
  { label: '寵物', value: dashboard.value?.petCount ?? '—', icon: PawPrint, to: '/pets' },
  // 本月健檢沒有 to：清單頁還沒有日期區間篩選，連過去只會看到跟卡片對不上的筆數。
  { label: '本月健檢', value: dashboard.value?.monthlyReportCount ?? '—', icon: FileText },
  { label: '待完成草稿', value: dashboard.value?.draftCount ?? '—', icon: Pencil, emphasis: true, to: '/records?view=drafts' },
  { label: '待寄送報告', value: dashboard.value?.finalizedPendingCount ?? '—', icon: FileText, emphasis: true, to: '/records?view=pending' },
]);

// 圖表分類色依主題切換：深色卡片（--card #121b22 底）要比一般品牌色再深一階才有足夠對比，
// 淺色（Belle Époque）則用古董金等較深的色階。draft／sent 兩色深淺共用。
const statusColors = computed(() => (isDark.value
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
    }));

const statusSegments = computed(() => {
  const values = { draft: 0, finalized: 0, sending: 0, sent: 0, failed: 0, uncertain: 0, ...(dashboard.value?.statusBreakdown ?? {}) };
  const total = Math.max(values.draft + values.finalized + values.sending + values.sent + values.failed + values.uncertain, 1);
  const colors = statusColors.value;
  return [
    { key: 'draft', label: '草稿', value: values.draft, width: (values.draft / total) * 100, class: colors.draft },
    { key: 'finalized', label: '已結案待寄送', value: values.finalized, width: (values.finalized / total) * 100, class: colors.finalized },
    { key: 'sending', label: '寄送中', value: values.sending, width: (values.sending / total) * 100, class: colors.sending },
    { key: 'sent', label: '已寄送', value: values.sent, width: (values.sent / total) * 100, class: colors.sent },
    { key: 'failed', label: '寄送失敗', value: values.failed, width: (values.failed / total) * 100, class: colors.failed },
    { key: 'uncertain', label: '結果待確認', value: values.uncertain, width: (values.uncertain / total) * 100, class: colors.uncertain },
  ];
});

async function discardDraft(item) {
  if (deletingDraftId.value) return;
  deletingDraftId.value = item._id;
  error.value = '';
  try {
    await http.delete(`/records/${item._id}`);
    draftToDiscard.value = null;
    await fetchDashboard();
  } catch (err) {
    error.value = '捨棄草稿失敗，請稍後再試';
  } finally {
    deletingDraftId.value = '';
  }
}

function openDiscardDraft(item) {
  if (deletingDraftId.value) return;
  draftToDiscard.value = item;
}

function formatDate(value) {
  return formatClinicDate(value, '日期未填');
}

function formatDateTime(value) {
  return formatClinicDateTime(value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function recordLink(item) {
  return item.status === 'draft' ? `/records/${item._id}/edit` : `/records/${item._id}/preview`;
}

onMounted(fetchDashboard);
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><h1 class="text-xl font-semibold text-foreground">健檢工作台</h1><p class="mt-1 text-sm text-muted-foreground">快速找到寵物、繼續草稿或建立新的健檢紀錄。</p></div>
    </div>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <p v-else-if="loading" class="text-sm text-muted-foreground" role="status">載入工作台…</p>

    <template v-else>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card v-for="stat in stats" :key="stat.label" class="border p-0 shadow-sm dark:shadow-none" :class="stat.emphasis && stat.value ? 'border-belle-300 dark:border-brand-500/50' : ' '">
          <component
            :is="stat.to ? RouterLink : 'div'"
            :to="stat.to"
            class="flex flex-row items-center gap-3 rounded-xl p-4"
            :class="stat.to ? 'transition-colors hover:bg-muted/40 ' : ''"
          >
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400"><component :is="stat.icon" class="h-5 w-5" /></div>
            <div class="min-w-0">
              <div class="text-xl font-semibold tabular-nums text-foreground">{{ stat.value }}</div>
              <div class="text-xs text-muted-foreground">{{ stat.label }}</div>
            </div>
          </component>
        </Card>
      </div>

      <!-- 寄送失敗不佔一張統計卡（版面只放得下五張），但它是唯一「已經出過錯」的狀態，
           不主動浮出來就會沉在清單裡沒人發現。只有真的有失敗時才出現。 -->
      <RouterLink
        v-if="dashboard.failedCount"
        to="/records?view=failed"
        class="flex min-h-14 items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 transition-colors hover:border-red-300 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
      >
        <AlertTriangle class="h-5 w-5 shrink-0" stroke-width="1.75" />
        <span class="min-w-0 flex-1">有 {{ dashboard.failedCount }} 份報告寄送失敗或結果待確認，需要處理。</span>
        <ArrowRight class="h-4 w-4 shrink-0" stroke-width="1.75" />
      </RouterLink>

      <div class="grid gap-4 xl:grid-cols-2">
        <Card class="gap-0 overflow-hidden py-0 shadow-sm">
          <CardHeader class="flex-row items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div><CardTitle class="text-sm">繼續填寫草稿</CardTitle><CardDescription class="mt-0.5 text-xs">依最後更新時間排序</CardDescription></div>
            <Pencil class="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent class="p-0">
            <div v-if="dashboard.draftRecords?.length" class="divide-y divide-border">
              <div v-for="item in dashboard.draftRecords" :key="item._id" class="flex min-h-16 items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40">
                <router-link :to="`/records/${item._id}/edit`" class="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span class="min-w-0"><span class="block truncate text-sm font-medium text-foreground">{{ item.petId?.name || '寵物未找到' }}<span class="ml-2 font-normal text-muted-foreground">{{ item.petId?.ownerId?.name }}</span></span><span class="block text-xs text-muted-foreground">{{ formatDate(item.visitDate) }} · 更新 {{ formatDateTime(item.updatedAt) }}</span></span>
                  <span class="shrink-0 text-sm font-medium text-belle-600 dark:text-brand-400">繼續填寫</span>
                </router-link>
                <Button type="button" variant="destructive" size="icon" class="h-11 w-11 shrink-0" :disabled="deletingDraftId === item._id" :aria-label="`捨棄 ${item.petId?.name || '草稿'}`" title="捨棄草稿" @click="openDiscardDraft(item)">
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div v-else class="px-5 py-10 text-center"><Check class="mx-auto h-7 w-7 text-emerald-600" /><p class="mt-2 text-sm text-muted-foreground">目前沒有待完成草稿</p></div>
          </CardContent>
        </Card>

        <Card class="gap-0 overflow-hidden py-0 shadow-sm">
          <CardHeader class="flex-row items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div><CardTitle class="text-sm">最近健檢紀錄</CardTitle><CardDescription class="mt-0.5 text-xs">快速回到最近處理的寵物</CardDescription></div>
            <FileText class="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent class="p-0">
            <div v-if="dashboard.recentRecords?.length" class="divide-y divide-border">
              <div v-for="item in dashboard.recentRecords" :key="item._id" class="flex min-h-16 items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40">
                <router-link :to="recordLink(item)" class="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span class="min-w-0"><span class="block truncate text-sm font-medium text-foreground">{{ item.petId?.name || '寵物未找到' }}<span class="ml-2 font-normal text-muted-foreground">{{ item.petId?.ownerId?.name }}</span></span><span class="block text-xs text-muted-foreground">{{ formatDate(item.visitDate) }} · {{ item.vet || '獸醫師未填' }}</span></span>
                  <span class="flex shrink-0 flex-wrap justify-end gap-1.5"><Badge variant="status" :class="RECORD_STATUS_META[item.status]?.class">{{ RECORD_STATUS_META[item.status]?.label }}</Badge><Badge v-if="item.status !== 'draft'" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(item)]?.class">{{ DELIVERY_STATUS_META[getDeliveryStatus(item)]?.label }}</Badge></span>
                </router-link>
                <Button v-if="item.status === 'draft'" type="button" variant="destructive" size="icon" class="h-11 w-11 shrink-0" :disabled="deletingDraftId === item._id" :aria-label="`捨棄 ${item.petId?.name || '草稿'}`" title="捨棄草稿" @click="openDiscardDraft(item)">
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div v-else class="px-5 py-10 text-center"><PawPrint class="mx-auto h-7 w-7 text-muted-foreground" /><p class="mt-2 text-sm text-muted-foreground">目前沒有健檢紀錄</p></div>
          </CardContent>
        </Card>
      </div>

      <Card class="p-5 shadow-sm">
        <div class="mb-3 flex items-center justify-between"><CardTitle class="text-sm">報告狀態</CardTitle><span class="text-xs text-muted-foreground">流程概況</span></div>
        <div class="flex h-3 overflow-hidden rounded-full bg-muted/60"><div v-for="segment in statusSegments" :key="segment.key" :class="segment.class" :style="{ width: `${segment.width}%` }"></div></div>
        <!-- 圖例要帶色塊。少了它，長條那五個顏色沒有任何東西能對回去，
             等於是純裝飾——讀者看得到「紅色佔一小截」卻不知道紅色是哪一項。 -->
        <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2"><span v-for="segment in statusSegments" :key="segment.key" class="flex items-center gap-2 text-sm text-foreground"><span class="h-2 w-2 shrink-0 rounded-full" :class="segment.class" aria-hidden="true"></span>{{ segment.label }} <strong>{{ segment.value }}</strong></span></div>
      </Card>

      <ConfirmDialog
        :open="Boolean(draftToDiscard)"
        title="捨棄草稿"
        :description="`確定要捨棄 ${draftToDiscard?.petId?.name || '這份'} 的草稿嗎？此操作無法復原。`"
        confirm-label="捨棄草稿"
        :loading="Boolean(deletingDraftId)"
        @update:open="(value) => !value && (draftToDiscard = null)"
        @confirm="discardDraft(draftToDiscard)"
      />
    </template>
  </section>
</template>
