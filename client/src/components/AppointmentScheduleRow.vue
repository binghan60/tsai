<script setup>
import { PawPrint, Phone, Scissors, UserRound } from '@lucide/vue';
import { APPOINTMENT_STATUS_META } from '../lib/appointmentStatus';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

defineProps({
  appointment: { type: Object, required: true },
  actions: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['action']);
</script>

<template>
  <article class="group grid grid-cols-[5rem_minmax(0,1fr)] border-b border-border bg-card last:border-b-0 sm:grid-cols-[6.75rem_minmax(0,1fr)_auto]">
    <div class="flex flex-col items-center justify-center border-r border-border bg-muted/30 px-3 py-4 text-center tabular-nums">
      <time class="text-xl font-semibold tracking-tight text-foreground">{{ appointment.time || '待定' }}</time>
      <span v-if="appointment.checkinNumber" class="mt-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
        {{ appointment.checkinNumber }} 號
      </span>
      <span v-else class="mt-1 text-xs text-muted-foreground">尚未報到</span>
    </div>

    <div class="min-w-0 px-4 py-4">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <router-link
          v-if="appointment.petId"
          :to="`/pets/${appointment.petId}`"
          class="inline-flex min-w-0 items-center gap-2 text-base font-semibold text-foreground hover:text-primary"
        >
          <PawPrint class="h-4 w-4 shrink-0" stroke-width="1.75" />
          <span class="truncate">{{ appointment.petName || '未命名寵物' }}</span>
        </router-link>
        <span v-else class="inline-flex min-w-0 items-center gap-2 text-base font-semibold text-foreground">
          <UserRound class="h-4 w-4 shrink-0" stroke-width="1.75" />
          <span class="truncate">{{ appointment.petName || appointment.ownerName }}</span>
        </span>

        <Badge variant="status" :class="APPOINTMENT_STATUS_META[appointment.status]?.class">
          {{ APPOINTMENT_STATUS_META[appointment.status]?.label || appointment.status }}
        </Badge>
        <Badge v-if="!appointment.petId" variant="status" class="bg-muted text-muted-foreground">未建檔</Badge>
        <Badge v-if="appointment.isSurgery" variant="status" class="bg-belle-50 text-belle-700 dark:bg-brand-500/10 dark:text-brand-300">
          <Scissors class="mr-1 h-3 w-3" />手術
        </Badge>
      </div>

      <p class="mt-1.5 truncate text-sm text-muted-foreground">
        飼主 {{ appointment.ownerName }}<span v-if="appointment.reason"> · {{ appointment.reason }}</span>
      </p>
      <p v-if="appointment.ownerPhone" class="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Phone class="h-3 w-3" stroke-width="1.75" />{{ appointment.ownerPhone }}
      </p>
    </div>

    <div class="col-span-2 flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3 sm:col-span-1 sm:justify-end sm:border-t-0 sm:px-4 sm:pl-0">
      <Button
        v-for="action in actions"
        :key="action.key"
        type="button"
        :variant="action.variant"
        size="sm"
        :disabled="busy"
        @click="emit('action', action.key)"
      >{{ action.label }}</Button>
    </div>
  </article>
</template>
