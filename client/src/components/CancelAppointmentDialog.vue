<script setup>
import { ref, watch } from 'vue';
import { CalendarX } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';

const props = defineProps({
  appointment: { type: Object, default: null },
  submitting: { type: Boolean, default: false },
});
const emit = defineEmits(['confirm', 'close']);

const reason = ref('');
watch(() => props.appointment, () => { reason.value = ''; });

function submit() {
  if (props.submitting) return;
  emit('confirm', reason.value.trim());
}
</script>

<template>
  <ModalDialog v-if="appointment" size="sm" @close="emit('close')">
    <div class="flex items-center gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive">
        <CalendarX class="h-5 w-5" />
      </div>
      <div>
        <DialogTitle>取消預約</DialogTitle>
        <DialogDescription class="mt-0.5 text-xs">
          確定要取消 {{ appointment?.petName || appointment?.ownerName || '' }} 的預約嗎？
        </DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-1.5 p-6 pt-3 sm:p-7 sm:pt-3">
        <Label for="cancel-appointment-reason" class="text-xs font-medium text-foreground">取消原因（選填）</Label>
        <Textarea id="cancel-appointment-reason" v-model="reason" rows="3" placeholder="例：飼主改期、聯絡不上…" />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="submitting" @click="emit('close')">返回</Button>
        <Button type="submit" variant="destructive-solid" :disabled="submitting">{{ submitting ? '取消中…' : '取消預約' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
