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
import { clinicDateInput, shiftDateInput, shortDate, weekdayLabel } from '../lib/datetime';

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
  // 已報到的掛號只能改時段、不能改日期（人就在診所裡）
  dateLocked: { type: Boolean, default: false },
  label: { type: String, default: '日期與時段' },
  required: { type: Boolean, default: true },
  // 並排：日期、診療時間（與 #aside 放進來的欄位）一窄欄在左，時段格在右。櫃台處理視窗用——
  // 那裡寬度夠，直排會讓時段格掉到要捲的地方。依自己的寬度排（container query），放不下就退回直排。
  split: { type: Boolean, default: false },
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
  const when = date.value === today ? '今天' : shortDate(date.value);
  return `${props.petName || '這隻貓咪'}${when} ${found.map((item) => item.time || '未定時段').join('、')} 已有掛號${found[0].reason ? `（${found[0].reason}）` : ''}，確認不是重複掛號。`;
});

// 約回診常用的間隔，從今天算。
const quickDates = [
  { days: 3, label: '3 天後' },
  { days: 7, label: '1 週後' },
  { days: 14, label: '2 週後' },
  { days: 28, label: '4 週後' },
].map((option) => ({ ...option, date: shiftDateInput(today, option.days) }));

function changeDuration(delta) {
  duration.value = Math.min(MAX_ESTIMATED_DURATION_MINUTES, Math.max(15, Number(duration.value) + delta));
}
</script>

<template>
  <div :class="split ? '@container' : ''">
  <!-- 並排的門檻 42rem：扣掉左欄 18.75rem，時段格還有約 22rem（四欄每格約 85px，放得下「14:30」）。 -->
  <div :class="split ? 'grid gap-3 @2xl:grid-cols-[18.75rem_minmax(0,1fr)] @2xl:gap-6' : 'space-y-3'">
  <div class="space-y-3">
    <div class="space-y-2">
      <Label class="text-xs font-medium">{{ label }}<template v-if="required"><span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></template></Label>
      <div class="flex items-center gap-2">
        <DatePicker v-model="date" :clearable="clearable && !dateLocked" :disabled="dateLocked" aria-label="預約日期" class="min-w-0 flex-1" />
        <Button v-if="!dateLocked" type="button" variant="secondary" class="h-10 shrink-0 px-5" @click="date = today">今天</Button>
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
      <!-- 並排（約回診）時六個一排、平分寬度：左欄只有 18.75rem，按鈕不留最小寬度與左右內距才排得下。 -->
      <div :class="split ? 'grid grid-cols-6 gap-1' : 'flex flex-wrap gap-1.5'">
        <Button v-for="minutes in [15, 30, 45, 60, 90, 120]" :key="minutes" type="button" size="sm" class="h-9 text-xs font-semibold shadow-sm" :class="split ? 'min-w-0 px-0' : 'min-w-12 px-2'" :variant="duration === minutes ? 'default' : 'secondary'" @click="duration = minutes">{{ minutes }}</Button>
      </div>
    </div>
    <slot name="aside" />
  </div>
  <div :class="split ? 'flex flex-col gap-3' : 'space-y-3'">
    <SlotGrid v-if="date" v-model="time" :sessions="sessions" :duration-minutes="Number(duration)" :invalid="showErrors && Boolean(!time || overflowError)" />
    <!-- 並排（約回診）還沒選日期時，時段格的位置放常用的回診間隔：點一下就選好日期、時段格接著出現。
         原本是一大塊虛線框寫「先選日期」——大部分就診都會當場約回診，這塊空著最浪費。 -->
    <div v-else-if="split" class="space-y-2">
      <Label class="text-xs font-medium">快速選日期</Label>
      <div class="grid grid-cols-2 gap-2">
        <Button v-for="option in quickDates" :key="option.date" type="button" variant="secondary" class="h-auto flex-col items-start gap-0.5 py-2" @click="date = option.date">
          <span class="text-sm font-semibold">{{ option.label }}</span>
          <span class="num text-xs text-muted-foreground">{{ shortDate(option.date) }}（{{ weekdayLabel(option.date) }}）</span>
        </Button>
      </div>
    </div>
    <p v-if="showErrors && date && !time" class="text-xs font-medium text-destructive">請選擇預約時段</p>
    <p v-if="overflowError" class="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{{ overflowError }}</p>
    <Alert v-if="duplicateWarning" class="border-warning/35 bg-warning-surface text-warning">
      <AlertDescription>{{ duplicateWarning }}</AlertDescription>
    </Alert>
  </div>
  </div>
  </div>
</template>
