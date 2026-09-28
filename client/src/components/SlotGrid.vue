<script setup>
import { computed } from 'vue';
import { slotCellLabel } from '../lib/receptionBoard';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

// 掛號時段格：一格一個可掛的時間（15 分鐘），格內直接列出已經約在這個時間的貓咪名字。
// 取代 TimePicker 的原因是「兩點半有沒有空」這個問題，時間清單回答不了；
// 格子改成 15 分鐘後夠寬，名字直接寫在格子裡，連「兩點半是誰」都不用再點開看。
// 沒有分鐘表頭列：空格子自己用淡字標分鐘，有人的格子只顯示名字。
const props = defineProps({
  modelValue: { type: String, default: '' },
  // buildSlotGrid() 的結果
  sessions: { type: Array, required: true },
  durationMinutes: { type: Number, default: 15 },
  invalid: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

function minutesOf(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function timeOf(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const selectedRange = computed(() => {
  if (!props.modelValue) return new Set();
  const start = minutesOf(props.modelValue);
  return new Set(Array.from({ length: Math.ceil(props.durationMinutes / 15) }, (_, index) => timeOf(start + index * 15)));
});

function cellClass(cell) {
  if (cell.time === props.modelValue) return 'border-primary bg-primary text-primary-foreground font-semibold ring-2 ring-primary/25';
  if (selectedRange.value.has(cell.time) && cell.inRange) return 'border-primary/70 bg-primary/20 text-primary font-semibold ring-1 ring-primary/20';
  if (!cell.inRange) return 'invisible';
  if (cell.entries.length) return 'border-border bg-sunken text-foreground font-medium hover:border-primary';
  return 'border-border bg-field text-muted-foreground hover:border-primary';
}

// 每一格的顯示文字先算好，不在模板裡每格呼叫三次。
const grid = computed(() => props.sessions.map((session) => ({
  ...session,
  rows: session.rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const label = slotCellLabel(cell.entries);
      return { ...cell, label: label.names.join('、'), more: label.more, selectable: cell.inRange, cellClass: cellClass(cell) };
    }),
  })),
})));

const selectedExists = computed(() => props.sessions.some((session) => (
  session.rows.some((row) => row.cells.some((cell) => cell.inRange && cell.time === props.modelValue))
)));
</script>

<template>
  <div class="space-y-3">
    <div v-for="session in grid" :key="session.id" class="space-y-1">
      <p class="text-sm font-semibold text-muted-foreground">{{ session.label }} <span class="num font-normal text-subtle-foreground">{{ session.start }}–{{ session.end }}</span></p>
      <div v-for="row in session.rows" :key="row.hour" class="flex items-center gap-1.5">
        <span class="num w-12 shrink-0 text-sm text-subtle-foreground">{{ row.hour }}</span>
        <div class="grid flex-1 grid-cols-4 gap-1" :class="invalid && !modelValue ? 'rounded-md ring-2 ring-destructive/40' : ''">
          <TooltipProvider v-for="cell in row.cells" :key="cell.time" :delay-duration="100">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
            type="button"
            class="flex h-10 min-w-0 items-center justify-center overflow-hidden rounded-md border px-2 text-sm transition-colors disabled:cursor-not-allowed"
            :class="cell.cellClass"
            :disabled="!cell.selectable && cell.time !== modelValue"
            :aria-pressed="cell.time === modelValue"
            :aria-label="`${cell.time}${cell.entries.length ? `，已約 ${cell.entries.length} 位` : '，尚無預約'}${selectedRange.has(cell.time) ? '，本次預估診療範圍' : ''}`"
            @click="emit('update:modelValue', cell.time)"
          >
            <span v-if="cell.time === modelValue" class="num">{{ cell.time }}</span>
            <span v-else-if="selectedRange.has(cell.time)" class="truncate">診療<span v-if="cell.label">：{{ cell.label }}</span></span>
            <span v-else-if="cell.label" class="truncate">{{ cell.label }}<span v-if="cell.more" class="ml-1 font-semibold">+{{ cell.more }}</span></span>
            <span v-else class="num text-subtle-foreground/80">{{ cell.time.slice(3) }}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent
                v-if="cell.entries.length"
                side="top"
                align="center"
                :arrow="false"
                class="flex max-w-sm flex-col items-stretch gap-2 whitespace-normal rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-menu"
              >
                <div v-for="entry in cell.entries" :key="entry._id" class="space-y-1">
                  <p><span class="font-semibold">{{ entry.petName }}</span>　<span class="text-muted-foreground">{{ String(entry.reason || '').trim() }}</span></p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
    <p v-if="modelValue && !selectedExists" class="rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning">原本的時段 {{ modelValue }} 不在目前可選的格子上，儲存前請重新選一格。</p>
  </div>
</template>
