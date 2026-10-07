<script setup>
import { ref } from 'vue';
import { Banknote } from '@lucide/vue';
import { http } from '../api/http';
import { apiErrorMessage } from '../lib/apiError.js';
import ModalDialog from './ModalDialog.vue';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { DEPOSIT_EDITABLE_STATUSES, DEPOSIT_REASON_MAX_LENGTH, DEPOSIT_STATUS_LABELS, checkDepositEdit } from '../../../shared/deposit.js';

// 事後更正某筆掛號的保證金紀錄（貓咪詳情頁「出席紀錄」）：收錯、漏記、後來才退。
// item 是出席紀錄清單的一列（_id 是掛號的 id）。改完整份出席紀錄與貓咪的保證金狀態都要重讀，由呼叫端處理。
const props = defineProps({
  item: { type: Object, required: true },
});
const emit = defineEmits(['saved', 'close']);

// reka-ui 的 Select 不收空字串當值，「沒有紀錄」用 none 代表。
const NONE = 'none';
const OPTIONS = DEPOSIT_EDITABLE_STATUSES.map((status) => ({ value: status || NONE, label: DEPOSIT_STATUS_LABELS[status] }));
const status = ref(props.item.depositStatus || NONE);
const reason = ref(props.item.depositWaiveReason || '');
const saving = ref(false);
const error = ref('');

async function submit() {
  const edit = checkDepositEdit({ status: status.value === NONE ? '' : status.value, reason: reason.value });
  if (edit.error) {
    error.value = edit.error;
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await http.patch(`/appointments/${props.item._id}/deposit`, { status: edit.status, reason: edit.reason });
    emit('saved');
  } catch (err) {
    error.value = apiErrorMessage(err, '保證金紀錄儲存失敗，請稍後再試');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog size="sm" @close="emit('close')">
    <div class="flex items-start gap-3.5 p-6 pb-2 sm:p-7 sm:pb-2">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-warning-surface text-warning">
        <Banknote class="h-5 w-5" stroke-width="1.75" />
      </div>
      <div class="min-w-0">
        <DialogTitle>修改保證金紀錄</DialogTitle>
        <DialogDescription class="mt-1 text-sm leading-relaxed"><span class="num">{{ String(item.date ?? '').replaceAll('-', '/') }} {{ item.time }}</span> 的掛號。改成已收會從現在起把遲到與未到的次數歸零。</DialogDescription>
      </div>
    </div>

    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-4 p-6 pt-3 sm:p-7 sm:pt-3">
        <div class="space-y-1.5">
          <Label for="deposit-edit-status" class="text-xs font-medium text-foreground">保證金</Label>
          <Select v-model="status">
            <SelectTrigger id="deposit-edit-status" class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div v-if="status === 'waived'" class="space-y-1.5">
          <Label for="deposit-edit-reason" class="text-xs font-medium text-foreground">不收的原因<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Input id="deposit-edit-reason" v-model="reason" :maxlength="DEPOSIT_REASON_MAX_LENGTH" placeholder="例：醫師同意、路上車禍" />
        </div>
        <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" class="px-5" :disabled="saving" @click="emit('close')">取消</Button>
        <Button type="submit" class="px-5" :disabled="saving">{{ saving ? '儲存中…' : '儲存' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
