<script setup>
import { computed, ref } from 'vue';
import { CalendarClock, Search, X } from '@lucide/vue';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { DatePicker } from './ui/date-picker';
import { formatDate } from '@/lib/datetime';

// 全站清單頁共用的搜尋膠囊，取代原本一張固定佔版面的表單（關鍵字＋兩個日期欄位＋
// 搜尋／清除四個並排元件）。日期範圍平常收在「篩選日期」這顆次要按鈕裡，點了才展開，
// 沒在用日期篩選的頁面（飼主、寵物）不會平白多一塊空的表單。
//
// 全站搜尋一律走提交式（見這裡沒有 debounce watch）：按 Enter、按送出鈕、或彈出層裡按
// 套用才會真的查詢——這是先前特地從即時搜尋改回來的決定，理由是邊打邊查在每個系統
// 打字習慣不一樣的情況下容易誤觸，這個元件延續同一個判準。
const props = defineProps({
  id: { type: String, required: true },
  label: { type: String, required: true },
  placeholder: { type: String, default: '' },
  modelValue: { type: String, default: '' },
  withDateRange: { type: Boolean, default: false },
  dateFrom: { type: String, default: '' },
  dateTo: { type: String, default: '' },
  dateFromLabel: { type: String, default: '起始日期' },
  dateToLabel: { type: String, default: '結束日期' },
});

const emit = defineEmits(['update:modelValue', 'update:dateFrom', 'update:dateTo', 'submit']);

const dateOpen = ref(false);

const hasActiveFilter = computed(() => Boolean(props.modelValue || props.dateFrom || props.dateTo));
const hasDateRange = computed(() => Boolean(props.dateFrom || props.dateTo));

const dateRangeLabel = computed(() => {
  if (!hasDateRange.value) return '篩選日期';
  const from = props.dateFrom ? formatDate(props.dateFrom) : '';
  const to = props.dateTo ? formatDate(props.dateTo) : '';
  if (from && to) return `${from} － ${to}`;
  return from || to;
});

function clearAll() {
  emit('update:modelValue', '');
  emit('update:dateFrom', '');
  emit('update:dateTo', '');
  emit('submit');
}

function clearDates() {
  emit('update:dateFrom', '');
  emit('update:dateTo', '');
}

function applyDates() {
  dateOpen.value = false;
  emit('submit');
}
</script>

<template>
  <form
    class="flex items-center gap-1 rounded-full border border-border bg-card p-1.5 shadow-sm dark:shadow-none"
    role="search"
    @submit.prevent="emit('submit')"
  >
    <label class="flex min-w-0 flex-1 self-stretch items-center gap-2.5 pl-3.5">
      <span class="sr-only">{{ label }}</span>
      <Search class="h-4 w-4 shrink-0 text-muted-foreground" stroke-width="1.9" aria-hidden="true" />
      <input
        :id="id"
        type="text"
        autocomplete="off"
        :placeholder="placeholder"
        :value="modelValue"
        :aria-label="label"
        class="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        @input="emit('update:modelValue', $event.target.value)"
      />
    </label>

    <Button v-if="hasActiveFilter" type="button" variant="secondary" size="icon-xs" :aria-label="`清除${label}`" @click="clearAll">
      <X class="h-3.5 w-3.5" stroke-width="1.9" />
    </Button>

    <template v-if="withDateRange">
      <span class="h-5.5 w-px shrink-0 bg-border"></span>
      <Popover v-model:open="dateOpen">
        <PopoverTrigger as-child>
          <Button type="button" variant="secondary" size="sm" class="shrink-0 gap-1.5 rounded-full px-3.5 text-xs" :class="hasDateRange ? 'text-foreground' : ''">
            <CalendarClock class="h-3.5 w-3.5" stroke-width="1.75" />
            <span class="whitespace-nowrap">{{ dateRangeLabel }}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto" align="end">
          <div class="flex items-end gap-3">
            <label class="space-y-1 text-xs font-medium text-muted-foreground">
              <span>{{ dateFromLabel }}</span>
              <DatePicker :model-value="dateFrom" :aria-label="dateFromLabel" class="w-40" @update:model-value="emit('update:dateFrom', $event)" />
            </label>
            <label class="space-y-1 text-xs font-medium text-muted-foreground">
              <span>{{ dateToLabel }}</span>
              <DatePicker :model-value="dateTo" :aria-label="dateToLabel" class="w-40" @update:model-value="emit('update:dateTo', $event)" />
            </label>
          </div>
          <div class="mt-3 flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" :disabled="!hasDateRange" @click="clearDates">清除</Button>
            <Button type="button" variant="outline" size="sm" @click="applyDates">套用</Button>
          </div>
        </PopoverContent>
      </Popover>
    </template>

    <Button type="submit" size="icon-sm" :aria-label="`搜尋${label}`" class="shrink-0">
      <Search class="h-4 w-4" stroke-width="2" />
    </Button>
  </form>
</template>
