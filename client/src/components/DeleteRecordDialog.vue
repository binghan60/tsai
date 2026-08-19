<script setup>
import { computed, ref, watch } from 'vue';
import { AlertTriangle } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';

// 刪除報告要求輸入完整報告編號才能按下確認，仿 GitHub 刪除 repository 的做法——
// 這是唯一可以刪掉已結案報告的入口，防止手滑連續點掉一份已經花時間填完的紀錄。
const props = defineProps({
  record: { type: Object, required: true },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const input = ref('');
watch(() => props.record, () => { input.value = ''; });

const canSubmit = computed(() => Boolean(props.record?.reportNumber) && input.value.trim() === props.record.reportNumber);

function submit() {
  if (!canSubmit.value || props.submitting) return;
  emit('submit', input.value.trim());
}
</script>

<template>
  <ModalDialog @close="emit('close')">
    <div class="flex items-center gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive">
        <AlertTriangle class="h-5 w-5" />
      </div>
      <div>
        <DialogTitle>刪除健檢報告</DialogTitle>
        <DialogDescription class="mt-0.5 text-xs">此操作無法復原，請謹慎確認。</DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-4 p-6 pt-3 sm:p-7 sm:pt-3">
        <p class="text-sm leading-relaxed text-ink-600 dark:text-zinc-300">
          即將刪除報告 <strong class="font-mono text-ink-900 dark:text-white">{{ record?.reportNumber }}</strong>。
          請在下方輸入完整報告編號以確認刪除。
        </p>
        <div class="space-y-1.5">
          <Label for="delete-record-confirm" class="text-xs font-medium text-ink-700 dark:text-zinc-300">輸入報告編號「{{ record?.reportNumber }}」</Label>
          <Input id="delete-record-confirm" v-model="input" autofocus autocomplete="off" :placeholder="record?.reportNumber" />
        </div>
        <Alert v-if="errorMessage" variant="destructive">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" class="min-h-11" :disabled="submitting" @click="emit('close')">取消</Button>
        <Button type="submit" variant="destructive-solid" class="min-h-11" :disabled="!canSubmit || submitting">{{ submitting ? '刪除中…' : '刪除報告' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
