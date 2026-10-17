<script setup>
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

// title 有值時就渲染標準標題列，沒有就完全是舊行為（使用端自己塞內容）。
// 會加這組 props 是因為原本五個使用端各自手抄一段 `border-b border-border p-5 pr-16 sm:px-6`，
// 抄漏就出事——櫃台暫存區那份就少了說明文字、還留了一個空 div 在裡面。
// pr-16 是給 DialogContent 那顆 absolute 關閉鈕讓位，別拿掉。
defineProps({
  size: { type: String, default: 'md' },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  count: { type: Number, default: null },
});
const emit = defineEmits(['close', 'open-auto-focus']);
</script>

<template>
  <Dialog :open="true" @update:open="(value) => !value && emit('close')">
    <!-- 兩層是刻意的：外層 DialogContent 不捲動，關閉鈕與頂部漸層條這些
         absolute 裝飾才會固定在原位；捲動一律交給內層這個容器。 -->
    <DialogContent :size="size" class="max-h-[90vh] flex flex-col p-0" @open-auto-focus="emit('open-auto-focus', $event)">
      <div class="relative flex max-h-[90vh] flex-col overflow-y-auto">
        <div v-if="title" class="shrink-0 border-b border-border px-6 pr-16" :class="$slots['header-end'] ? 'flex items-center gap-4 pt-3.5 pb-3' : 'pt-5 pb-4'">
          <div class="min-w-0 flex-1">
            <DialogTitle class="flex items-center gap-2">
              <component :is="icon" v-if="icon" class="h-4.5 w-4.5 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
              {{ title }}
              <span v-if="count !== null" class="num inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sunken px-2 text-xs font-semibold text-muted-foreground">{{ count }}</span>
            </DialogTitle>
            <DialogDescription v-if="description" class="mt-1">{{ description }}</DialogDescription>
          </div>
          <!-- 標題列右側（關閉鈕左邊）放一個跟標題同層的小控制項，例如現場視窗的號碼牌。 -->
          <slot name="header-end" />
        </div>
        <slot />
      </div>
    </DialogContent>
  </Dialog>
</template>
