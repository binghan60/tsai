<script setup>
import { ref } from 'vue';
import { useForm, useField } from 'vee-validate';
import { ChevronRight, History, PawPrint, UserPlus } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { TimePicker } from './ui/time-picker';
import SegmentedControl from './SegmentedControl.vue';
import PetPickerDialog from './PetPickerDialog.vue';
import { APPOINTMENT_TIME_MINUTE_STEP, APPOINTMENT_TIME_RANGES } from '../lib/appointmentTime';
import { formatDate, weekdayLabel } from '../lib/datetime';

const props = defineProps({
  // 要掛在哪一天（YYYY-MM-DD）。跟著頁面上的日期面板走，不是永遠今天。
  date: { type: String, required: true },
  isToday: { type: Boolean, default: true },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const MODE_OPTIONS = [
  { value: 'return', label: '回診', icon: History },
  { value: 'new', label: '初診', icon: UserPlus },
];
const mode = ref('return');
const selectedPet = ref(null);
const petPickerOpen = ref(false);
const pickPetError = ref('');

// 回診跟初診共用同一份表單，只是要不要驗證寵物姓名視 mode 而定——
// 切成兩份表單反而讓「預約時段」「來院原因」這兩個共用欄位要維護兩次。
//
// 飼主姓名不在這裡驗：接電話掛號時常常只問得到寵物名跟電話。
// 它要到報到那一步才必填，因為那時要真的建立飼主資料（見 CheckInDialog）。
const requiredForNewPatient = (value) => {
  if (mode.value !== 'new') return true;
  return (value && String(value).trim() !== '') || '必填';
};
const requiredTime = (value) => (value && String(value).trim() !== '') || '請選擇預約時段';

const { handleSubmit } = useForm({ initialValues: { petName: '', ownerName: '', ownerPhone: '', time: '', reason: '' } });
const { value: petName, errorMessage: petNameError } = useField('petName', requiredForNewPatient);
const { value: ownerName } = useField('ownerName');
const { value: ownerPhone } = useField('ownerPhone');
const { value: time, errorMessage: timeError } = useField('time', requiredTime);
const { value: reason } = useField('reason');

function selectPet(pet) {
  selectedPet.value = pet;
  pickPetError.value = '';
  petPickerOpen.value = false;
}

const onSubmit = handleSubmit((values) => {
  if (mode.value === 'return') {
    if (!selectedPet.value) {
      pickPetError.value = '請先選擇寵物';
      return;
    }
    emit('submit', { date: props.date, visitType: 'return', petId: selectedPet.value._id, time: values.time, reason: values.reason });
    return;
  }
  emit('submit', {
    date: props.date,
    visitType: 'new',
    ownerName: values.ownerName,
    ownerPhone: values.ownerPhone,
    petName: values.petName,
    time: values.time,
    reason: values.reason,
  });
});
</script>

<template>
  <ModalDialog @close="$emit('close')">
    <div class="flex items-center gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/70 bg-accent/80 text-accent-foreground shadow-sm">
        <UserPlus class="h-5.5 w-5.5" stroke-width="1.8" />
      </div>
      <div>
        <DialogTitle>掛號</DialogTitle>
        <!-- 日期跟著頁面上的面板走。看的是別天卻掛到今天，是最容易發生也最難發現的錯。 -->
        <DialogDescription class="mt-0.5 text-xs">
          掛在 {{ formatDate(props.date) }}（{{ weekdayLabel(props.date) }}）<template v-if="props.isToday"> · 今天</template>
        </DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="onSubmit">
      <div class="space-y-4 p-6 pt-3 sm:p-7 sm:pt-3">
        <div class="space-y-1.5">
          <Label class="text-xs font-medium text-foreground">掛號類型</Label>
          <SegmentedControl v-model="mode" :options="MODE_OPTIONS" aria-label="掛號類型" full-width />
        </div>

        <template v-if="mode === 'return'">
          <div class="space-y-1.5">
            <Label class="text-xs font-medium text-foreground">寵物<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
            <button
              type="button"
              class="group flex h-11 w-full items-center gap-3 rounded-lg border border-input bg-field px-3 text-left text-sm transition-colors hover:border-ring hover:bg-muted focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
              :aria-label="selectedPet ? `更換寵物，目前為 ${selectedPet.name}` : '選擇既有寵物'"
              @click="petPickerOpen = true"
            >
              <PawPrint class="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" stroke-width="1.75" aria-hidden="true" />
              <span v-if="selectedPet" class="min-w-0 flex-1 truncate font-medium text-foreground">
                {{ selectedPet.ownerId?.name || '飼主未知' }}．{{ selectedPet.name }}（{{ selectedPet.species || '寵物' }}）
              </span>
              <span v-else class="min-w-0 flex-1 truncate text-muted-foreground">搜尋既有飼主或寵物</span>
              <span class="inline-flex shrink-0 items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-semibold text-secondary-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary" aria-hidden="true">
                {{ selectedPet ? '更換' : '選擇' }}<ChevronRight class="h-3.5 w-3.5" stroke-width="1.75" />
              </span>
            </button>
            <p v-if="pickPetError" class="text-xs font-medium text-destructive">{{ pickPetError }}</p>
          </div>
        </template>

        <template v-else>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="apt-pet-name" class="text-xs font-medium text-foreground">寵物姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
              <Input id="apt-pet-name" v-model="petName" class="border-border" placeholder="例：妞妞" />
              <p v-if="petNameError" class="text-xs font-medium text-destructive">{{ petNameError }}</p>
            </div>
            <div class="space-y-1.5">
              <Label for="apt-owner-name" class="text-xs font-medium text-foreground">飼主姓名<span class="ml-1 font-normal text-muted-foreground">（選填）</span></Label>
              <Input id="apt-owner-name" v-model="ownerName" class="border-border" placeholder="例：王小姐" />
            </div>
          </div>
          <div class="space-y-1.5">
            <Label for="apt-owner-phone" class="text-xs font-medium text-foreground">聯絡電話</Label>
            <Input id="apt-owner-phone" v-model="ownerPhone" class="border-border" placeholder="例：0912-345-678" />
          </div>
        </template>

        <div class="space-y-1.5">
          <Label for="apt-time" class="text-xs font-medium text-foreground">預約時段<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <TimePicker id="apt-time" v-model="time" placeholder="選擇預約時段" :ranges="APPOINTMENT_TIME_RANGES" :minute-step="APPOINTMENT_TIME_MINUTE_STEP" />
          <p v-if="timeError" class="text-xs font-medium text-destructive">{{ timeError }}</p>
        </div>

        <div class="space-y-1.5">
          <Label for="apt-reason" class="text-xs font-medium text-foreground">來院原因（選填）</Label>
          <Textarea id="apt-reason" v-model="reason" rows="2" class="border-border" placeholder="例：打疫苗、回診拿藥、不舒服" />
        </div>

        <Alert v-if="errorMessage" variant="destructive" class="mt-2">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" class="px-5 border-border hover:bg-muted/60" @click="$emit('close')">取消</Button>
        <Button type="submit" class="px-5" :disabled="submitting">{{ submitting ? '處理中…' : '確認' }}</Button>
      </DialogFooter>
    </form>

    <PetPickerDialog :open="petPickerOpen" @close="petPickerOpen = false" @select="selectPet" />
  </ModalDialog>
</template>
