<script setup>
import { computed, ref } from 'vue';
import { LogOut, Pill } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import DrugSuggestEditor from './DrugSuggestEditor.vue';
import SpecGrid from './SpecGrid.vue';
import SpecCell from './SpecCell.vue';
import { DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { DatePicker } from './ui/date-picker';
import { TimePicker } from './ui/time-picker';
import { Alert, AlertDescription } from './ui/alert';
import { clinicDateInput, clinicTimeInput, combineClinicDateTime } from '../lib/datetime';
import { shortDateTime, stayDays } from '../lib/hospitalization';

// 出院：出院時間（預設現在，可以改成稍早實際離開的時間）、出院備註、帶回家的藥。
// 帶回家的藥有寫就由伺服器開成一張待包藥的藥單（藥單畫面標「出院」）。
const props = defineProps({
  hospitalization: { type: Object, required: true },
  petName: { type: String, default: '' },
  // 最後一筆照護紀錄的時間、最後一天有填體重的日期：出院時間不能早於它們（那幾天的頁籤會消失）。
  lastRecordAt: { type: Date, default: null },
  lastWeightDate: { type: String, default: '' },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const now = new Date();
const date = ref(clinicDateInput(now));
const time = ref(clinicTimeInput(now));
const note = ref('');
const medication = ref('');
const medicationEditor = ref(null);

const dischargedAt = computed(() => combineClinicDateTime(date.value, time.value));
const tooEarly = computed(() => {
  const at = dischargedAt.value;
  if (!at) return false;
  // 出院時間只到分鐘：跟最後一筆比也只比到分鐘（同一分鐘剛記的那格不算早於它）。
  const lastMinute = props.lastRecordAt ? Math.floor(props.lastRecordAt.getTime() / 60000) * 60000 : null;
  return Boolean((lastMinute !== null && at.getTime() < lastMinute) ||(props.lastWeightDate && clinicDateInput(at) < props.lastWeightDate));
});
const days = computed(() => (dischargedAt.value ? stayDays(props.hospitalization.admittedAt, dischargedAt.value) : null));

function submit() {
  emit('submit', {
    dischargedAt: dischargedAt.value ? dischargedAt.value.toISOString() : undefined,
    dischargeNote: note.value.trim(),
    medication: medication.value,
  });
}
</script>

<template>
  <ModalDialog size="md" :title="`出院：${petName}`" :icon="LogOut" @close="emit('close')">
    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-5 px-6 py-5">
        <SpecGrid>
          <SpecCell label="入院" mono>{{ shortDateTime(hospitalization.admittedAt) }}</SpecCell>
          <SpecCell label="住院"><template v-if="days">{{ days }} 天</template></SpecCell>
        </SpecGrid>
        <div class="space-y-1.5">
          <span id="discharge-time-label" class="text-xs font-medium">出院時間</span>
          <div class="flex flex-wrap gap-2" role="group" aria-labelledby="discharge-time-label">
            <DatePicker v-model="date" aria-label="出院日期" :clearable="false" class="w-44" />
            <TimePicker v-model="time" aria-label="出院時刻" :minute-step="1" class="w-32" />
          </div>
        </div>
        <div class="space-y-1.5">
          <Label for="discharge-note" class="text-xs font-medium">出院備註</Label>
          <Textarea id="discharge-note" v-model="note" maxlength="2000" class="min-h-20" />
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center gap-2">
            <span id="discharge-medication-label" class="text-xs font-medium">帶回家的藥</span>
            <Button type="button" variant="secondary" size="xs" class="ml-auto" @click="medicationEditor?.openPicker()"><Pill stroke-width="1.75" />藥櫃</Button>
          </div>
          <DrugSuggestEditor ref="medicationEditor" id="discharge-medication" v-model="medication" aria-label="帶回家的藥" :min-rows="3" />
        </div>
        <p v-if="tooEarly" class="text-sm text-danger">出院時間早於最後一筆住院紀錄</p>
        <Alert v-if="errorMessage" variant="destructive"><AlertDescription>{{ errorMessage }}</AlertDescription></Alert>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" @click="emit('close')">取消</Button>
        <Button type="submit" :disabled="submitting || !dischargedAt || tooEarly">{{ submitting ? '處理中…' : '確定出院' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
