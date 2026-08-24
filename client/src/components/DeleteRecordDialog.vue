<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { AlertTriangle, CornerDownLeft } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { formatDate } from '../lib/datetime';

// 刪除報告要求先打字才能按下確認，仿 GitHub 刪除 repository 的做法——
// 這是唯一可以刪掉已結案報告的入口，防的是「手滑點到刪除、又手滑點到確認」。
//
// 要打的字是寵物名而不是報告編號：編號是一串記不住的亂碼，只能照抄，
// 抄的過程並不會讓人意識到自己在刪什麼；打出寵物名則會。
const props = defineProps({
  record: { type: Object, required: true },
  // 要輸入的確認文字，由呼叫端提供（目前是寵物名）。
  confirmWord: { type: String, required: true },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const input = ref('');
const inputEl = ref(null);
watch(() => props.record, () => { input.value = ''; });

const expected = computed(() => String(props.confirmWord ?? '').trim());
const canSubmit = computed(() => Boolean(expected.value) && input.value.trim() === expected.value);

// 這份報告是哪一份，用看得懂的方式描述——日期與健檢類型比編號好認。
const recordLabel = computed(() => {
  const parts = [formatDate(props.record?.visitDate, '日期未填'), props.record?.examType].filter(Boolean);
  if ((props.record?.reportVersion ?? 1) > 1) parts.push(`第 ${props.record.reportVersion} 版`);
  return parts.join(' · ');
});

// 點一下就把確認文字填進輸入框。少一道抄字的功夫，但仍然要刻意點兩個不同的位置，
// 擋得住連續誤觸。
async function fillConfirmWord() {
  input.value = expected.value;
  await nextTick();
  inputEl.value?.$el?.focus?.() ?? inputEl.value?.focus?.();
}

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
        <p class="text-sm leading-relaxed text-foreground">
          即將刪除 <strong class="text-foreground">{{ expected }}</strong> 的健檢報告<template v-if="recordLabel">（{{ recordLabel }}）</template>。
        </p>
        <div class="space-y-1.5">
          <Label for="delete-record-confirm" class="text-xs font-medium text-foreground">請輸入寵物名稱以確認刪除</Label>
          <Input id="delete-record-confirm" ref="inputEl" v-model="input" autofocus autocomplete="off" placeholder="在此輸入寵物名稱" />
          <button
            type="button"
            class="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary"
            @click="fillConfirmWord"
          >
            <CornerDownLeft class="h-3.5 w-3.5 shrink-0 -scale-x-100" stroke-width="1.75" />
            點一下填入「<span class="font-semibold">{{ expected }}</span>」
          </button>
        </div>
        <Alert v-if="errorMessage" variant="destructive">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="submitting" @click="emit('close')">取消</Button>
        <Button type="submit" variant="destructive-solid" :disabled="!canSubmit || submitting">{{ submitting ? '刪除中…' : '刪除報告' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
