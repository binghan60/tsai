<script setup>
import { useForm, useField } from 'vee-validate';
import ModalDialog from './ModalDialog.vue';

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
    <v-card-title class="px-0">{{ title }}</v-card-title>

    <v-form @submit.prevent="onSubmit">
      <v-text-field v-model="name" label="姓名" :error-messages="nameError ? [nameError] : []" />
      <v-text-field v-model="phone" label="電話" :error-messages="phoneError ? [phoneError] : []" />
      <v-text-field v-model="email" label="Email（選填）" type="email" :error-messages="emailError ? [emailError] : []" />

      <v-alert v-if="errorMessage" type="error" density="compact" class="mb-4">{{ errorMessage }}</v-alert>

      <div class="flex justify-end gap-2">
        <v-btn variant="text" @click="$emit('close')">取消</v-btn>
        <v-btn type="submit" color="primary" :loading="submitting">{{ submitLabel }}</v-btn>
      </div>
    </v-form>
  </ModalDialog>
</template>
