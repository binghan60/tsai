<script setup>
import { computed } from 'vue';

// 近 N 週的量值長條。單一序列的 change-over-time，所以：沒有圖例（標題就說明了它是什麼）、
// 沒有 y 軸刻度（要精確數字的人看直接標籤或 tooltip）、格線省掉。
// 色彩走 --chart-1 這個圖表專用 slot，不借 primary——理由寫在 style.css 該 token 上。
const props = defineProps({
  // [{ weekEnd: ISO 字串, count: Number }]，weekEnd 是「該週結束的隔天零點」
  data: { type: Array, default: () => [] },
  label: { type: String, default: '每週數量' },
});

function shortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

const max = computed(() => Math.max(1, ...props.data.map((item) => item.count ?? 0)));

const bars = computed(() =>
  props.data.map((item, index) => {
    const end = new Date(item.weekEnd);
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const count = item.count ?? 0;
    return {
      key: item.weekEnd ?? index,
      count,
      // 沒有健檢的那一週仍要留一條 2px 的底：高度歸零會讓人以為那一根不存在，
      // 「這週是 0」跟「沒有這週」在圖上必須看得出差別。
      heightPercent: count ? Math.max(8, Math.round((count / max.value) * 100)) : 2,
      range: `${shortDate(start)}–${shortDate(end)}`,
      isLatest: index === props.data.length - 1,
    };
  })
);

const firstRange = computed(() => bars.value[0]?.range.split('–')[0] ?? '');
const lastRange = computed(() => bars.value.at(-1)?.range.split('–')[1] ?? '');
const total = computed(() => props.data.reduce((sum, item) => sum + (item.count ?? 0), 0));
</script>

<template>
  <div v-if="bars.length">
    <!-- 直接標籤只給最新一根：每根都標數字會把圖變成一列數字，趨勢反而看不出來。 -->
    <div class="flex h-24 items-end gap-0.5" role="img" :aria-label="`${label}，近 ${bars.length} 週共 ${total} 份`">
      <div v-for="bar in bars" :key="bar.key" class="group relative flex h-full flex-1 flex-col justify-end">
        <span
          v-if="bar.isLatest && bar.count"
          class="mb-1 block text-center text-xs font-semibold tabular-nums text-foreground"
        >{{ bar.count }}</span>
        <span
          class="block w-full rounded-t-[4px] bg-chart-1 transition-opacity group-hover:opacity-80"
          :style="{ height: `${bar.heightPercent}%` }"
          :title="`${bar.range}：${bar.count} 份`"
        ></span>
      </div>
    </div>
    <div class="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs tabular-nums text-muted-foreground">
      <span>{{ firstRange }}</span>
      <span>{{ lastRange }}</span>
    </div>
    <!-- 顏色與長度之外的第二條路：螢幕閱讀器與列印都拿得到完整數字。 -->
    <ul class="sr-only">
      <li v-for="bar in bars" :key="`sr-${bar.key}`">{{ bar.range }}：{{ bar.count }} 份</li>
    </ul>
  </div>
</template>
