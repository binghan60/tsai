<script setup>
import { computed, ref, watch } from 'vue';
import { http } from '../api/http';
import SlotGrid from './SlotGrid.vue';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { DatePicker } from './ui/date-picker';
import { buildSlotGrid, duplicateBookings } from '../lib/receptionBoard';
import { MAX_ESTIMATED_DURATION_MINUTES, durationOverflowError } from '../lib/appointmentTime';
import { clinicDateInput, formatDate } from '../lib/datetime';

// 「什麼時候」的共用區塊：日期（＋今天）→ 預估診療時間 → 時段格。
// 所有排掛號的地方都用這一塊——掛號視窗、櫃台處理視窗的回診安排、初診表審核——
// 時段怎麼選、診療時間怎麼算、哪些格子不能選，全站只有一種長相與一套規則（lib/appointmentTime.js）。
// 送出前的驗證由呼叫端用 appointmentSlotErrors 做，這裡只負責顯示。
const date = defineModel('date', { type: String, default: '' });
const time = defineModel('time', { type: String, default: '' });
const duration = defineModel('duration', { type: Number, default: 15 });
const props = defineProps({
  // 呼叫端已經載入的某一天掛號（掛號台的時間軸），選到那天就直接用，不另外打 API
  dayItems: { type: Array, default: null },
  dayItemsDate: { type: String, default: '' },
  // 修改既有掛號時，自己不算佔用
  excludeId: { type: String, default: '' },
  // 同一隻貓那天已經有掛號時提醒（電話裡飼主常忘記早上已經掛過）
  petId: { type: String, default: '' },
  petName: { type: String, default: '' },
  // 按過送出之後才把「沒選」標紅
  showErrors: { type: Boolean, default: false },
  // 回診可以先不排（飼主還沒決定），日期要能清空
  clearable: { type: Boolean, default: false },
  label: { type: String, default: '日期與時段' },
  required: { type: Boolean, default: true },
});

const today = clinicDateInput();

// 換到呼叫端沒載入的那天，才自己去抓那天的掛號。
const fetchedItems = ref(null);
const usesProvided = computed(() => Boolean(props.dayItems) && date.value === props.dayItemsDate);
watch(date, async (value) => {
  fetchedItems.value = null;
  if (!value || usesProvided.value) return;
  try {
    const { data } = await http.get('/appointments', { params: { date: value } });
    if (date.value === value) fetchedItems.value = data.items ?? [];
  } catch {
    if (date.value === value) fetchedItems.value = [];
  }
}, { immediate: true });
const items = computed(() => (usesProvided.value ? props.dayItems : fetchedItems.value ?? []));

const sessions = computed(() => buildSlotGrid(items.value, { excludeId: props.excludeId }));
const overflowError = computed(() => (time.value ? durationOverflowError(time.value, duration.value) : ''));

const duplicateWarning = computed(() => {
  const found = duplicateBookings(items.value, props.petId, props.excludeId);
  if (!found.length) return '';
  const when = date.value === today ? '今天' : formatDate(date.value);
  return `${props.petName || '這隻貓咪'}${when} ${found.map((item) => item.time || '未定時段').join('、')} 已有掛號${found[0].reason ? `（${found[0].reason}）` : ''}，確認不是重複掛號。`;
});

function changeDuration(delta) {
  duration.value = Math.min(MAX_ESTIMATED_DURATION_MINUTES, Math.max(15, Number(duration.value) + delta));
}
</script>

<template>
  <div class="space-y-3">
    <div class="space-y-2">
      <Label class="text-xs font-medium">{{ label }}<template v-if="required"><span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></template></Label>
      <div class="flex items-center gap-2">
        <DatePicker v-model="date" :clearable="clearable" aria-label="預約日期" class="min-w-0 flex-1" />
        <Button type="button" class="h-10 shrink-0 px-5 font-semibold shadow-sm" @click="date = today">今天</Button>
      </div>
      <p v-if="showErrors && !date" class="text-xs font-medium text-destructive">請選擇日期</p>
    </div>
    <div class="space-y-2 rounded-lg border border-border bg-field/40 p-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Label class="text-xs font-medium">預估診療時間</Label>
        <div class="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" class="h-9 min-w-12 px-2 text-xs font-bold shadow-sm" :disabled="duration <= 15" aria-label="減少 15 分鐘" @click="changeDuration(-15)">−</Button>
          <span class="min-w-16 text-center text-xs font-semibold tabular-nums">{{ duration }} 分鐘</span>
          <Button type="button" variant="secondary" size="sm" class="h-9 min-w-12 px-2 text-xs font-bold shadow-sm" :disabled="duration >= MAX_ESTIMATED_DURATION_MINUTES" aria-label="增加 15 分鐘" @click="changeDuration(15)">＋</Button>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <Button v-for="minutes in [15, 30, 45, 60, 90, 120]" :key="minutes" type="button" size="sm" class="h-9 min-w-12 px-2 text-xs font-semibold shadow-sm" :variant="duration === minutes ? 'default' : 'secondary'" @click="duration = minutes">{{ minutes }}</Button>
      </div>
    </div>
    <SlotGrid v-if="date" v-model="time" :sessions="sessions" :duration-minutes="Number(duration)" :invalid="showErrors && Boolean(!time || overflowError)" />
    <p v-else class="rounded-lg bg-sunken px-3 py-3 text-sm text-subtle-foreground">先選日期，才看得到那天的時段。</p>
    <p v-if="showErrors && date && !time" class="text-xs font-medium text-destructive">請選擇預約時段</p>
    <p v-if="overflowError" class="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{{ overflowError }}</p>
    <Alert v-if="duplicateWarning" class="border-warning/35 bg-warning-surface text-warning">
      <AlertDescription>{{ duplicateWarning }}</AlertDescription>
    </Alert>
  </div>
</template>
