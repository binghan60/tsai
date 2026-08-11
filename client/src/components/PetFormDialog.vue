<script setup>
import { useForm, useField } from 'vee-validate';
import ModalDialog from './ModalDialog.vue';

const defaults = {
  name: '',
  species: '貓',
  breed: '',
  sex: 'unknown',
  neutered: 'unknown',
  birthDate: '',
  microchipNumber: '',
  weightKg: null,
  allergies: '',
  chronicConditions: '',
  currentMedications: '',
  notes: '',
};

const props = defineProps({
  title: { type: String, required: true },
  initialValue: {
    type: Object,
    default: () => ({
      name: '',
      species: '貓',
      breed: '',
      sex: 'unknown',
      neutered: 'unknown',
      birthDate: '',
      microchipNumber: '',
      weightKg: null,
      allergies: '',
      chronicConditions: '',
      currentMedications: '',
      notes: '',
    }),
  },
  submitLabel: { type: String, default: '儲存' },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const requiredRule = (value) => (value && String(value).trim() !== '') || '必填';
const { handleSubmit } = useForm({ initialValues: { ...defaults, ...props.initialValue } });
const { value: name, errorMessage: nameError } = useField('name', requiredRule);
const { value: species, errorMessage: speciesError } = useField('species', requiredRule);
const { value: breed } = useField('breed');
const { value: sex } = useField('sex');
const { value: neutered } = useField('neutered');
const { value: birthDate } = useField('birthDate');
const { value: microchipNumber } = useField('microchipNumber');
const { value: weightKg } = useField('weightKg');
const { value: allergies } = useField('allergies');
const { value: chronicConditions } = useField('chronicConditions');
const { value: currentMedications } = useField('currentMedications');
const { value: notes } = useField('notes');

const sexOptions = [
  { title: '未記錄', value: 'unknown' },
  { title: '公', value: 'male' },
  { title: '母', value: 'female' },
];
const neuteredOptions = [
  { title: '未記錄', value: 'unknown' },
  { title: '已絕育', value: 'yes' },
  { title: '未絕育', value: 'no' },
];

const onSubmit = handleSubmit((values) => {
  emit('submit', {
    ...values,
    birthDate: values.birthDate || null,
    weightKg: values.weightKg === '' || values.weightKg == null ? null : Number(values.weightKg),
  });
});
</script>

<template>
  <ModalDialog max-width="720" @close="$emit('close')">
    <v-card-title class="px-0 pb-4">{{ title }}</v-card-title>

    <v-form @submit.prevent="onSubmit">
      <div class="grid gap-x-4 sm:grid-cols-2">
        <v-text-field v-model="name" label="寵物名字 *" :error-messages="nameError ? [nameError] : []" autofocus />
        <v-text-field v-model="species" label="物種 *" placeholder="例如：貓、狗" :error-messages="speciesError ? [speciesError] : []" />
        <v-text-field v-model="breed" label="品種" />
        <v-text-field v-model="birthDate" label="生日" type="date" />
        <v-select v-model="sex" label="性別" :items="sexOptions" />
        <v-select v-model="neutered" label="絕育狀態" :items="neuteredOptions" />
        <v-text-field v-model="microchipNumber" label="晶片號碼" />
        <v-text-field v-model="weightKg" label="目前體重" type="number" min="0" step="0.1" suffix="kg" />
      </div>

      <div class="mt-1 border-t border-cream-300 pt-5 dark:border-zinc-700">
        <p class="mb-4 text-sm font-semibold text-ink-900 dark:text-white">重要健康摘要</p>
        <v-textarea v-model="allergies" label="過敏紀錄" rows="2" auto-grow />
        <v-textarea v-model="chronicConditions" label="慢性病／重要病史" rows="2" auto-grow />
        <v-textarea v-model="currentMedications" label="目前用藥" rows="2" auto-grow />
        <v-textarea v-model="notes" label="其他備註" rows="2" auto-grow />
      </div>

      <v-alert v-if="errorMessage" type="error" density="compact" class="mb-4">{{ errorMessage }}</v-alert>

      <div class="flex justify-end gap-2">
        <v-btn variant="text" @click="$emit('close')">取消</v-btn>
        <v-btn type="submit" color="primary" :loading="submitting">{{ submitLabel }}</v-btn>
      </div>
    </v-form>
  </ModalDialog>
</template>
