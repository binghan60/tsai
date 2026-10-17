<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { http } from '../api/http';
import { clinicDateInput, clinicTimeInput, elapsedLabel } from '../lib/datetime';
import { shortDateTime } from '../lib/hospitalization';
import { useLiveReload } from '../composables/useLiveReload';
import StrayBadge from './StrayBadge.vue';

// 掛號台流程列下面一段：住院中的貓（不限今天的掛號——收住院那次看診只在入院當天的時間軸上）。
// 跟診療台「住院中」同一套淡藍底；一隻一列：第幾天、名字、住院原因、今天體重、最後一筆照護紀錄。
// 點一列在右側開住院速覽（不離開掛號台）。沒有住院中的貓就整段不畫。只在看今天時由掛號台掛上。
defineProps({
  // 目前在住院速覽打開的那一筆，框起來。
  activeId: { type: String, default: '' },
});
const emit = defineEmits(['open']);

const stays = ref([]);
const now = ref(Date.now());
let clock;

async function load() {
  try {
    const { data } = await http.get('/hospitalizations', { params: { status: 'admitted' } });
    stays.value = data.items ?? [];
  } catch {
    // 讀不到就維持原樣；下一次住院有異動會再讀。
  }
}

useLiveReload(load, { events: ['hospitalization:updated', 'patients:updated'] });
onMounted(() => {
  load();
  clock = setInterval(() => {
    now.value = Date.now();
  }, 30000);
});
onBeforeUnmount(() => clearInterval(clock));

// 今天的寫時刻＋經過多久；更早的寫日期時間。
function lastEntry(value) {
  if (!value) return { time: '', elapsed: '' };
  if (clinicDateInput(value) !== clinicDateInput(new Date(now.value))) return { time: shortDateTime(value), elapsed: '' };
  return { time: clinicTimeInput(value), elapsed: elapsedLabel(value, now.value).text };
}
</script>

<template>
  <section v-if="stays.length" class="rounded-xl bg-info-surface px-3 pt-2 pb-3" aria-labelledby="reception-stays-heading">
    <h2 id="reception-stays-heading" class="px-2 pb-1.5 text-xs font-semibold text-info">住院中 <span class="num">{{ stays.length }}</span></h2>
    <ul class="grid gap-2 lg:grid-cols-2">
      <li v-for="stay in stays" :key="stay._id">
        <button
          type="button"
          class="grid min-h-13 w-full grid-cols-[4rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-lg bg-card px-4 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-border sm:grid-cols-[4rem_minmax(0,1fr)_5.5rem_7.5rem]"
          :class="activeId === String(stay._id) ? 'ring-2 ring-primary' : ''"
          :aria-pressed="activeId === String(stay._id)"
          @click="emit('open', stay)"
        >
          <span class="text-sm font-semibold text-info">第 <span class="num">{{ stay.dayNumber }}</span> 天</span>
          <span class="flex min-w-0 items-center gap-2.5">
            <span class="shrink-0 text-base font-semibold">{{ stay.pet?.name }}</span>
            <StrayBadge v-if="stay.pet?.isStray" />
            <span class="min-w-0 truncate text-sm text-muted-foreground" v-tip.overflow="stay.reason">{{ stay.reason }}</span>
          </span>
          <span class="col-start-2 text-sm sm:col-start-auto">
            <span class="spec-label block leading-tight">今天體重</span>
            <span class="num block min-h-lh"><template v-if="stay.todayWeightKg !== null && stay.todayWeightKg !== undefined">{{ stay.todayWeightKg }} kg</template></span>
          </span>
          <span class="col-start-2 text-sm sm:col-start-auto">
            <span class="spec-label block leading-tight">最後紀錄</span>
            <span class="block min-h-lh truncate"><span class="num">{{ lastEntry(stay.lastEntryAt).time }}</span><span v-if="lastEntry(stay.lastEntryAt).elapsed" class="num text-subtle-foreground">　{{ lastEntry(stay.lastEntryAt).elapsed }}</span></span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>
