<script setup>
import { computed } from 'vue';
import { CalendarCheck, CalendarX } from '@lucide/vue';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import EmptyState from './EmptyState.vue';
import LatenessBadge from './LatenessBadge.vue';
import ListFooter from './ListFooter.vue';
import ListSkeleton from './ListSkeleton.vue';
import SpecCell from './SpecCell.vue';
import SpecGrid from './SpecGrid.vue';
import { clinicTimeInput, relativeDayLabel } from '../lib/datetime';

// 貓咪詳情頁的「出席紀錄」頁籤：這隻貓遲到與未到的逐筆清單（資料來自掛號），上面一排次數。
// 純顯示，查詢在 usePetAttendance。
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
const emit = defineEmits(['update:page']);

const summary = computed(() => [
  { label: '遲到', count: props.counts?.lateCount },
  { label: '未到', count: props.counts?.noShowCount },
].filter((cell) => cell.count > 0));

function dateLabel(date) {
  return String(date ?? '').replaceAll('-', '/');
}
</script>

<template>
  <div class="space-y-4">
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <Card class="gap-0 overflow-hidden p-0" style="--data-columns: 13rem 5.5rem 5.5rem 9rem minmax(8rem, 1fr)">
      <div v-if="summary.length" class="border-b border-border px-5 py-4">
        <SpecGrid>
          <SpecCell v-for="cell in summary" :key="cell.label" :label="cell.label"><span class="text-danger"><span class="num">{{ cell.count }}</span> 次</span></SpecCell>
        </SpecGrid>
      </div>

      <ListSkeleton v-if="loading && !items.length" :rows="3" :avatar="false" inset />
      <EmptyState v-else-if="!items.length" :icon="CalendarCheck" title="沒有遲到或未到的紀錄" inset />
      <template v-else>
        <div class="hidden lg:block">
          <div class="desktop-data-header">
            <span class="desktop-data-cell">日期</span>
            <span class="desktop-data-cell">預約</span>
            <span class="desktop-data-cell">到院</span>
            <span class="desktop-data-cell">狀況</span>
            <span class="desktop-data-cell">來院原因</span>
          </div>
          <div v-for="item in items" :key="item._id" class="desktop-data-row">
            <span class="desktop-data-cell flex items-baseline gap-2 whitespace-nowrap"><span class="num text-sm text-foreground">{{ dateLabel(item.date) }}</span><span class="text-xs text-subtle-foreground">{{ relativeDayLabel(item.date) }}</span></span>
            <span class="desktop-data-cell num text-sm">{{ item.time }}</span>
            <span class="desktop-data-cell num text-sm">{{ clinicTimeInput(item.checkedInAt) }}</span>
            <span class="desktop-data-cell">
              <LatenessBadge v-if="item.kind === 'late'" :minutes="item.latenessMinutes" />
              <Badge v-else variant="status" class="bg-danger-surface font-semibold text-danger"><CalendarX stroke-width="1.75" aria-hidden="true" />未到</Badge>
            </span>
            <span class="desktop-data-cell truncate text-sm" v-tip.overflow="item.reason">{{ item.reason }}</span>
          </div>
        </div>

        <ul class="divide-y divide-border lg:hidden">
          <li v-for="item in items" :key="item._id" class="space-y-1.5 px-5 py-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="num text-sm font-medium text-foreground">{{ dateLabel(item.date) }}</span>
              <LatenessBadge v-if="item.kind === 'late'" :minutes="item.latenessMinutes" />
              <Badge v-else variant="status" class="bg-danger-surface font-semibold text-danger"><CalendarX stroke-width="1.75" aria-hidden="true" />未到</Badge>
            </div>
            <p class="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
              <span>預約 <span class="num text-foreground">{{ item.time }}</span></span>
              <span v-if="item.checkedInAt">到院 <span class="num text-foreground">{{ clinicTimeInput(item.checkedInAt) }}</span></span>
              <span v-if="item.reason" class="text-foreground">{{ item.reason }}</span>
            </p>
          </li>
        </ul>

        <ListFooter :page="page" :total-pages="totalPages" :total="total" :page-size="pageSize" @update:page="emit('update:page', $event)" />
      </template>
    </Card>
  </div>
</template>
