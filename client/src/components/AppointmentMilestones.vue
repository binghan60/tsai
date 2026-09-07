<script setup>
import { computed } from 'vue';
import { workflowState, visitLabel } from '../../../shared/appointmentWorkflow.js';
const props = defineProps({ appointment: { type: Object, required: true }, compact: { type: Boolean, default: false } });
const state = computed(() => workflowState(props.appointment));
const tone = computed(() => ['cancelled', 'no_show'].includes(props.appointment.status) ? 'bg-muted text-muted-foreground' : state.value.visited ? 'bg-success-surface text-success' : props.appointment.status === 'scheduled' ? 'bg-muted text-muted-foreground' : 'bg-info-surface text-info');
const compactLabel = computed(() => state.value.billed && !state.value.paid ? '待收款' : visitLabel(props.appointment));
</script>
<template>
  <div v-if="compact" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <span class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium" :class="state.billed && !state.paid ? 'bg-warning-surface text-warning' : tone"><span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{{ compactLabel }}</span>
    <span v-if="state.paid" class="text-muted-foreground">已收款</span>
    <span v-else-if="state.visited && !state.billed" class="text-muted-foreground">待批價</span>
    <span v-else-if="state.billed && !state.visited" class="text-muted-foreground">{{ state.started ? '看診中' : '候診中' }}</span>
  </div>
  <div v-else class="flex flex-wrap gap-1.5 text-xs font-medium">
    <span class="rounded-md px-2 py-1" :class="tone">{{ visitLabel(appointment) }}</span>
    <template v-if="!['scheduled', 'cancelled', 'no_show'].includes(appointment.status)">
      <span class="rounded-md px-2 py-1" :class="state.billed ? 'bg-success-surface text-success' : 'bg-muted text-muted-foreground'">{{ state.billed ? '批價完成' : '待批價' }}</span>
      <span class="rounded-md px-2 py-1" :class="state.paid ? 'bg-success-surface text-success' : state.billed ? 'bg-warning-surface text-warning' : 'bg-muted text-muted-foreground'">{{ state.paid ? '收款完成' : '尚未收款' }}</span>
    </template>
  </div>
</template>
