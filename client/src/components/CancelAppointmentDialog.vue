<script setup>
import { computed, ref } from 'vue';
import { CalendarX2 } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import OptionButtons from './OptionButtons.vue';
import { DEPOSIT_AMOUNT } from '../../../shared/deposit.js';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';

const props = defineProps({
  appointment: { type: Object, required: true },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);
const cancelReason = ref('');

// 這筆掛號收過保證金：取消時要說這筆錢的去向（shared/deposit.js）。
// 先留著＝下次約診沿用、不再收；已退還＝次數不歸零，下次約診照樣要求收。
const hasDeposit = computed(() => props.appointment.depositStatus === 'collected');
const depositOutcome = ref('');
const depositError = ref('');
const DEPOSIT_OPTIONS = [
  { value: 'kept', label: '先留著，下次沿用' },
  { value: 'refunded', label: '已退還' },
];

function submit() {
  if (hasDeposit.value && !depositOutcome.value) {
    depositError.value = '請選擇保證金先留著或已退還';
    return;
  }
  emit('submit', cancelReason.value.trim(), hasDeposit.value ? depositOutcome.value : '');
}
</script>

<template>
  <ModalDialog size="sm" @close="$emit('close')">
    <div class="flex items-start gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive-surface text-destructive">
        <CalendarX2 class="h-5 w-5" stroke-width="1.75" />
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

        <div v-if="hasDeposit" class="space-y-2 rounded-lg bg-warning-surface px-3.5 py-3 text-warning">
          <p class="font-semibold">這筆掛號已收保證金 <span class="num">{{ DEPOSIT_AMOUNT }}</span> 元，這筆錢要怎麼處理？</p>
          <OptionButtons :model-value="depositOutcome" :options="DEPOSIT_OPTIONS" aria-label="保證金的去向" @update:model-value="(value) => { depositOutcome = value; depositError = ''; }" />
          <p v-if="depositOutcome === 'refunded'" class="text-sm">退還後這隻貓下次約診會再被要求收保證金。</p>
          <p v-if="depositError" class="text-xs font-medium text-destructive">{{ depositError }}</p>
        </div>

        <Alert v-if="errorMessage" variant="destructive">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" class="px-5" :disabled="submitting" @click="$emit('close')">返回</Button>
        <Button type="submit" variant="destructive-solid" class="px-5" :disabled="submitting">{{ submitting ? '取消中…' : '確認取消' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
