<script setup>
import { useForm, useField } from 'vee-validate';
import ModalDialog from './ModalDialog.vue';
import { DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

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
  <ModalDialog content-class="sm:max-w-2xl" @close="$emit('close')">
    <DialogHeader>
      <DialogTitle>{{ title }}</DialogTitle>
    </DialogHeader>

    <form class="space-y-5" @submit.prevent="onSubmit">
      <div class="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <Label for="pet-name">寵物名字</Label>
          <Input id="pet-name" v-model="name" class="min-h-11" autofocus />
          <p v-if="nameError" class="text-xs text-destructive">{{ nameError }}</p>
        </div>
        <div class="space-y-1.5">
          <Label for="pet-species">物種</Label>
          <Input id="pet-species" v-model="species" class="min-h-11" placeholder="例如：貓、狗" />
          <p v-if="speciesError" class="text-xs text-destructive">{{ speciesError }}</p>
        </div>
        <div class="space-y-1.5">
          <Label for="pet-breed">品種</Label>
          <Input id="pet-breed" v-model="breed" class="min-h-11" />
        </div>
        <div class="space-y-1.5">
          <Label for="pet-birth-date">生日</Label>
          <Input id="pet-birth-date" v-model="birthDate" type="date" class="min-h-11" />
        </div>
        <div class="space-y-1.5">
          <Label>性別</Label>
          <Select v-model="sex">
            <SelectTrigger class="min-h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in sexOptions" :key="option.value" :value="option.value">{{ option.title }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1.5">
          <Label>絕育狀態</Label>
          <Select v-model="neutered">
            <SelectTrigger class="min-h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in neuteredOptions" :key="option.value" :value="option.value">{{ option.title }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1.5">
          <Label for="pet-microchip">晶片號碼</Label>
          <Input id="pet-microchip" v-model="microchipNumber" class="min-h-11" />
        </div>
        <div class="space-y-1.5">
          <Label for="pet-weight">目前體重（kg）</Label>
          <Input id="pet-weight" v-model="weightKg" type="number" min="0" step="0.1" class="min-h-11" />
        </div>
      </div>

      <div class="space-y-4 border-t border-border pt-5">
        <p class="text-sm font-semibold text-ink-900 dark:text-white">重要健康摘要</p>
        <div class="space-y-1.5">
          <Label for="pet-allergies">過敏紀錄</Label>
          <Textarea id="pet-allergies" v-model="allergies" rows="2" />
        </div>
        <div class="space-y-1.5">
          <Label for="pet-chronic">慢性病／重要病史</Label>
          <Textarea id="pet-chronic" v-model="chronicConditions" rows="2" />
        </div>
        <div class="space-y-1.5">
          <Label for="pet-medications">目前用藥</Label>
          <Textarea id="pet-medications" v-model="currentMedications" rows="2" />
        </div>
        <div class="space-y-1.5">
          <Label for="pet-notes">其他備註</Label>
          <Textarea id="pet-notes" v-model="notes" rows="2" />
        </div>
      </div>

      <Alert v-if="errorMessage" variant="destructive">
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" class="min-h-11" @click="$emit('close')">取消</Button>
        <Button type="submit" class="min-h-11" :disabled="submitting">{{ submitting ? '處理中…' : submitLabel }}</Button>
      </div>
    </form>
  </ModalDialog>
</template>
