<script setup>
import { computed } from 'vue';
import SurgeryBadge from './SurgeryBadge.vue';
import { slotCellLabel } from '../lib/receptionBoard';

// 掛號時段格：一格一個可掛的時間（15 分鐘），格內直接列出已經約在這個時間的寵物名字。
// 取代 TimePicker 的原因是「兩點半有沒有空」這個問題，時間清單回答不了；
// 格子改成 15 分鐘後夠寬，名字直接寫在格子裡，連「兩點半是誰」都不用再點開看。
// 沒有分鐘表頭列：空格子自己用淡字標分鐘，有人的格子只顯示名字。
const props = defineProps({
  modelValue: { type: String, default: '' },
  // buildSlotGrid() 的結果
  sessions: { type: Array, required: true },
  invalid: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

function cellClass(cell, session) {
  if (cell.time === props.modelValue) return 'border-primary bg-primary text-primary-foreground font-semibold';
  if (!cell.inRange) return 'invisible';
  if (cell.past) return 'border-border/60 bg-card text-muted-foreground/60';
  if (session.surgery) return cell.entries.length ? 'border-surgery/45 bg-surgery-surface text-surgery font-medium hover:border-surgery' : 'border-surgery/35 bg-surgery-surface/60 text-surgery/70 hover:border-surgery';
  if (cell.entries.length) return 'border-border bg-muted text-foreground font-medium hover:border-ring';
  return 'border-border bg-field text-muted-foreground hover:border-ring';
}

// 每一格的顯示文字先算好，不在模板裡每格呼叫三次。
const grid = computed(() => props.sessions.map((session) => ({
  ...session,
  rows: session.rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const label = slotCellLabel(cell.entries);
      return { ...cell, label: label.names.join('、'), more: label.more, selectable: cell.inRange && !cell.past, cellClass: cellClass(cell, session) };
    }),
  })),
})));

const selected = computed(() => {
  for (const session of props.sessions) {
    for (const row of session.rows) {
      const cell = row.cells.find((item) => item.time === props.modelValue);
      if (cell) return cell;
    }
  }
  return null;
});
</script>

<template>
  <div class="space-y-3">
    <div v-for="session in grid" :key="session.id" class="space-y-1">
      <p class="text-xs font-medium" :class="session.surgery ? 'text-surgery' : 'text-muted-foreground'">{{ session.label }} <span class="font-normal">{{ session.start }}–{{ session.end }}</span></p>
      <div v-for="row in session.rows" :key="row.hour" class="flex items-center gap-1.5">
        <span class="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">{{ row.hour }}</span>
        <div class="grid flex-1 grid-cols-4 gap-1" :class="invalid && !modelValue ? 'rounded-md ring-2 ring-destructive/40' : ''">
          <button
            v-for="cell in row.cells"
            :key="cell.time"
            type="button"
            class="flex h-10 min-w-0 items-center justify-center overflow-hidden rounded-md border px-2 text-xs tabular-nums transition-colors disabled:cursor-not-allowed"
            :class="cell.cellClass"
            :disabled="!cell.selectable && cell.time !== modelValue"
            :aria-pressed="cell.time === modelValue"
            :aria-label="`${cell.time}${cell.entries.length ? `，已約 ${cell.entries.length} 位` : '，尚無預約'}${cell.past ? '，已過' : ''}`"
            :title="cell.inRange ? cell.time : ''"
            @click="emit('update:modelValue', cell.time)"
          >
            <span v-if="cell.time === modelValue">{{ cell.time }}</span>
            <span v-else-if="cell.label" class="truncate">{{ cell.label }}<span v-if="cell.more" class="ml-1 font-semibold">+{{ cell.more }}</span></span>
            <span v-else class="text-muted-foreground/70">{{ cell.time.slice(3) }}</span>
          </button>
        </div>
      </div>
    </div>
    <div v-if="selected" class="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-field px-3 py-2 text-sm">
      <span class="font-semibold">{{ selected.time }}</span>
      <template v-if="selected.entries.length">
        <span>已有 {{ selected.entries.length }} 位：</span>
        <span v-for="(entry, index) in selected.entries" :key="entry._id" class="inline-flex max-w-full items-center gap-1.5">
          <span class="font-medium">{{ entry.petName }}</span>
          <SurgeryBadge v-if="entry.isSurgery" :name="entry.surgeryName" />
          <span v-if="index < selected.entries.length - 1">、</span>
        </span>
      </template>
      <span v-else class="text-muted-foreground">尚無其他預約</span>
    </div>
    <p v-else-if="modelValue" class="rounded-lg bg-warning-surface px-3 py-2 text-xs text-warning">原本的時段 {{ modelValue }} 不在目前可選的格子上，儲存前請重新選一格。</p>
  </div>
</template>
