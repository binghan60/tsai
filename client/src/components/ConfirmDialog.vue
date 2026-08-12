<script setup>
import { computed } from 'vue';
import { AlertTriangle, CheckCircle2 } from '@lucide/vue';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  confirmLabel: { type: String, default: '確認' },
  cancelLabel: { type: String, default: '取消' },
  loading: { type: Boolean, default: false },
  destructive: { type: Boolean, default: true },
});

const emit = defineEmits(['update:open', 'confirm', 'cancel']);

const tone = computed(() =>
  props.destructive
    ? {
        icon: AlertTriangle,
        shell: 'border-red-300/70 bg-red-500/10 text-red-600 shadow-[0_4px_16px_rgba(239,68,68,0.15)] dark:border-red-800/80 dark:bg-red-950/40 dark:text-red-400',
        glow: 'bg-red-500/15',
      }
    : {
        icon: CheckCircle2,
        shell: 'border-brand-300/80 bg-brand-500/10 text-brand-700 shadow-[0_4px_16px_rgba(201,154,53,0.15)] dark:border-brand-500/40 dark:bg-brand-500/15 dark:text-brand-300',
        glow: 'bg-brand-500/15',
      }
);

function close() {
  if (props.loading) return;
  emit('cancel');
  emit('update:open', false);
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent :show-close-button="!loading" class="sm:max-w-md">
      <div class="relative p-6 sm:p-7 pb-5">
        <div class="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full blur-3xl" :class="tone.glow"></div>
        <div class="flex gap-4">
          <div class="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border" :class="tone.shell">
            <component :is="tone.icon" class="h-6 w-6" stroke-width="2" />
          </div>
          <div class="min-w-0 flex-1 space-y-1.5 pr-4">
            <DialogTitle class="text-base sm:text-lg font-semibold text-ink-900 dark:text-white">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="text-sm leading-relaxed text-ink-500 dark:text-zinc-400">{{ description }}</DialogDescription>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" class="min-h-11 px-5 border-cream-300 hover:bg-cream-200/70 dark:border-zinc-700 dark:hover:bg-zinc-800" :disabled="loading" @click="close">
          {{ cancelLabel }}
        </Button>
        <Button type="button" :variant="destructive ? 'destructive' : 'default'" class="min-h-11 px-5" :disabled="loading" @click="emit('confirm')">
          {{ loading ? '處理中…' : confirmLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
