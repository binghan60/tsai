<script setup>
import { computed, ref } from 'vue';
import ConfirmDialog from '../ConfirmDialog.vue';
import { useQuickPhrases } from '../../composables/useQuickPhrases';
import { useToast } from '../../composables/useToast';

// 常用語的刪除確認。每個文字欄位都有一組常用語，對話框卻只需要一個 ——
// 待刪的那一筆放在 composable 的模組層級狀態裡，這個元件在表單頁掛一次就好。
const { pendingDelete, cancelRemove, confirmRemove } = useQuickPhrases();
const toast = useToast();
const deleting = ref(false);

// DialogDescription 是一般文字節點，換行字元不會變成換行，寫成一段連貫的句子。
const description = computed(
  () => `「${pendingDelete.value?.text ?? ''}」會從這個欄位的常用語移除。已經填進報告裡的文字不受影響，之後也可以再存一次。`
);

async function confirm() {
  deleting.value = true;
  try {
    await confirmRemove();
    toast.success('已刪除');
  } catch (err) {
    toast.error('常用語刪除失敗，請稍後再試');
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <ConfirmDialog
    :open="Boolean(pendingDelete)"
    title="刪除這句常用語？"
    :description="description"
    confirm-label="刪除"
    cancel-label="取消"
    :loading="deleting"
    @update:open="(value) => !value && cancelRemove()"
    @confirm="confirm"
  />
</template>
