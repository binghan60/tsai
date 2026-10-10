<script setup>
import { computed, ref } from 'vue';
import { UserCheck } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { TimePicker } from './ui/time-picker';
import SegmentedControl from './SegmentedControl.vue';
import { clinicTimeInput, combineClinicDateTime } from '../lib/datetime';

// 報到時要改實際到院時間（記遲到）或號碼牌時用；一般情況卡片上一鍵報到就好。
// 只有已建檔的貓走得到這裡：初診要先完成初診表審核。
const props = defineProps({
  appointment: { type: Object, required: true },
  late: { type: Boolean, default: false },
  suggestedCheckinNumber: { type: Number, default: 1 },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const ARRIVAL_MODE_OPTIONS = [
  { value: 'on-time', label: '準時' },
  { value: 'late', label: '遲到' },
];
const arrivalMode = ref(props.late ? 'late' : 'on-time');
const lateAt = ref(clinicTimeInput(new Date()));
const checkinNumber = ref(props.suggestedCheckinNumber);
const isLate = computed(() => arrivalMode.value === 'late');
// 跟伺服器同一種算法：診所時區的到院時刻減預約時刻。
const latenessMinutes = computed(() => {
  const arrival = combineClinicDateTime(props.appointment.date, lateAt.value);
  const scheduled = new Date(props.appointment.scheduledAt);
  if (!arrival || Number.isNaN(scheduled.getTime())) return 0;
  return Math.max(0, Math.floor((arrival.getTime() - scheduled.getTime()) / 60000));
});

function submit() {
  emit('submit', {
    isLate: isLate.value,
    lateAt: lateAt.value,
    // 沒改建議號碼就交給伺服器配（它看得到別台剛發出去的號碼）。
    ...(checkinNumber.value === props.suggestedCheckinNumber ? {} : { checkinNumber: checkinNumber.value }),
  });
}
</script>

<template>
  <ModalDialog size="sm" @close="emit('close')">
    <div class="flex items-center gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/70 bg-accent/80 text-accent-foreground shadow-sm">
        <UserCheck class="h-5.5 w-5.5" stroke-width="1.75" />
      </div>
      <div>
        <DialogTitle>報到：{{ appointment.petName }}</DialogTitle>
        <DialogDescription class="mt-0.5 text-xs">記下實際到院時間與發出去的號碼牌</DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-4 p-6 pt-3 sm:p-7 sm:pt-3">
        <div class="space-y-1.5">
          <Label class="text-xs font-medium text-foreground">報到狀態</Label>
          <SegmentedControl v-model="arrivalMode" :options="ARRIVAL_MODE_OPTIONS" aria-label="報到狀態" full-width />
        </div>
        <div v-if="isLate" class="space-y-2 text-sm">
          <label class="block space-y-1.5 font-medium">
            實際到院時間
            <TimePicker v-model="lateAt" aria-label="實際到院時間" :minute-step="1" />
          </label>
          <p>將依此時間記錄遲到 <span class="num">{{ latenessMinutes }}</span> 分鐘。</p>
        </div>
        <div class="space-y-1.5">
          <Label for="checkin-number" class="text-xs font-medium text-foreground">號碼牌</Label>
          <Input id="checkin-number" v-model.number="checkinNumber" type="number" min="1" step="1" class="num" />
          <p class="text-xs text-muted-foreground">系統已配發建議號碼；可輸入任何正整數，同號或曾使用過的號碼也可以。</p>
        </div>
        <Alert v-if="errorMessage" variant="destructive" class="mt-2">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" @click="emit('close')">取消</Button>
        <Button type="submit" :disabled="submitting">{{ submitting ? '處理中…' : '確認報到' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
