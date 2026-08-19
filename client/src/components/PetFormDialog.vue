<script setup>
import { useForm, useField } from 'vee-validate';
import { Cat, Activity } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
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
    <div class="flex items-center gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-belle-300/70 bg-belle-50/80 text-belle-600 shadow-sm dark:border-brand-500/35 dark:bg-brand-500/10 dark:text-brand-400">
        <Cat class="h-5.5 w-5.5" stroke-width="1.8" />
      </div>
      <div>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription class="mt-0.5 text-xs">請填寫寵物的基本資訊與健康紀錄</DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="onSubmit">
      <div class="space-y-6 p-6 pt-3 sm:p-7 sm:pt-3">
        <!-- Section 1: 基本資料 -->
        <div class="space-y-3.5">
          <div class="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="pet-name" class="text-xs font-medium text-ink-700 dark:text-zinc-300">寵物名字 <span class="text-belle-600 dark:text-brand-400">*</span></Label>
              <Input id="pet-name" v-model="name" class="min-h-11 border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40" autofocus placeholder="例：咪咪" />
              <p v-if="nameError" class="text-xs font-medium text-destructive">{{ nameError }}</p>
            </div>
            <div class="space-y-1.5">
              <Label for="pet-species" class="text-xs font-medium text-ink-700 dark:text-zinc-300">物種 <span class="text-belle-600 dark:text-brand-400">*</span></Label>
              <Input id="pet-species" v-model="species" class="min-h-11 border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40" placeholder="例：貓、狗" />
              <p v-if="speciesError" class="text-xs font-medium text-destructive">{{ speciesError }}</p>
            </div>
            <div class="space-y-1.5">
              <Label for="pet-breed" class="text-xs font-medium text-ink-700 dark:text-zinc-300">品種</Label>
              <Input id="pet-breed" v-model="breed" class="min-h-11 border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40" placeholder="例：米克斯、美短" />
            </div>
            <div class="space-y-1.5">
              <Label for="pet-birth-date" class="text-xs font-medium text-ink-700 dark:text-zinc-300">生日</Label>
              <Input id="pet-birth-date" v-model="birthDate" type="date" class="min-h-11 border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40" />
            </div>
            <div class="space-y-1.5">
              <Label for="pet-sex" class="text-xs font-medium text-ink-700 dark:text-zinc-300">性別</Label>
              <Select v-model="sex">
                <SelectTrigger id="pet-sex" class="min-h-11 w-full border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in sexOptions" :key="option.value" :value="option.value">{{ option.title }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label for="pet-neutered" class="text-xs font-medium text-ink-700 dark:text-zinc-300">絕育狀態</Label>
              <Select v-model="neutered">
                <SelectTrigger id="pet-neutered" class="min-h-11 w-full border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in neuteredOptions" :key="option.value" :value="option.value">{{ option.title }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label for="pet-weight" class="text-xs font-medium text-ink-700 dark:text-zinc-300">目前體重（kg）</Label>
              <Input id="pet-weight" v-model="weightKg" type="number" min="0" step="0.1" class="min-h-11 border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40" placeholder="例：4.5" />
            </div>
          </div>
        </div>

        <!-- Section 2: 重要健康摘要 -->
        <div class="space-y-4 border-t border-cream-200/90 pt-5 dark:border-zinc-800">
          <div class="flex items-center gap-2">
            <Activity class="h-4 w-4 text-belle-600 dark:text-brand-400" stroke-width="2" />
            <h3 class="text-xs font-semibold tracking-wide text-ink-900 uppercase dark:text-white">重要健康摘要</h3>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="pet-allergies" class="text-xs font-medium text-ink-700 dark:text-zinc-300">過敏紀錄</Label>
              <Textarea id="pet-allergies" v-model="allergies" rows="2" class="border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40" placeholder="例：對某類抗生素過敏" />
            </div>
            <div class="space-y-1.5">
              <Label for="pet-chronic" class="text-xs font-medium text-ink-700 dark:text-zinc-300">慢性病／重要病史</Label>
              <Textarea id="pet-chronic" v-model="chronicConditions" rows="2" class="border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40" placeholder="例：慢性腎臟病二期" />
            </div>
            <div class="space-y-1.5">
              <Label for="pet-medications" class="text-xs font-medium text-ink-700 dark:text-zinc-300">目前用藥</Label>
              <Textarea id="pet-medications" v-model="currentMedications" rows="2" class="border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40" placeholder="例：每日降血壓藥物" />
            </div>
            <div class="space-y-1.5">
              <Label for="pet-notes" class="text-xs font-medium text-ink-700 dark:text-zinc-300">其他備註</Label>
              <Textarea id="pet-notes" v-model="notes" rows="2" class="border-cream-300/90 dark:border-zinc-700 dark:bg-zinc-950/40" placeholder="例：看診較為緊張" />
            </div>
          </div>
        </div>

        <Alert v-if="errorMessage" variant="destructive" class="mt-2">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" class="min-h-11 px-5 border-cream-300 hover:bg-cream-200/70 dark:border-zinc-700 dark:hover:bg-zinc-800" @click="$emit('close')">取消</Button>
        <Button type="submit" class="min-h-11 px-5" :disabled="submitting">{{ submitting ? '處理中…' : submitLabel }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
