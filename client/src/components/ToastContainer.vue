<script setup>
import { CheckCircle2, XCircle, Info, X } from '@lucide/vue';
import { useToast } from '../composables/useToast';

const { toasts, removeToast } = useToast();

// 每種提示只用一個語意色。之前 topBar 是三色漸層（success 是 emerald→brand→emerald，
// 深色再換成 brand→belle→amber），一個 4px 高的裝飾條上放了三個色站、明暗兩態各一組，
// 六個色值只為了畫一條線——而讀者真正要辨認的只有「成功還是失敗」這一件事。
const typeConfig = {
  success: {
    icon: CheckCircle2,
    badge: 'bg-success-surface text-success border-success/30',
    topBar: 'bg-success',
    glow: '[--glow-color:color-mix(in_oklab,var(--success)_14%,transparent)]',
  },
  error: {
    icon: XCircle,
    badge: 'bg-danger-surface text-danger border-danger/30',
    topBar: 'bg-danger',
    glow: '[--glow-color:color-mix(in_oklab,var(--danger)_14%,transparent)]',
  },
  info: {
    icon: Info,
    badge: 'bg-info-surface text-info border-info/30',
    topBar: 'bg-info',
    glow: '[--glow-color:color-mix(in_oklab,var(--info)_14%,transparent)]',
  },
};
</script>

<template>
  <div class="pointer-events-none fixed bottom-5 right-5 z-60 flex w-full max-w-sm flex-col gap-3 px-4 sm:px-0" aria-live="polite">
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
        class="pointer-events-auto relative flex items-start gap-3.5 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-lg shadow-black/10 dark:shadow-black/60"
      >
        <!-- Top accent line -->
        <div class="absolute inset-x-0 top-0 h-1" :class="typeConfig[toast.type]?.topBar || typeConfig.success.topBar"></div>
        <!-- Ambient corner glow -->
        <div class="ambient-glow pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full" :class="typeConfig[toast.type]?.glow || typeConfig.success.glow"></div>

        <!-- Icon Badge -->
        <div class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-xs" :class="typeConfig[toast.type]?.badge || typeConfig.success.badge">
          <component :is="typeConfig[toast.type]?.icon || CheckCircle2" class="h-5 w-5" stroke-width="2" />
        </div>

        <!-- Text Content -->
        <div class="min-w-0 flex-1 space-y-0.5 pr-2">
          <p class="text-sm font-semibold text-foreground">{{ toast.title }}</p>
          <p v-if="toast.message" class="text-xs leading-relaxed text-muted-foreground">{{ toast.message }}</p>
        </div>

        <!-- Close button -->
        <button
          type="button"
          class="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted/40 text-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          aria-label="關閉通知"
          @click="removeToast(toast.id)"
        >
          <X class="h-3.5 w-3.5" stroke-width="2" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
