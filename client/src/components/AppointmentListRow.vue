<script setup>
import { computed } from 'vue';
import { ChevronRight, PawPrint } from '@lucide/vue';
import { workflowFilter, workflowState } from '../../../shared/appointmentWorkflow.js';
import AppointmentMilestones from './AppointmentMilestones.vue';
import AppointmentRowActions from './AppointmentRowActions.vue';

const props = defineProps({
  appointment: { type: Object, required: true },
  desk: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  waitingLabel: { type: String, default: '' },
  showTime: { type: Boolean, default: false },
});
const emit = defineEmits(['open', 'admin']);
const state = computed(() => workflowState(props.appointment));
</script>

<template>
  <article class="appointment-list-row group" :class="{ 'is-selected': selected }" :data-appointment-id="appointment._id">
    <button type="button" class="row-hit-area" :aria-label="`${desk ? '查看就診詳情' : '進入看診'}：${appointment.petName}`" :aria-expanded="desk ? selected : undefined" @click="emit('open')"></button>
    <div class="row-information pointer-events-none">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <span v-if="appointment.checkinNumber" class="text-sm font-semibold tabular-nums">{{ appointment.checkinNumber }}</span>
        <PawPrint v-else class="h-4 w-4" stroke-width="1.6" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 class="font-semibold text-foreground">{{ appointment.petName }}</h3>
          <span class="text-xs text-muted-foreground">{{ appointment.species }}<template v-if="appointment.visitType"> · {{ appointment.visitType === 'new' ? '初診' : '回診' }}</template></span>
          <span v-if="showTime" class="ml-auto text-xs tabular-nums text-muted-foreground">{{ appointment.time || '未定時段' }}</span>
        </div>
        <p class="mt-1 truncate text-xs text-muted-foreground">{{ appointment.ownerName || '飼主待確認' }}<template v-if="desk && appointment.ownerPhone"> · {{ appointment.ownerPhone }}</template><template v-if="appointment.reason"> · {{ appointment.reason }}</template></p>
      </div>
    </div>
    <div class="row-progress pointer-events-none">
      <AppointmentMilestones :appointment="appointment" compact />
      <p v-if="waitingLabel" class="mt-1 text-xs text-muted-foreground">{{ waitingLabel }}</p>
      <p v-else-if="desk && state.billed" class="mt-1 text-xs tabular-nums text-muted-foreground">{{ state.paid ? '實收' : '應收' }} <span class="font-medium text-foreground">NT$ {{ Number(state.paid ? appointment.checkoutTotal : appointment.billingSubtotal).toLocaleString() }}</span></p>
      <p v-else-if="desk && workflowFilter(appointment, 'followup')" class="mt-1 text-xs text-muted-foreground">{{ appointment.followUpRecommendation || appointment.followUpReason }}</p>
    </div>
    <div class="row-actions">
      <AppointmentRowActions :appointment="appointment" :desk="desk" :busy="busy" @open="section => emit('open', section)" @admin="action => emit('admin', action)" />
      <ChevronRight class="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </div>
  </article>
</template>

<style scoped>
.appointment-list-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 10rem 16rem; align-items: center; gap: 1.25rem; padding: 1rem; border-radius: .75rem; transition: background-color .15s; }
.appointment-list-row:hover { background: var(--field); }
.appointment-list-row.is-selected { background: var(--accent); box-shadow: inset 3px 0 0 var(--primary); }
.row-hit-area { position: absolute; inset: 0; width: 100%; border-radius: inherit; cursor: pointer; background: transparent; }
.row-hit-area:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
.row-information { display: flex; align-items: center; gap: .75rem; min-width: 0; }
.row-actions { display: flex; align-items: center; justify-content: flex-end; gap: .75rem; }
@media(max-width: 900px) {
  .appointment-list-row { grid-template-columns: minmax(0, 1fr) auto; gap: .75rem; }
  .row-information { grid-column: 1 / -1; }
  .row-progress { padding-left: 3.25rem; }
}
@media(max-width: 540px) {
  .appointment-list-row { padding: .875rem .5rem; column-gap: .5rem; }
  .row-progress { grid-column: 1 / -1; padding-left: 0; }
  .row-actions { grid-column: 1 / -1; gap: .25rem; }
}
</style>
