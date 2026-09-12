<script setup>
import { ref } from 'vue';
import { HoverCardRoot, HoverCardTrigger, HoverCardPortal, HoverCardContent } from 'reka-ui';
import { Button } from './ui/button';

defineProps({ snapshot: { type: Object, required: true } });
const open = ref(false);
</script>

<template>
  <HoverCardRoot v-model:open="open" :open-delay="150" :close-delay="200">
    <HoverCardTrigger as-child>
      <Button type="button" variant="secondary" size="xs" class="mt-2" :aria-expanded="open" @click="open = !open">查看異動</Button>
    </HoverCardTrigger>
    <HoverCardPortal>
      <HoverCardContent
        side="left"
        align="end"
        :side-offset="8"
        :collision-padding="16"
        class="z-50 max-h-[min(60vh,var(--reka-hover-card-content-available-height))] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg"
      >
        <div class="space-y-4 text-sm">
          <p class="font-semibold">異動欄位：{{ snapshot.fieldLabel || '本次簡易紀錄' }}</p>
          <div><p class="font-semibold">修改前</p><p class="mt-1 whitespace-pre-wrap wrap-anywhere">{{ snapshot.before || '（空白）' }}</p></div>
          <div class="border-t border-border pt-3"><p class="font-semibold">修改後</p><p class="mt-1 whitespace-pre-wrap wrap-anywhere">{{ snapshot.after || '（空白）' }}</p></div>
        </div>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
</template>
