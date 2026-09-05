<script setup>
import { ref } from 'vue';
import { useField, useForm } from 'vee-validate';
import { Pencil } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { TimePicker } from './ui/time-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { APPOINTMENT_TIME_MINUTE_STEP, APPOINTMENT_TIME_RANGES } from '../lib/appointmentTime';

const props = defineProps({
  appointment: { type: Object, required: true },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
  templates: { type: Array, default: () => [] },
  defaultTemplateId: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const requiredRule = (value) => (value && String(value).trim() !== '') || '必填';
const requiredTime = (value) => (value && String(value).trim() !== '') || '請選擇預約時段';
const { handleSubmit } = useForm({
  initialValues: {
    ownerName: props.appointment.ownerName ?? '',
    ownerPhone: props.appointment.ownerPhone ?? '',
    petName: props.appointment.petName ?? '',
    species: props.appointment.species ?? '',
    time: props.appointment.time ?? '',
    reason: props.appointment.reason ?? '',
  },
});
// 飼主姓名選填（跟掛號對話框一致）——不然沒填飼主的初診掛號一打開編輯就存不回去。
const { value: ownerName } = useField('ownerName');
const { value: ownerPhone } = useField('ownerPhone');
const { value: petName, errorMessage: petNameError } = useField('petName', requiredRule);
const { value: species } = useField('species');
const { value: time, errorMessage: timeError } = useField('time', requiredTime);
const { value: reason } = useField('reason');
const templateId = ref(String(props.appointment.templateId || props.defaultTemplateId || ''));
const templateError = ref('');

const onSubmit = handleSubmit((values) => {
  if (!templateId.value) {
    templateError.value = '請選擇要開啟的表單';
    return;
  }
  emit('submit', {
  ownerName: values.ownerName?.trim() ?? '',
  ownerPhone: values.ownerPhone?.trim() ?? '',
  petName: values.petName.trim(),
  species: values.species?.trim() ?? '',
  time: values.time ?? '',
  reason: values.reason?.trim() ?? '',
  templateId: templateId.value,
  });
});
</script>

<template>
  <ModalDialog @close="$emit('close')">
    <div class="flex items-center gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/70 bg-accent/80 text-accent-foreground shadow-sm">
        <Pencil class="h-5 w-5" stroke-width="1.8" />
      </div>
      <div class="min-w-0">
        <DialogTitle>編輯掛號</DialogTitle>
        <DialogDescription class="mt-0.5 text-xs">只更新這筆掛號資料，不會修改飼主或寵物主檔</DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="onSubmit">
      <div class="space-y-4 p-6 pt-3 sm:p-7 sm:pt-3">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="edit-apt-pet-name" class="text-xs font-medium text-foreground">寵物姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
            <Input id="edit-apt-pet-name" v-model="petName" class="border-border" />
            <p v-if="petNameError" class="text-xs font-medium text-destructive">{{ petNameError }}</p>
          </div>
          <div class="space-y-1.5">
            <Label for="edit-apt-species" class="text-xs font-medium text-foreground">物種</Label>
            <Input id="edit-apt-species" v-model="species" class="border-border" placeholder="例：貓" />
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="edit-apt-owner-name" class="text-xs font-medium text-foreground">飼主姓名<span class="ml-1 font-normal text-muted-foreground">（選填）</span></Label>
            <Input id="edit-apt-owner-name" v-model="ownerName" class="border-border" />
          </div>
          <div class="space-y-1.5">
            <Label for="edit-apt-owner-phone" class="text-xs font-medium text-foreground">聯絡電話</Label>
            <Input id="edit-apt-owner-phone" v-model="ownerPhone" class="border-border" />
          </div>
        </div>

        <div class="space-y-1.5">
          <Label for="edit-apt-time" class="text-xs font-medium text-foreground">預約時段<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <TimePicker id="edit-apt-time" v-model="time" placeholder="選擇預約時段" :ranges="APPOINTMENT_TIME_RANGES" :minute-step="APPOINTMENT_TIME_MINUTE_STEP" />
          <p v-if="timeError" class="text-xs font-medium text-destructive">{{ timeError }}</p>
        </div>

        <div class="space-y-1.5">
          <Label for="edit-apt-template" class="text-xs font-medium text-foreground">看診表單<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Select v-model="templateId" @update:model-value="templateError = ''">
            <SelectTrigger id="edit-apt-template" class="w-full"><SelectValue placeholder="選擇看診完成後要開啟的表單" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="template in templates" :key="template._id" :value="template._id">{{ template.name }}</SelectItem>
            </SelectContent>
          </Select>
          <p v-if="templateError" class="text-xs font-medium text-destructive">{{ templateError }}</p>
        </div>

        <div class="space-y-1.5">
          <Label for="edit-apt-reason" class="text-xs font-medium text-foreground">來院原因（選填）</Label>
          <Textarea id="edit-apt-reason" v-model="reason" rows="2" class="border-border" placeholder="例：打疫苗、回診拿藥、不舒服" />
        </div>

        <Alert v-if="errorMessage" variant="destructive">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" class="px-5" :disabled="submitting" @click="$emit('close')">取消</Button>
        <Button type="submit" class="px-5" :disabled="submitting">{{ submitting ? '儲存中…' : '儲存變更' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
