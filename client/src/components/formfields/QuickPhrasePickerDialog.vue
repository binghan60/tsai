<script setup>
import { computed } from 'vue';
import { Trash2 } from '@lucide/vue';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { useQuickPhrases } from '../../composables/useQuickPhrases';

// 「全部」視窗。欄位底下只排得下前幾句，其餘的靠這裡點選 ——
// 也是刪除常用語的唯一入口，表單上不再散落一堆 ✕ 按鈕。
// 跟刪除確認一樣，狀態放在 composable 的模組層級，這個元件在表單頁掛一次就好。
const { picker, closePicker, phrasesFor, requestRemove, markUsed } = useQuickPhrases();

const list = computed(() => (picker.value ? phrasesFor(picker.value.itemKey) : []));
const title = computed(() => (picker.value?.label ? `${picker.value.label}的常用語` : '常用語'));

function pick(phrase) {
  picker.value?.onPick?.(phrase);
  closePicker();
}

// 確認框跟這個視窗都是 Dialog，疊在一起焦點會打架，先把這層關掉再問。
function remove(phrase) {
  closePicker();
  requestRemove(phrase);
}
</script>

<template>
  <Dialog :open="Boolean(picker)" @update:open="(value) => !value && closePicker()">
    <DialogContent class="sm:max-w-lg">
      <div class="space-y-1.5 p-6 pb-4">
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription class="text-sm text-muted-foreground">
          點一句就接到欄位現有內容的後面。用得多的排在前面。
        </DialogDescription>
      </div>

      <div class="max-h-96 space-y-1.5 overflow-y-auto px-6 pb-2">
        <p v-if="!list.length" class="py-6 text-center text-sm text-muted-foreground">
          這個欄位還沒有常用語。
        </p>
        <div
          v-for="phrase in list"
          :key="phrase._id"
          class="flex items-start gap-2 rounded-xl border border-border bg-white transition-colors hover:border-belle-400 dark:hover:border-brand-500"
        >
          <button
            type="button"
            class="min-w-0 flex-1 whitespace-pre-wrap px-3 py-2.5 text-left text-sm text-foreground"
            @click="pick(phrase)"
          >{{ phrase.text }}</button>
          <button
            type="button"
            class="mr-1 mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400"
            :aria-label="`刪除常用語：${phrase.text}`"
            @click="remove(phrase)"
          >
            <Trash2 class="h-4 w-4" stroke-width="1.75" />
          </button>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" class="px-5" @click="closePicker">關閉</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
