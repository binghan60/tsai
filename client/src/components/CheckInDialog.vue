<script setup>
import { computed, ref } from 'vue';
import { useForm, useField } from 'vee-validate';
import { UserCheck } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { clinicTimeInput } from '../lib/datetime';

const props = defineProps({
  appointment: { type: Object, required: true },
  late: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const requiredRule = (value) => (value && String(value).trim() !== '') || '必填';
// vee-validate 將 validator 回傳的字串視為錯誤訊息；不能直接回傳 petId。
// 回診的三個身分欄位雖然隱藏，仍會參與表單驗證，必須明確回傳 true，
// 否則送出會被靜默攔下。
const patientFieldRule = (value) => (props.appointment.petId ? true : requiredRule(value));
const { handleSubmit } = useForm({
  initialValues: {
    ownerName: props.appointment.ownerName || '',
    ownerPhone: props.appointment.ownerPhone || '',
    petName: props.appointment.petName || '',
  },
});
const { value: ownerName, errorMessage: ownerNameError } = useField('ownerName', patientFieldRule);
const { value: ownerPhone, errorMessage: ownerPhoneError } = useField('ownerPhone', patientFieldRule);
const { value: petName, errorMessage: petNameError } = useField('petName', patientFieldRule);
const lateAt = ref(clinicTimeInput(new Date()));
const latenessMinutes = computed(() => Math.max(0, Math.floor((new Date(`${props.appointment.date}T${lateAt.value}`).getTime() - new Date(props.appointment.scheduledAt).getTime()) / 60000)));

const onSubmit = handleSubmit((values) => emit('submit', { ...values, isLate: props.late, lateAt: lateAt.value }));
</script>

<template>
  <ModalDialog size="sm" @close="$emit('close')">
    <div class="flex items-center gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/70 bg-accent/80 text-accent-foreground shadow-sm">
        <UserCheck class="h-5.5 w-5.5" stroke-width="1.8" />
      </div>
      <div>
        <DialogTitle>報到</DialogTitle>
        <DialogDescription class="mt-0.5 text-xs">初診：確認寵物與飼主身分後即可建立正式病歷、進入候診時間軸</DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="onSubmit">
      <div class="space-y-4 p-6 pt-3 sm:p-7 sm:pt-3">
        <div v-if="!appointment.petId" class="space-y-1.5">
          <Label for="checkin-owner-name" class="text-xs font-medium text-foreground">飼主姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Input id="checkin-owner-name" v-model="ownerName" class="border-border" autofocus />
          <p v-if="ownerNameError" class="text-xs font-medium text-destructive">{{ ownerNameError }}</p>
        </div>
        <div v-if="!appointment.petId" class="space-y-1.5">
          <Label for="checkin-owner-phone" class="text-xs font-medium text-foreground">聯絡電話<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Input id="checkin-owner-phone" v-model="ownerPhone" class="border-border" />
          <p v-if="ownerPhoneError" class="text-xs font-medium text-destructive">{{ ownerPhoneError }}</p>
        </div>
        <div v-if="!appointment.petId" class="space-y-1.5">
          <Label for="checkin-pet-name" class="text-xs font-medium text-foreground">寵物姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Input id="checkin-pet-name" v-model="petName" class="border-border" />
          <p v-if="petNameError" class="text-xs font-medium text-destructive">{{ petNameError }}</p>
        </div>
        <div v-if="late" class="space-y-2 rounded-xl bg-warning-surface p-3 text-sm text-warning"><label class="block space-y-1.5 font-medium">實際到院時間<Input v-model="lateAt" type="time" step="60" /></label><p>將依此時間記錄遲到 {{ latenessMinutes }} 分鐘。</p></div>
        <Alert v-if="errorMessage" variant="destructive" class="mt-2">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" class="px-5" @click="$emit('close')">取消</Button>
        <Button type="submit" class="px-5" :disabled="submitting">{{ submitting ? '處理中…' : '確認報到' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
