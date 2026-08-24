<script setup>
import { ref, watch } from 'vue';
import { ClipboardCheck } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

const props = defineProps({
  appointment: { type: Object, default: null },
  submitting: { type: Boolean, default: false },
});
const emit = defineEmits(['confirm', 'close']);

const checkinNumber = ref('');
watch(() => props.appointment, () => { checkinNumber.value = ''; });

function submit() {
  if (props.submitting) return;
  emit('confirm', checkinNumber.value);
}
</script>

<template>
  <ModalDialog v-if="appointment" size="sm" @close="emit('close')">
    <div class="flex items-center gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
        <ClipboardCheck class="h-5 w-5" />
      </div>
      <div>
        <DialogTitle>病患報到</DialogTitle>
        <DialogDescription class="mt-0.5 text-xs">{{ appointment.petName || appointment.ownerName }} 的候診序號</DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-1.5 p-6 pt-3 sm:p-7 sm:pt-3">
        <Label for="checkin-number" class="text-xs font-medium text-foreground">候診序號</Label>
        <Input id="checkin-number" v-model="checkinNumber" type="number" min="1" step="1" inputmode="numeric" autofocus placeholder="留白則自動給號" />
        <p class="text-xs text-muted-foreground">輸入數字可指定序號；留白時系統自動接續當日下一號。</p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="submitting" @click="emit('close')">取消</Button>
        <Button type="submit" :disabled="submitting">{{ submitting ? '報到中…' : '確認報到' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
