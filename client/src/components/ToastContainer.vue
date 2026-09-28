<script setup>
import { CheckCircle2, XCircle, Info, X } from '@lucide/vue';
import { useToast } from '../composables/useToast';
import { Button } from './ui/button';

const { toasts, removeToast } = useToast();

// 每種提示只用一個語意色，畫在左邊的圖示方塊上；讀者要辨認的只有「成功還是失敗」。
const typeConfig = {
  success: { icon: CheckCircle2, badge: 'bg-success-surface text-success' },
  error: { icon: XCircle, badge: 'bg-danger-surface text-danger' },
  info: { icon: Info, badge: 'bg-info-surface text-info' },
};
</script>

<template>
  <!-- 置中貼底：左右兩條欄寬度相近，以視窗置中就等於以工作區置中。 -->
  <div class="pointer-events-none fixed inset-x-4 bottom-5 z-60 mx-auto flex max-w-sm flex-col gap-3" aria-live="polite">
    <TransitionGroup
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="translate-y-4 opacity-0 scale-95"
      enter-to-class="translate-y-0 opacity-100 scale-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="translate-y-0 opacity-100 scale-100"
      leave-to-class="translate-y-2 opacity-0 scale-95"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border border-border bg-popover p-3.5 pr-12 shadow-menu"
      >
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg" :class="typeConfig[toast.type]?.badge || typeConfig.success.badge">
          <component :is="typeConfig[toast.type]?.icon || CheckCircle2" class="h-5 w-5" stroke-width="2" />
        </div>

        <div class="min-w-0 flex-1 space-y-0.5 pt-1">
          <p class="text-base leading-snug font-semibold text-foreground">{{ toast.title }}</p>
          <p v-if="toast.message" class="text-sm leading-relaxed text-muted-foreground">{{ toast.message }}</p>
          <Button
            v-if="toast.action"
            type="button"
            variant="secondary"
            size="xs"
            class="mt-2"
            @click="removeToast(toast.id); toast.action.handler()"
          >{{ toast.action.label }}</Button>
        </div>

        <button
          type="button"
          class="absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-md bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-secondary-hover hover:text-foreground"
          aria-label="關閉通知"
          @click="removeToast(toast.id)"
        >
          <X class="size-4" stroke-width="2" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
