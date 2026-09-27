<script setup>
import { computed } from 'vue';
import { AlertTriangle, CheckCircle2 } from '@lucide/vue';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  confirmLabel: { type: String, default: '確認' },
  cancelLabel: { type: String, default: '取消' },
  loading: { type: Boolean, default: false },
  // 一般確認預設使用主色；刪除、捨棄、撤銷等不可逆操作必須由呼叫端明確標記。
  destructive: { type: Boolean, default: false },
});

const emit = defineEmits(['update:open', 'confirm', 'cancel']);

const tone = computed(() =>
  props.destructive
    ? {
        icon: AlertTriangle,
        shell: 'bg-destructive-surface text-destructive',
      }
    : {
        icon: CheckCircle2,
        shell: 'bg-accent text-accent-foreground',
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
    <DialogContent :show-close-button="!loading" size="sm">
      <div class="relative px-6 pt-6 pb-5">
        <div class="flex gap-4">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg" :class="tone.shell">
            <component :is="tone.icon" class="h-5 w-5" stroke-width="1.75" />
          </div>
          <div class="min-w-0 flex-1 space-y-1.5 pr-4">
            <DialogTitle>{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="text-sm leading-relaxed text-muted-foreground">{{ description }}</DialogDescription>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" class="px-5" :disabled="loading" @click="close">
          {{ cancelLabel }}
        </Button>
        <Button type="button" :variant="destructive ? 'destructive-solid' : 'default'" class="px-5" :disabled="loading" @click="emit('confirm')">
          {{ loading ? '處理中…' : confirmLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
