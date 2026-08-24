<script setup>
import { Stethoscope } from '@lucide/vue';
import { Button } from './ui/button';

defineProps({
  queue: { type: Array, default: () => [] },
  counts: { type: Object, default: () => ({}) },
  total: { type: Number, default: 0 },
});

const emit = defineEmits(['start-report']);
</script>

<template>
  <aside class="space-y-4 xl:sticky xl:top-5">
    <section class="rounded-2xl border border-border bg-card p-5 shadow-sm dark:shadow-none">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-foreground">候診名單</h2>
          <p class="mt-0.5 text-xs text-muted-foreground">已報到，依號碼等候看診</p>
        </div>
        <span class="flex h-8 min-w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{{ queue.length }}</span>
      </div>

      <div v-if="queue.length" class="mt-4 divide-y divide-border">
        <div v-for="appointment in queue" :key="appointment._id" class="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold tabular-nums text-primary">
            {{ appointment.checkinNumber || '—' }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-foreground">{{ appointment.petName || appointment.ownerName }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ appointment.ownerName }} · {{ appointment.time || '未定時段' }}</p>
          </div>
          <Button type="button" size="sm" @click="emit('start-report', appointment)">
            <Stethoscope class="h-3.5 w-3.5" />看診
          </Button>
        </div>
      </div>
      <div v-else class="mt-4 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-5 text-center">
        <Stethoscope class="mx-auto h-5 w-5 text-muted-foreground" stroke-width="1.5" />
        <p class="mt-2 text-sm text-muted-foreground">目前沒有候診病患</p>
      </div>
    </section>

    <section class="rounded-2xl border border-border bg-card p-5 shadow-sm dark:shadow-none">
      <h2 class="text-base font-semibold text-foreground">門診摘要</h2>
      <dl class="mt-4 grid grid-cols-2 gap-3">
        <div class="rounded-xl bg-muted/45 p-3">
          <dt class="text-xs text-muted-foreground">總預約</dt>
          <dd class="mt-1 text-2xl font-semibold tabular-nums text-foreground">{{ total }}</dd>
        </div>
        <div class="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
          <dt class="text-xs text-emerald-700 dark:text-emerald-300">已完成</dt>
          <dd class="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{{ counts.completed || 0 }}</dd>
        </div>
        <div class="rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
          <dt class="text-xs text-amber-800 dark:text-amber-300">未到</dt>
          <dd class="mt-1 text-2xl font-semibold tabular-nums text-amber-800 dark:text-amber-300">{{ counts.no_show || 0 }}</dd>
        </div>
        <div class="rounded-xl bg-muted/45 p-3">
          <dt class="text-xs text-muted-foreground">已取消</dt>
          <dd class="mt-1 text-2xl font-semibold tabular-nums text-foreground">{{ counts.cancelled || 0 }}</dd>
        </div>
      </dl>
    </section>
  </aside>
</template>
