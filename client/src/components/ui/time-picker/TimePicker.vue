<script setup>
import { computed, ref } from 'vue';
import { Clock, X } from '@lucide/vue';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { cn } from '@/lib/utils';

// 取代 <input type="time">，跟 DatePicker 取代 <input type="date"> 同一個理由：
// 原生時間選單各瀏覽器樣式不一，也套不進主題的明暗與品牌色。
// 用自製的時／分兩欄選單（Popover + 按鈕列表），而不是固定間隔的下拉選單——
// 預約時間常常需要卡在任意分鐘（不一定是 5 或 15 的倍數），兩欄各自獨立選才給得出任意組合。
const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '選擇時間' },
  ariaLabel: { type: String, default: undefined },
  id: { type: String, default: undefined },
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
const emit = defineEmits(['update:modelValue']);

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

const open = ref(false);

function parseParts(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  return match ? { hour: match[1], minute: match[2] } : { hour: '', minute: '' };
}

const parts = computed(() => parseParts(props.modelValue));
const label = computed(() => props.modelValue || '');

function selectHour(hour) {
  emit('update:modelValue', `${hour}:${parts.value.minute || '00'}`);
}
function selectMinute(minute) {
  emit('update:modelValue', `${parts.value.hour || '00'}:${minute}`);
}
function clearTime(event) {
  event.stopPropagation();
  emit('update:modelValue', '');
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        :id="id"
        type="button"
        :aria-label="ariaLabel"
        :class="
          cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 text-sm text-foreground transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            props.class,
          )
        "
      >
        <span :class="label ? 'text-foreground' : 'text-muted-foreground'">{{ label || placeholder }}</span>
        <span class="flex shrink-0 items-center gap-1">
          <X v-if="label" class="h-3.5 w-3.5 text-muted-foreground transition-colors hover:text-foreground" stroke-width="1.75" @click="clearTime" />
          <Clock class="h-4 w-4 text-muted-foreground" stroke-width="1.75" />
        </span>
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-2">
      <div class="flex gap-1">
        <div class="h-56 w-14 overflow-y-auto">
          <button
            v-for="hour in HOURS"
            :key="hour"
            type="button"
            :class="
              cn(
                'block w-full rounded-lg px-2 py-1.5 text-center text-sm text-foreground transition-colors hover:bg-muted/60',
                parts.hour === hour && 'bg-belle-600 text-white hover:bg-belle-600 dark:bg-brand-600 dark:text-cream-50 dark:hover:bg-brand-600',
              )
            "
            @click="selectHour(hour)"
          >{{ hour }}</button>
        </div>
        <div class="h-56 w-14 overflow-y-auto">
          <button
            v-for="minute in MINUTES"
            :key="minute"
            type="button"
            :class="
              cn(
                'block w-full rounded-lg px-2 py-1.5 text-center text-sm text-foreground transition-colors hover:bg-muted/60',
                parts.minute === minute && 'bg-belle-600 text-white hover:bg-belle-600 dark:bg-brand-600 dark:text-cream-50 dark:hover:bg-brand-600',
              )
            "
            @click="selectMinute(minute)"
          >{{ minute }}</button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
