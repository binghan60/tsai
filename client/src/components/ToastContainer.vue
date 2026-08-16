<script setup>
import { CheckCircle2, XCircle, Info, X } from '@lucide/vue';
import { useToast } from '../composables/useToast';

const { toasts, removeToast } = useToast();

const typeConfig = {
  success: {
    icon: CheckCircle2,
    badge: 'bg-emerald-500/10 text-emerald-600 border-emerald-200/80 dark:bg-brand-500/15 dark:text-brand-300 dark:border-brand-500/40',
    topBar: 'bg-gradient-to-r from-emerald-500 via-brand-400 to-emerald-600 dark:from-brand-500 dark:via-belle-400 dark:to-amber-300',
    glow: '[--glow-color:color-mix(in_oklab,var(--color-emerald-500)_16%,transparent)] dark:[--glow-color:color-mix(in_oklab,var(--color-brand-500)_16%,transparent)]',
  },
  error: {
    icon: XCircle,
    badge: 'bg-red-500/10 text-red-600 border-red-200/80 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/60',
    topBar: 'bg-gradient-to-r from-red-500 via-belle-500 to-red-600 dark:from-red-600 dark:via-red-400 dark:to-amber-500',
    glow: '[--glow-color:color-mix(in_oklab,var(--color-red-500)_16%,transparent)]',
  },
  info: {
    icon: Info,
    badge: 'bg-sky-500/10 text-sky-600 border-sky-200/80 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-900/60',
    topBar: 'bg-gradient-to-r from-sky-500 via-ink-500 to-sky-600 dark:from-sky-600 dark:via-sky-400 dark:to-brand-400',
    glow: '[--glow-color:color-mix(in_oklab,var(--color-sky-500)_16%,transparent)]',
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
        class="pointer-events-auto relative flex items-start gap-3.5 overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 p-4 shadow-lg shadow-ink-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/60"
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
          <p class="text-sm font-semibold text-ink-900 dark:text-white">{{ toast.title }}</p>
          <p v-if="toast.message" class="text-xs leading-relaxed text-ink-500 dark:text-zinc-400">{{ toast.message }}</p>
        </div>

        <!-- Close button -->
        <button
          type="button"
          class="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-cream-300 bg-cream-100 text-ink-600 shadow-sm transition-colors hover:bg-cream-200 hover:text-ink-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-white"
          aria-label="關閉通知"
          @click="removeToast(toast.id)"
        >
          <X class="h-3.5 w-3.5" stroke-width="2" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
