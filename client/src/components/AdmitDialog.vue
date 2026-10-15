<script setup>
import { computed, ref } from 'vue';
import { BedDouble } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import RichText from './RichText.vue';
import { DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { richTextToPlain } from '../../../shared/richText.js';

// 收住院（看診工作區底部的「收住院」）：住院原因預設帶來院原因。
// 這次看診已經寫的藥單會搬到住院第一筆照護紀錄的「用藥」（院內用藥記在住院紀錄，看診不開藥單），先列出來讓醫師看到。
const props = defineProps({
  appointment: { type: Object, required: true },
  prescription: { type: String, default: '' },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);
const reason = ref(props.appointment.reason ?? '');
const hasPrescription = computed(() => Boolean(richTextToPlain(props.prescription).trim()));
</script>

<template>
  <ModalDialog size="sm" :title="`收住院：${appointment.petName}`" :icon="BedDouble" @close="emit('close')">
    <form class="flex flex-col" @submit.prevent="emit('submit', reason.trim())">
      <div class="space-y-4 px-6 py-5">
        <div class="space-y-1.5">
          <Label for="admit-reason" class="text-xs font-medium">住院原因</Label>
          <Input id="admit-reason" v-model="reason" maxlength="200" />
        </div>
        <div v-if="hasPrescription" class="space-y-1.5">
          <span class="text-xs font-medium">這次看診已寫的藥單　→　住院第一筆的用藥</span>
          <RichText :text="prescription" class="block rounded-lg bg-sunken px-3.5 py-2.5 whitespace-pre-wrap" />
        </div>
        <Alert v-if="errorMessage" variant="destructive"><AlertDescription>{{ errorMessage }}</AlertDescription></Alert>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" @click="emit('close')">取消</Button>
        <Button type="submit" :disabled="submitting">{{ submitting ? '處理中…' : '收住院' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
