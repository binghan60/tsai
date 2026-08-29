<script setup>
import { ref } from 'vue';
import { CalendarX2 } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';

defineProps({
  appointment: { type: Object, required: true },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);
const cancelReason = ref('');

function submit() {
  emit('submit', cancelReason.value.trim());
}
</script>

<template>
  <ModalDialog size="sm" @close="$emit('close')">
    <div class="flex items-start gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive">
        <CalendarX2 class="h-5 w-5" stroke-width="1.8" />
      </div>
      <div class="min-w-0">
        <DialogTitle>取消這筆掛號？</DialogTitle>
        <DialogDescription class="mt-1 text-sm leading-relaxed">「{{ appointment.petName || '這筆掛號' }}」會移出今日候診流程，之後仍可從頁面下方恢復。</DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-4 p-6 pt-3 sm:p-7 sm:pt-3">
        <div class="space-y-1.5">
          <Label for="cancel-appointment-reason" class="text-xs font-medium text-foreground">取消原因（選填）</Label>
          <Textarea
            id="cancel-appointment-reason"
            v-model="cancelReason"
            rows="3"
            class="border-border"
            placeholder="例：飼主改期、症狀改善、聯絡不上"
          />
          <p class="text-right text-xs text-muted-foreground">{{ cancelReason.length }}/300</p>
        </div>

        <Alert v-if="errorMessage" variant="destructive">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" class="px-5 border-border hover:bg-muted/60" :disabled="submitting" @click="$emit('close')">返回</Button>
        <Button type="submit" variant="destructive-solid" class="px-5" :disabled="submitting">{{ submitting ? '取消中…' : '確認取消' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
