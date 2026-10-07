<script setup>
import { computed } from 'vue';
import { Clock } from '@lucide/vue';
import { attendanceRows } from '../lib/attendance';

// 掛號視窗選了貓（或既有飼主）之後的出席對照表：一列一個對象、三欄（遲到、未到、最近一次）。
// 貓咪那列只算這隻貓，飼主那列算名下所有貓，所以上下對齊著看。
// 沒有紀錄的對象不列；全部都沒有就整塊不畫。次數是 0 的格子留白。
const props = defineProps({
  // [{ label, counts: { lateCount, lastLateDate, noShowCount, lastNoShowDate } | null }]
  entries: { type: Array, required: true },
});

const rows = computed(() => attendanceRows(props.entries));
</script>

<template>
  <div v-if="rows.length" class="rounded-lg bg-danger-surface px-3.5 py-2.5 text-danger">
    <table class="w-full border-collapse text-left text-sm">
      <thead>
        <tr class="text-2xs">
          <th scope="col" class="py-0.5 font-medium"><span class="inline-flex items-center gap-1.5"><Clock class="size-4" stroke-width="1.75" aria-hidden="true" />出席紀錄</span></th>
          <th scope="col" class="w-20 px-3 py-0.5 font-medium">遲到</th>
          <th scope="col" class="w-20 px-3 py-0.5 font-medium">未到</th>
          <th scope="col" class="w-24 py-0.5 pl-3 font-medium">最近一次</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.label" class="border-t border-danger/20">
          <th scope="row" class="max-w-0 truncate py-1.5 font-semibold" v-tip.overflow="row.label">{{ row.label }}</th>
          <td class="px-3 py-1.5 font-semibold"><template v-if="row.late"><span class="num">{{ row.late }}</span> 次</template></td>
          <td class="px-3 py-1.5 font-semibold"><template v-if="row.noShow"><span class="num">{{ row.noShow }}</span> 次</template></td>
          <td class="num py-1.5 pl-3">{{ row.last }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
