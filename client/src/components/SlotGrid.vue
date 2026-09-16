<script setup>
import { computed } from 'vue';

// 掛號時段格：一格一個可掛的時間，格內數字是已經約在這個時間的人數。
// 取代 TimePicker 的原因是「兩點半有沒有空」這個問題，時間清單回答不了。
const props = defineProps({
  modelValue: { type: String, default: '' },
  // buildSlotGrid() 的結果
  sessions: { type: Array, required: true },
  invalid: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

function selectable(cell) {
  return cell.inRange;
}

function cellClass(cell) {
  if (cell.time === props.modelValue) return 'border-primary bg-primary text-primary-foreground font-semibold';
  if (!cell.inRange) return 'invisible';
  if (cell.entries.length) return 'border-border bg-muted text-foreground font-medium hover:border-ring';
  return 'border-border bg-field text-muted-foreground hover:border-ring';
}

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
    <div v-for="session in sessions" :key="session.id" class="space-y-1.5">
      <p class="text-xs font-medium text-muted-foreground">{{ session.label }} {{ session.start }}–{{ session.end }}</p>
      <div v-if="session.rows.length" class="flex items-center gap-2 select-none" aria-hidden="true">
        <span class="w-11 shrink-0"></span>
        <div class="grid flex-1 grid-cols-12 gap-1 text-center text-[11px] font-medium tabular-nums text-muted-foreground">
          <span v-for="cell in session.rows[0].cells" :key="cell.time">
            {{ cell.time.slice(3) }}
          </span>
        </div>
      </div>
      <div v-for="row in session.rows" :key="row.hour" class="flex items-center gap-2">
        <span class="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{{ row.hour }}</span>
        <div class="grid flex-1 grid-cols-12 gap-1" :class="invalid && !modelValue ? 'rounded-md ring-2 ring-destructive/40' : ''">
          <button
            v-for="cell in row.cells"
            :key="cell.time"
            type="button"
            class="flex h-8 items-center justify-center rounded-md border text-xs tabular-nums transition-colors disabled:cursor-not-allowed"
            :class="cellClass(cell)"
            :disabled="!selectable(cell)"
            :aria-pressed="cell.time === modelValue"
            :aria-label="`${cell.time}${cell.entries.length ? `，已約 ${cell.entries.length} 位` : '，尚無預約'}`"
            :title="cell.inRange ? cell.time : ''"
            @click="emit('update:modelValue', cell.time)"
          >
            {{ cell.time === modelValue ? cell.time.slice(3) : cell.entries.length || '' }}
          </button>
        </div>
      </div>
    </div>
    <p v-if="selected" class="rounded-lg bg-field px-3 py-2 text-sm">
      {{ selected.time }}
      <template v-if="selected.entries.length">
        已有 {{ selected.entries.length }} 位：
        <template v-for="(entry, index) in selected.entries" :key="entry._id">
          <span v-if="index">、</span><span class="font-medium">{{ entry.petName }}</span><span v-if="entry.isSurgery" class="text-danger">（手術{{ entry.surgeryName ? `：${entry.surgeryName}` : '' }}）</span>
        </template>
      </template>
      <span v-else class="text-muted-foreground">尚無其他預約</span>
    </p>
  </div>
</template>
