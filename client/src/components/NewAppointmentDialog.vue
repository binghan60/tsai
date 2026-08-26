<script setup>
import { ref } from 'vue';
import { useForm, useField } from 'vee-validate';
import { UserPlus } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import SegmentedControl from './SegmentedControl.vue';
import PetPickerDialog from './PetPickerDialog.vue';

const props = defineProps({
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const MODE_OPTIONS = [
  { value: 'return', label: '回診' },
  { value: 'new', label: '初診' },
];
const mode = ref('return');
const selectedPet = ref(null);
const petPickerOpen = ref(false);
const pickPetError = ref('');

// 回診跟初診共用同一份表單，只是要不要驗證寵物/飼主姓名視 mode 而定——
// 切成兩份表單反而讓「預約時段」「來院原因」這兩個共用欄位要維護兩次。
const requiredForNewPatient = (value) => {
  if (mode.value !== 'new') return true;
  return (value && String(value).trim() !== '') || '必填';
};

const { handleSubmit } = useForm({ initialValues: { petName: '', ownerName: '', ownerPhone: '', time: '', reason: '' } });
const { value: petName, errorMessage: petNameError } = useField('petName', requiredForNewPatient);
const { value: ownerName, errorMessage: ownerNameError } = useField('ownerName', requiredForNewPatient);
const { value: ownerPhone } = useField('ownerPhone');
const { value: time } = useField('time');
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
    emit('submit', { petId: selectedPet.value._id, time: values.time, reason: values.reason });
    return;
  }
  emit('submit', {
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
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="onSubmit">
      <div class="space-y-4 p-6 pt-3 sm:p-7 sm:pt-3">
        <SegmentedControl v-model="mode" :options="MODE_OPTIONS" aria-label="病歷類型" />

        <template v-if="mode === 'return'">
          <div class="space-y-1.5">
            <Label class="text-xs font-medium text-foreground">寵物<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
            <button
              type="button"
              class="flex min-h-11 w-full items-center justify-between rounded-lg border border-border bg-field px-3.5 text-left text-sm hover:border-primary"
              @click="petPickerOpen = true"
            >
              <span v-if="selectedPet" class="min-w-0 truncate font-medium text-foreground">
                {{ selectedPet.ownerId?.name || '飼主未知' }}．{{ selectedPet.name }}（{{ selectedPet.species }}）
              </span>
              <span v-else class="text-muted-foreground">點擊搜尋既有飼主或寵物</span>
              <span class="shrink-0 text-primary">{{ selectedPet ? '更換' : '搜尋' }}</span>
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
              <Label for="apt-owner-name" class="text-xs font-medium text-foreground">飼主姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
              <Input id="apt-owner-name" v-model="ownerName" class="border-border" placeholder="例：王小姐" />
              <p v-if="ownerNameError" class="text-xs font-medium text-destructive">{{ ownerNameError }}</p>
            </div>
          </div>
          <div class="space-y-1.5">
            <Label for="apt-owner-phone" class="text-xs font-medium text-foreground">聯絡電話</Label>
            <Input id="apt-owner-phone" v-model="ownerPhone" class="border-border" placeholder="例：0912-345-678" />
          </div>
        </template>

        <div class="space-y-1.5">
          <Label for="apt-time" class="text-xs font-medium text-foreground">預約時段（選填）</Label>
          <Input id="apt-time" v-model="time" type="time" class="border-border" />
          <p class="text-xs text-muted-foreground">留空表示現在就在現場，將以登記時間顯示在時間軸上。</p>
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
