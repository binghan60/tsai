<script setup>
import { useForm, useField } from 'vee-validate';
import { User } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
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
    <div class="flex items-center gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-belle-300/70 bg-belle-50/80 text-belle-600 shadow-sm dark:border-brand-500/35 dark:bg-brand-500/10 dark:text-brand-400">
        <User class="h-5.5 w-5.5" stroke-width="1.8" />
      </div>
      <div>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription class="mt-0.5 text-xs">請填寫飼主的個人與聯絡資料</DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="onSubmit">
      <div class="space-y-4 p-6 pt-3 sm:p-7 sm:pt-3">
        <div class="space-y-1.5">
          <Label for="owner-name" class="text-xs font-medium text-ink-700 dark:text-zinc-300">姓名 <span class="text-belle-600 dark:text-brand-400">*</span></Label>
          <Input id="owner-name" v-model="name" class="min-h-11 border-cream-300/90 focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950/40" placeholder="例：王小明" autofocus />
          <p v-if="nameError" class="text-xs font-medium text-destructive">{{ nameError }}</p>
        </div>

        <div class="space-y-1.5">
          <Label for="owner-phone" class="text-xs font-medium text-ink-700 dark:text-zinc-300">電話 <span class="text-belle-600 dark:text-brand-400">*</span></Label>
          <Input id="owner-phone" v-model="phone" class="min-h-11 border-cream-300/90 focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950/40" placeholder="例：0912-345-678" />
          <p v-if="phoneError" class="text-xs font-medium text-destructive">{{ phoneError }}</p>
        </div>

        <div class="space-y-1.5">
          <Label for="owner-email" class="text-xs font-medium text-ink-700 dark:text-zinc-300">Email（選填）</Label>
          <Input id="owner-email" v-model="email" type="email" class="min-h-11 border-cream-300/90 focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950/40" placeholder="例：owner@example.com" />
          <p v-if="emailError" class="text-xs font-medium text-destructive">{{ emailError }}</p>
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
