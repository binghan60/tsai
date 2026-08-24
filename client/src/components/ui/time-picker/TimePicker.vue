<script setup>
import { computed, ref } from 'vue';
import { Clock, X } from '@lucide/vue';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { cn } from '@/lib/utils';

// 取代 <input type="time">，跟 DatePicker 取代 <input type="date"> 同一個理由：
// 原生時間選單各瀏覽器樣式不一，也套不進主題的明暗與品牌色。
// 用自製的時／分兩欄選單（Popover + 按鈕列表），而不是固定間隔的下拉選單——
// 兩欄各自獨立選才給得出任意時／分組合，不是只能點一份寫死的整段時間清單。
//
// ranges 是選填的掛號區間限制（[['10:00','11:30'], ['14:00','19:30']] 這種格式，含頭尾）：
// 這個元件本身不知道「診所幾點看診」，時段由呼叫端決定，元件只負責把選單收斂到區間內、
// 並在切換時／分時把選到一半的組合夾回合法範圍。不帶 ranges 就是原本不限制的 00:00–23:55。
const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '選擇時間' },
  ariaLabel: { type: String, default: undefined },
  id: { type: String, default: undefined },
  ranges: { type: Array, default: () => [] },
  minuteStep: { type: Number, default: 5 },
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
const emit = defineEmits(['update:modelValue']);

const ALL_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const ALL_MINUTES = computed(() => Array.from({ length: Math.ceil(60 / props.minuteStep) }, (_, i) => String(i * props.minuteStep).padStart(2, '0')));

const open = ref(false);

function parseParts(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  return match ? { hour: match[1], minute: match[2] } : { hour: '', minute: '' };
}

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// 這個小時裡，哪幾個「分鐘刻度」落在任一段 ranges 內。沒帶 ranges 時整小時的刻度都合法。
function validMinutesForHour(hour) {
  if (!props.ranges.length) return ALL_MINUTES.value;
  const hourStart = Number(hour) * 60;
  const hourEnd = hourStart + 59;
  const valid = new Set();
  for (const [start, end] of props.ranges) {
    const overlapStart = Math.max(hourStart, toMinutes(start));
    const overlapEnd = Math.min(hourEnd, toMinutes(end));
    for (let m = overlapStart; m <= overlapEnd; m += 1) valid.add(m - hourStart);
  }
  return ALL_MINUTES.value.filter((minute) => valid.has(Number(minute)));
}

const HOURS = computed(() => (props.ranges.length ? ALL_HOURS.filter((hour) => validMinutesForHour(hour).length > 0) : ALL_HOURS));

const parts = computed(() => parseParts(props.modelValue));
const effectiveHour = computed(() => parts.value.hour || HOURS.value[0] || '');
const MINUTES = computed(() => (effectiveHour.value ? validMinutesForHour(effectiveHour.value) : ALL_MINUTES.value));

const label = computed(() => props.modelValue || '');

// 換小時後原本選的分鐘可能超出新小時的合法範圍（例如從 10:45 切到 11 點，掛號區間只到 11:30）——
// 夾到不超過的最大合法分鐘，取不到就退回這個小時第一個合法分鐘。
function clampMinute(hour, minute) {
  const valid = validMinutesForHour(hour);
  if (!valid.length) return minute;
  if (valid.includes(minute)) return minute;
  const numeric = Number(minute);
  const fallback = [...valid].reverse().find((candidate) => Number(candidate) <= numeric);
  return fallback ?? valid[0];
}

function selectHour(hour) {
  emit('update:modelValue', `${hour}:${clampMinute(hour, parts.value.minute || '00')}`);
}
function selectMinute(minute) {
  emit('update:modelValue', `${effectiveHour.value || '00'}:${minute}`);
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
