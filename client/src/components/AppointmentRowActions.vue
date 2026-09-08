<script setup>
import { computed } from 'vue';
import { ArrowUpRight, CalendarPlus, UserCheck, Wallet } from '@lucide/vue';
import { workflowState, workflowFilter } from '../../../shared/appointmentWorkflow.js';
import { Button } from './ui/button';
import RowActions from './RowActions.vue';

const props = defineProps({
  appointment: { type: Object, required: true },
  desk: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  dense: { type: Boolean, default: false },
});
const emit = defineEmits(['open', 'admin']);
const state = computed(() => workflowState(props.appointment));
const additional = computed(() => {
  if (!props.desk || props.busy) return [];
  if (props.appointment.status === 'scheduled') return [
    { key: 'check-in-late', label: '遲到報到' },
    { key: 'no-show', label: '標記未到' },
    { key: 'edit', label: '修改預約' },
    { key: 'cancel', label: '取消掛號', danger: true },
  ];
  if (props.appointment.status === 'arrived' && !state.value.started && !state.value.visited && !state.value.billed) return [
    { key: 'edit', label: '修改掛號' },
    { key: 'restore', label: '取消報到', danger: true },
  ];
  return [];
});
</script>

<template>
  <div class="relative z-10 flex flex-wrap items-center justify-end gap-2" :class="{ 'dense-actions': dense }" data-row-actions @click.stop @keydown.stop>
    <template v-if="desk">
      <template v-if="appointment.status === 'scheduled'">
        <Button size="sm" variant="secondary" :disabled="busy" @click="emit('admin', 'check-in')"><UserCheck class="h-4 w-4" />報到</Button>
      </template>
      <template v-else-if="['cancelled', 'no_show'].includes(appointment.status)">
        <Button size="sm" variant="secondary" :disabled="busy" @click="emit('admin', 'restore')">恢復預約</Button>
      </template>
      <template v-else>
        <Button v-if="state.billed && !state.paid" size="sm" :disabled="busy" @click="emit('open', 'payment')"><Wallet class="h-4 w-4" />收款</Button>
        <Button v-if="workflowFilter(appointment, 'followup')" size="sm" variant="secondary" :disabled="busy" @click="emit('open', 'followup')"><CalendarPlus class="h-4 w-4" />約回診</Button>
      </template>
      <RowActions v-if="additional.length" :actions="additional" :label="`${appointment.petName}的更多操作`" @select="key => emit('admin', key)" />
    </template>
    <Button v-else-if="!['scheduled', 'cancelled', 'no_show'].includes(appointment.status)" size="sm" variant="secondary" @click="emit('open')">{{ state.visited ? '查看看診' : '進入看診' }}<ArrowUpRight class="h-3.5 w-3.5" /></Button>
  </div>
</template>

<style scoped>
.dense-actions { flex-wrap: nowrap; gap: .375rem; }
.dense-actions :deep([data-slot="button"]) { box-shadow: none; padding-inline: .625rem; }
.dense-actions :deep([data-slot="button"] > svg) { display: none; }
.dense-actions :deep([data-slot="button"][aria-haspopup] > svg) { display: block; }
</style>
