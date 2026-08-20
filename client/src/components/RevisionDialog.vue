<script setup>
import { ref } from 'vue';
import { FilePenLine } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';

defineProps({
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});

const emit = defineEmits(['submit', 'close']);
const reason = ref('');

function submit() {
  emit('submit', reason.value.trim());
}
</script>

<template>
  <ModalDialog @close="emit('close')">
    <div class="flex items-center gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-brand-300/80 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300">
        <FilePenLine class="h-5 w-5" />
      </div>
      <div>
        <DialogTitle>建立修訂版</DialogTitle>
        <DialogDescription class="mt-0.5 text-xs">原報告會完整保留，系統將建立一份可編輯的新草稿。</DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-4 p-6 pt-3 sm:p-7 sm:pt-3">
        <div class="space-y-1.5">
          <Label for="revision-reason" class="text-xs font-medium text-foreground">修訂原因（選填）</Label>
          <Textarea id="revision-reason" v-model="reason" rows="4" placeholder="例：更正檢驗數值或補充照護建議" />
        </div>
        <Alert v-if="errorMessage" variant="destructive">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="submitting" @click="emit('close')">取消</Button>
        <Button type="submit" :disabled="submitting">{{ submitting ? '建立中…' : '建立修訂草稿' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
