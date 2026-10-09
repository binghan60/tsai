<script setup>
import { computed, ref } from 'vue';
import { CalendarCheck, CalendarX, Pencil } from '@lucide/vue';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import DepositEditDialog from './DepositEditDialog.vue';
import EmptyState from './EmptyState.vue';
import DepositBadge from './DepositBadge.vue';
import LatenessBadge from './LatenessBadge.vue';
import ListFooter from './ListFooter.vue';
import ListSkeleton from './ListSkeleton.vue';
import SpecCell from './SpecCell.vue';
import SpecGrid from './SpecGrid.vue';
import { clinicTimeInput, formatDate, relativeDayLabel } from '../lib/datetime';

// 取消時間：日期＋時刻（診所時區）。
const cancelledLabel = (value) => [formatDate(value), clinicTimeInput(value)].filter(Boolean).join(' ');

// 貓咪詳情頁的「出席紀錄」頁籤：這隻貓遲到與未到的逐筆清單（資料來自掛號），上面一排次數。
// 約診時決定過保證金（已收／這次不收）的掛號也列在同一份清單——收了之後次數歸零，
// 排在一起才看得出是哪幾次換來這筆保證金；那種列本身沒有遲到或未到時（kind 是 deposit），狀況欄留白。
// 已取消的掛號也列在這裡（kind 是 cancelled）：狀況欄是「已取消」加取消時間，來院原因下面一行取消原因。
// 取消不算進上面那排次數，也不影響保證金門檻。
// 每一列右邊的鉛筆可以事後更正那筆掛號的保證金紀錄（收錯、漏記、後來才退）；沿用到下一筆的不能改，要改下一筆。
// 查詢在 usePetAttendance，改完發 changed 讓頁面重讀。
const props = defineProps({
  // 這隻貓的 { lateCount, lastLateDate, noShowCount, lastNoShowDate }
  counts: { type: Object, default: null },
  items: { type: Array, required: true },
  page: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  total: { type: Number, required: true },
  pageSize: { type: Number, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
const emit = defineEmits(['update:page', 'changed']);

const editing = ref(null);
function onSaved() {
  editing.value = null;
  emit('changed');
}

const summary = computed(() => [
  { label: '遲到', count: props.counts?.lateCount },
  { label: '未到', count: props.counts?.noShowCount },
].filter((cell) => cell.count > 0));

function dateLabel(date) {
  return String(date ?? '').replaceAll('-', '/');
}
// 保證金是約診那天決定的，跟這一列的看診日期不是同一天，滑過徽章時說清楚。
function depositTip(item) {
  const day = formatDate(item.depositDecidedAt);
  if (!day) return undefined;
  if (item.depositStatus === 'waived') return `${day} 約診時決定不收`;
  return `${day} 約診時收的`;
}
</script>

<template>
  <div class="space-y-4">
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <Card class="gap-0 overflow-hidden p-0" style="--data-columns: 13rem 5.5rem 5.5rem 15rem minmax(11rem, 0.9fr) minmax(8rem, 1fr) 2.25rem">
      <div v-if="summary.length" class="border-b border-border px-5 py-4">
        <SpecGrid>
          <SpecCell v-for="cell in summary" :key="cell.label" :label="cell.label"><span class="text-danger"><span class="num">{{ cell.count }}</span> 次</span></SpecCell>
        </SpecGrid>
      </div>

      <ListSkeleton v-if="loading && !items.length" :rows="3" :avatar="false" inset />
      <EmptyState v-else-if="!items.length" :icon="CalendarCheck" title="沒有遲到、未到、取消或保證金的紀錄" inset />
      <template v-else>
        <div class="hidden lg:block">
          <div class="desktop-data-header">
            <span class="desktop-data-cell">日期</span>
            <span class="desktop-data-cell">預約</span>
            <span class="desktop-data-cell">到院</span>
            <span class="desktop-data-cell">狀況</span>
            <span class="desktop-data-cell">保證金</span>
            <span class="desktop-data-cell">來院原因</span>
            <span class="desktop-data-cell"></span>
          </div>
          <div v-for="item in items" :key="item._id" class="desktop-data-row">
            <span class="desktop-data-cell flex items-baseline gap-2 whitespace-nowrap"><span class="num text-sm text-foreground">{{ dateLabel(item.date) }}</span><span class="text-xs text-subtle-foreground">{{ relativeDayLabel(item.date) }}</span></span>
            <span class="desktop-data-cell num text-sm">{{ item.time }}</span>
            <span class="desktop-data-cell num text-sm">{{ clinicTimeInput(item.checkedInAt) }}</span>
            <span class="desktop-data-cell flex items-center gap-2">
              <LatenessBadge v-if="item.kind === 'late'" :minutes="item.latenessMinutes" />
              <Badge v-else-if="item.kind === 'no_show'" variant="status" class="bg-danger-surface font-semibold text-danger"><CalendarX stroke-width="1.75" aria-hidden="true" />未到</Badge>
              <template v-else-if="item.cancelled">
                <Badge variant="status" class="shrink-0 bg-sunken text-muted-foreground">已取消</Badge>
                <span class="num truncate text-sm text-muted-foreground">{{ cancelledLabel(item.cancelledAt) }}</span>
              </template>
            </span>
            <span class="desktop-data-cell flex items-center gap-2">
              <span v-if="item.depositStatus === 'collected'" v-tip="depositTip(item)" class="inline-flex"><DepositBadge status="collected" /></span>
              <template v-else-if="item.depositStatus === 'waived'">
                <Badge variant="status" class="shrink-0 bg-sunken text-muted-foreground" v-tip="depositTip(item)">這次不收</Badge>
                <span class="min-w-0 truncate text-sm text-muted-foreground" v-tip.overflow="item.depositWaiveReason">{{ item.depositWaiveReason }}</span>
              </template>
              <Badge v-else-if="item.depositStatus === 'refunded'" variant="status" class="shrink-0 bg-sunken text-muted-foreground" v-tip="depositTip(item)">已退還</Badge>
              <Badge v-else-if="item.depositStatus === 'carried'" variant="status" class="shrink-0 bg-sunken text-muted-foreground" v-tip="depositTip(item)">沿用到下一筆</Badge>
            </span>
            <span class="desktop-data-cell min-w-0 text-sm">
              <span class="block truncate" v-tip.overflow="item.reason">{{ item.reason }}</span>
              <span v-if="item.cancelReason" class="block truncate text-muted-foreground" v-tip.overflow="item.cancelReason">取消原因　{{ item.cancelReason }}</span>
            </span>
            <span class="flex justify-end"><Button v-if="item.depositStatus !== 'carried'" type="button" variant="secondary" size="icon-sm" :aria-label="`修改 ${dateLabel(item.date)} 的保證金紀錄`" @click="editing = item"><Pencil stroke-width="1.75" /></Button></span>
          </div>
        </div>

        <ul class="divide-y divide-border lg:hidden">
          <li v-for="item in items" :key="item._id" class="space-y-1.5 px-5 py-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="num text-sm font-medium text-foreground">{{ dateLabel(item.date) }}</span>
              <LatenessBadge v-if="item.kind === 'late'" :minutes="item.latenessMinutes" />
              <Badge v-else-if="item.kind === 'no_show'" variant="status" class="bg-danger-surface font-semibold text-danger"><CalendarX stroke-width="1.75" aria-hidden="true" />未到</Badge>
              <Badge v-else-if="item.cancelled" variant="status" class="shrink-0 bg-sunken text-muted-foreground">已取消</Badge>
              <DepositBadge v-if="item.depositStatus === 'collected'" status="collected" />
              <Badge v-else-if="item.depositStatus === 'waived'" variant="status" class="bg-sunken text-muted-foreground">這次不收</Badge>
              <Badge v-else-if="item.depositStatus === 'refunded'" variant="status" class="shrink-0 bg-sunken text-muted-foreground">保證金已退還</Badge>
              <Badge v-else-if="item.depositStatus === 'carried'" variant="status" class="shrink-0 bg-sunken text-muted-foreground">保證金沿用到下一筆</Badge>
              <span class="ml-auto"><Button v-if="item.depositStatus !== 'carried'" type="button" variant="secondary" size="icon-sm" :aria-label="`修改 ${dateLabel(item.date)} 的保證金紀錄`" @click="editing = item"><Pencil stroke-width="1.75" /></Button></span>
            </div>
            <p class="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
              <span>預約 <span class="num text-foreground">{{ item.time }}</span></span>
              <span v-if="item.checkedInAt">到院 <span class="num text-foreground">{{ clinicTimeInput(item.checkedInAt) }}</span></span>
              <span v-if="item.reason" class="text-foreground">{{ item.reason }}</span>
              <span v-if="item.depositWaiveReason">不收原因 <span class="text-foreground">{{ item.depositWaiveReason }}</span></span>
              <span v-if="item.cancelledAt">取消 <span class="num text-foreground">{{ cancelledLabel(item.cancelledAt) }}</span></span>
              <span v-if="item.cancelReason">取消原因 <span class="text-foreground">{{ item.cancelReason }}</span></span>
            </p>
          </li>
        </ul>

        <ListFooter :page="page" :total-pages="totalPages" :total="total" :page-size="pageSize" @update:page="emit('update:page', $event)" />
      </template>
    </Card>

    <DepositEditDialog v-if="editing" :item="editing" @saved="onSaved" @close="editing = null" />
  </div>
</template>
