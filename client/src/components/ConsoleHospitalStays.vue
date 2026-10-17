<script setup>
import { onMounted, ref } from 'vue';
import { http } from '../api/http';
import { clinicDateInput, clinicTimeInput } from '../lib/datetime';
import { shortDateTime } from '../lib/hospitalization';
import { useLiveReload } from '../composables/useLiveReload';

// 診療台「今日病患」的「進行中」最上面一段：住院中的貓（不限今天的掛號——收住院那次看診只在入院當天的清單上，
// 第二天起診療台就看不到牠了）。一隻一行：第幾天、名字、住院原因、最後一筆照護紀錄的時間；點了到住院專區。
// 沒有住院中的貓就整段不畫。只在看今天時由診療台掛上。
const stays = ref([]);

async function load() {
  try {
    const { data } = await http.get('/hospitalizations', { params: { status: 'admitted' } });
    stays.value = data.items ?? [];
  } catch {
    // 讀不到就維持原樣；下一次住院有異動會再讀。
  }
}

useLiveReload(load, { events: ['hospitalization:updated', 'patients:updated'] });
onMounted(load);

function lastEntry(value) {
  if (!value) return '';
  return clinicDateInput(value) === clinicDateInput() ? clinicTimeInput(value) : shortDateTime(value);
}
</script>

<template>
  <section v-if="stays.length" class="border-b border-border bg-info-surface" aria-labelledby="console-stays-heading">
    <h3 id="console-stays-heading" class="px-4 pt-2 pb-0.5 text-xs font-semibold text-info">住院中 <span class="num">{{ stays.length }}</span></h3>
    <ul class="pb-1">
      <li v-for="stay in stays" :key="stay._id">
        <router-link :to="`/hospital/${stay._id}`" class="flex items-center gap-2.5 px-4 py-1.5 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-border focus-visible:-outline-offset-2">
          <span class="w-14 shrink-0 text-sm font-semibold text-info">第 <span class="num">{{ stay.dayNumber }}</span> 天</span>
          <span class="max-w-[40%] shrink-0 truncate text-base font-semibold text-foreground">{{ stay.pet?.name }}</span>
          <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">{{ stay.reason }}</span>
          <span class="num shrink-0 text-sm text-foreground">{{ lastEntry(stay.lastEntryAt) }}</span>
        </router-link>
      </li>
    </ul>
  </section>
</template>
