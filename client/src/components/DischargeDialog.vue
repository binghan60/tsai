<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { Check, LogOut, Pill } from '@lucide/vue';
import { http } from '../api/http';
import ModalDialog from './ModalDialog.vue';
import DrugSuggestEditor from './DrugSuggestEditor.vue';
import SpecGrid from './SpecGrid.vue';
import SpecCell from './SpecCell.vue';
import AppointmentSlotPicker from './AppointmentSlotPicker.vue';
import SurgeryField from './SurgeryField.vue';
import DepositField from './DepositField.vue';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';
import { DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { DatePicker } from './ui/date-picker';
import { TimePicker } from './ui/time-picker';
import { Alert, AlertDescription } from './ui/alert';
import { clinicDateInput, clinicTimeInput, combineClinicDateTime, shortDate, weekdayLabel } from '../lib/datetime';
import { DEFAULT_ESTIMATED_DURATION_MINUTES, appointmentSlotErrors } from '../lib/appointmentTime';
import { checkDepositDecision } from '../../../shared/deposit.js';
import { shortDateTime, stayDays } from '../lib/hospitalization';

// 出院：出院時間（預設現在，可以改成稍早實際離開的時間）、出院備註、請轉告飼主、回診建議、帶回家的藥。
// 帶回家的藥有寫就由伺服器開成一張待包藥的藥單（藥單畫面標「出院」）。
// 約回診可約可不約：勾選「回診」、選好日期與時段，就在出院的同一個 transaction 約（規則、保證金跟櫃台處理視窗約回診同一套），
// 沒勾＝這次不約。入院那次看診已經約好回診的，這裡只顯示、不重約。
const props = defineProps({
  hospitalization: { type: Object, required: true },
  petName: { type: String, default: '' },
  // 最後一筆照護紀錄的時間、最後一天有填體重的日期：出院時間不能早於它們（那幾天的頁籤會消失）。
  lastRecordAt: { type: Date, default: null },
  // 入院那次看診（回診掛在它上面）：{ _id, petId, petName, followUpAppointmentId, followUpDate, followUpTime }。
  appointment: { type: Object, default: null },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const now = new Date();
const date = ref(clinicDateInput(now));
const time = ref(clinicTimeInput(now));
const note = ref('');
const specialCareNote = ref('');
const followUpRecommendation = ref('');
const medication = ref('');
const medicationEditor = ref(null);

// ---- 約回診 ----
const booked = computed(() => Boolean(props.appointment?.followUpAppointmentId));
const followUp = ref({ date: '', time: '', duration: DEFAULT_ESTIMATED_DURATION_MINUTES, reason: '', isSurgery: false, surgeryName: '' });
const followUpAttempted = ref(false);
// 勾了「回診」才出現約診面板；沒勾就是這次不約（面板裡填的東西也不送）。
const wantFollowUp = ref(false);
const followUpStarted = computed(() => !booked.value && wantFollowUp.value);
const surgeryNameError = computed(() => (followUpAttempted.value && followUp.value.isSurgery && !followUp.value.surgeryName.trim() ? '請填寫手術名稱' : ''));
// 保證金：約回診也是約診，這隻貓達到門檻時要先選「已收」或「這次不收」。查不到狀態時不擋，由後端把關。
const depositState = ref(null);
const depositStatus = ref('');
const depositReason = ref('');
const depositError = ref('');
watch([depositStatus, depositReason], () => { depositError.value = ''; });
const depositNeeded = computed(() => !booked.value && Boolean(depositState.value?.required));
onMounted(async () => {
  if (!props.appointment?.petId || booked.value) return;
  try {
    const { data } = await http.get(`/pets/${props.appointment.petId}/attendance`, { params: { limit: 1 } });
    depositState.value = data.deposit ?? null;
  } catch {
    // 查不到就不顯示；需要收而沒問到時，送出會被後端擋下並說明。
  }
});
const localError = ref('');
function followUpError() {
  followUpAttempted.value = true;
  const { date, time, duration, isSurgery, surgeryName } = followUp.value;
  const errors = appointmentSlotErrors({ date, time, durationMinutes: duration });
  if (errors.date) return '請選擇回診日期';
  if (errors.time) return errors.time === '請選擇預約時段' ? '請選擇回診時段' : errors.time;
  if (isSurgery && !surgeryName.trim()) return '請填寫手術名稱';
  if (depositNeeded.value) {
    const deposit = checkDepositDecision({ status: depositStatus.value, reason: depositReason.value }, true);
    if (deposit.error) {
      depositError.value = deposit.error;
      return deposit.error;
    }
  }
  return '';
}
const whenLabel = (date, time) => `${shortDate(date)}（${weekdayLabel(date)}）${time}`;

const dischargedAt = computed(() => combineClinicDateTime(date.value, time.value));
const tooEarly = computed(() => {
  const at = dischargedAt.value;
  if (!at) return false;
  // 出院時間只到分鐘：跟最後一筆比也只比到分鐘（同一分鐘剛記的那格不算早於它）。
  const lastMinute = props.lastRecordAt ? Math.floor(props.lastRecordAt.getTime() / 60000) * 60000 : null;
  return lastMinute !== null && at.getTime() < lastMinute;
});
const days = computed(() => (dischargedAt.value ? stayDays(props.hospitalization.admittedAt, dischargedAt.value) : null));

function submit() {
  localError.value = followUpStarted.value ? followUpError() : '';
  if (localError.value) return;
  const { date, time, duration, reason, isSurgery, surgeryName } = followUp.value;
  emit('submit', {
    ...(followUpStarted.value ? {
      followUp: {
        followUpDate: date,
        followUpTime: time,
        estimatedDurationMinutes: Number(duration),
        // 來院原因沒填時帶上面寫的回診建議。
        reason: reason.trim() || followUpRecommendation.value.trim(),
        isSurgery,
        surgeryName: isSurgery ? surgeryName.trim() : '',
        ...(depositNeeded.value ? { deposit: { status: depositStatus.value, reason: depositReason.value.trim() } } : {}),
      },
    } : {}),
    dischargedAt: dischargedAt.value ? dischargedAt.value.toISOString() : undefined,
    dischargeNote: note.value.trim(),
    dischargeSpecialCareNote: specialCareNote.value.trim(),
    dischargeFollowUpRecommendation: followUpRecommendation.value.trim(),
    medication: medication.value,
  });
}
</script>

<template>
  <ModalDialog size="wide" :title="`出院：${petName}`" :icon="LogOut" @close="emit('close')">
    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-5 px-6 py-5">
        <!-- 第一排：入院、住院天數（跟著出院時間變）、出院時間，一眼對照。 -->
        <!-- 跟下面的表單同一個兩欄：左欄入院、住院，右欄出院時間（左邊緣、右邊緣都跟下面的欄位對齊）；小標題都在最上面同一條線。 -->
        <div class="grid items-start gap-5 sm:grid-cols-2">
          <SpecGrid>
            <SpecCell label="入院" mono>{{ shortDateTime(hospitalization.admittedAt) }}</SpecCell>
            <SpecCell label="住院"><template v-if="days">{{ days }} 天</template></SpecCell>
          </SpecGrid>
          <div class="flex min-w-0 flex-col gap-0.5">
            <span id="discharge-time-label" class="spec-label">出院時間</span>
            <div class="flex gap-2" role="group" aria-labelledby="discharge-time-label">
              <DatePicker v-model="date" aria-label="出院日期" :clearable="false" class="min-w-0 flex-1" />
              <TimePicker v-model="time" aria-label="出院時刻" :minute-step="1" class="w-36 shrink-0" />
            </div>
          </div>
        </div>
        <p v-if="tooEarly" class="-mt-2 text-sm text-danger">出院時間早於最後一筆住院紀錄</p>
        <div class="grid gap-5 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="discharge-note" class="text-xs font-medium">出院備註</Label>
            <Textarea id="discharge-note" v-model="note" maxlength="2000" class="min-h-24" />
          </div>
          <div class="space-y-1.5">
            <Label for="discharge-special-care" class="text-xs font-medium text-warning">請轉告飼主</Label>
            <Textarea id="discharge-special-care" v-model="specialCareNote" maxlength="500" class="min-h-24" />
          </div>
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center gap-2">
            <span id="discharge-medication-label" class="text-xs font-medium">帶回家的藥</span>
            <Button type="button" variant="secondary" size="xs" class="ml-auto" @click="medicationEditor?.openPicker()"><Pill stroke-width="1.75" />藥櫃</Button>
          </div>
          <DrugSuggestEditor ref="medicationEditor" id="discharge-medication" v-model="medication" aria-label="帶回家的藥" :min-rows="4" />
        </div>
        <!-- 回診：醫師建議（文字）接著預約，來院原因預設帶建議的文字。 -->
        <section class="space-y-3" aria-labelledby="discharge-followup-heading">
          <h3 id="discharge-followup-heading" class="text-base font-semibold">回診</h3>
          <div class="space-y-1.5">
            <Label for="discharge-follow-up" class="text-xs font-medium">回診建議</Label>
            <Textarea id="discharge-follow-up" v-model="followUpRecommendation" maxlength="500" class="min-h-20" />
          </div>
          <label v-if="!booked" class="flex w-fit cursor-pointer items-center gap-2.5 text-sm font-medium">
            <Checkbox v-model="wantFollowUp" aria-label="預約回診" />預約回診
          </label>
          <div v-if="booked" class="flex items-center gap-3 rounded-xl bg-success-surface px-4 py-3 text-success">
            <Check class="size-5" stroke-width="2" />
            <span class="font-semibold">已安排回診</span>
            <span class="num text-lg font-semibold">{{ whenLabel(appointment.followUpDate, appointment.followUpTime) }}</span>
          </div>
          <AppointmentSlotPicker
            v-else-if="wantFollowUp"
            v-model:date="followUp.date"
            v-model:time="followUp.time"
            v-model:duration="followUp.duration"
            :exclude-id="String(appointment?._id ?? '')"
            :pet-id="appointment?.petId ? String(appointment.petId) : ''"
            :pet-name="petName"
            :show-errors="followUpAttempted"
            :required="true"
            split
            label="回診日期"
          >
            <template #aside>
              <div class="space-y-1.5">
                <Label for="discharge-followup-reason">來院原因</Label>
                <Input id="discharge-followup-reason" v-model="followUp.reason" placeholder="例：拆線、複診" />
              </div>
              <SurgeryField v-model:is-surgery="followUp.isSurgery" v-model:surgery-name="followUp.surgeryName" :error="surgeryNameError" />
              <DepositField
                v-model:status="depositStatus"
                v-model:reason="depositReason"
                :state="depositState"
                :pet-name="petName"
                :error="depositError"
                id-prefix="discharge-deposit"
              />
            </template>
          </AppointmentSlotPicker>
        </section>
        <Alert v-if="localError || errorMessage" variant="destructive"><AlertDescription>{{ localError || errorMessage }}</AlertDescription></Alert>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" @click="emit('close')">取消</Button>
        <Button type="submit" :disabled="submitting || !dischargedAt || tooEarly">{{ submitting ? '處理中…' : '確定出院' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
