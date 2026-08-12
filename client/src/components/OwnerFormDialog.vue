<script setup>
import { useForm, useField } from 'vee-validate';
import ModalDialog from './ModalDialog.vue';
import { DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';

const props = defineProps({
  title: { type: String, required: true },
  initialValue: { type: Object, default: () => ({ name: '', phone: '', email: '' }) },
  submitLabel: { type: String, default: '儲存' },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const requiredRule = (v) => (v && String(v).trim() !== '') || '必填';

const { handleSubmit } = useForm({ initialValues: props.initialValue });
const { value: name, errorMessage: nameError } = useField('name', requiredRule);
const { value: phone, errorMessage: phoneError } = useField('phone', requiredRule);
const { value: email, errorMessage: emailError } = useField('email');

const onSubmit = handleSubmit((values) => emit('submit', values));
</script>

<template>
  <ModalDialog @close="$emit('close')">
    <DialogHeader>
      <DialogTitle>{{ title }}</DialogTitle>
    </DialogHeader>

    <form class="space-y-4" @submit.prevent="onSubmit">
      <div class="space-y-1.5">
        <Label for="owner-name">姓名</Label>
        <Input id="owner-name" v-model="name" class="min-h-11" />
        <p v-if="nameError" class="text-xs text-destructive">{{ nameError }}</p>
      </div>

      <div class="space-y-1.5">
        <Label for="owner-phone">電話</Label>
        <Input id="owner-phone" v-model="phone" class="min-h-11" />
        <p v-if="phoneError" class="text-xs text-destructive">{{ phoneError }}</p>
      </div>

      <div class="space-y-1.5">
        <Label for="owner-email">Email（選填）</Label>
        <Input id="owner-email" v-model="email" type="email" class="min-h-11" />
        <p v-if="emailError" class="text-xs text-destructive">{{ emailError }}</p>
      </div>

      <Alert v-if="errorMessage" variant="destructive">
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <div class="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" class="min-h-11" @click="$emit('close')">取消</Button>
        <Button type="submit" class="min-h-11" :disabled="submitting">{{ submitting ? '處理中…' : submitLabel }}</Button>
      </div>
    </form>
  </ModalDialog>
</template>
