<script setup>
import { computed } from 'vue';
import { Check } from '@lucide/vue';
import { workflowState, visitLabel } from '../../../shared/appointmentWorkflow.js';
import { clinicTimeInput } from '../lib/datetime';
import { Badge } from './ui/badge';

// 流水線的四步進度：預約 → 報到 → 看診 → 櫃台完成。醫師端與櫃台端共用同一條，
// 兩邊講的是同一件事，狀態詞才不會又分裂成兩套（見 shared/appointmentWorkflow.js）。
const props = defineProps({
  appointment: { type: Object, required: true },
  // 清單列裡只放得下一顆徽章，這時只呈現目前所在的那一段。
  compact: { type: Boolean, default: false },
});

const TONE = {
  done: 'bg-success-surface text-success',
  current: 'bg-info-surface text-info',
  waiting: 'bg-warning-surface text-warning',
  todo: 'bg-muted text-muted-foreground',
  closed: 'bg-muted text-muted-foreground',
};

const state = computed(() => workflowState(props.appointment));
const closed = computed(() => ['cancelled', 'no_show'].includes(props.appointment.status));
const arrived = computed(() => Boolean(props.appointment.checkedInAt));

function at(value) {
  return value ? clinicTimeInput(new Date(value)) : '';
}

const steps = computed(() => {
  const { started, handedOff, completed } = state.value;
  const appointment = props.appointment;
  return [
    { key: 'booked', label: '預約', detail: appointment.time || '未指定', tone: 'done' },
    {
      key: 'arrived',
      label: arrived.value ? '報到' : '待報到',
      detail: at(appointment.checkedInAt),
      tone: arrived.value ? 'done' : 'todo',
    },
    {
      key: 'visit',
      label: handedOff ? '看診完成' : started ? '看診中' : '看診',
      detail: at(handedOff ? appointment.handoffAt : appointment.visitStartedAt),
      tone: handedOff ? 'done' : started ? 'current' : 'todo',
    },
    {
      key: 'desk',
      label: completed ? '櫃台完成' : handedOff ? '待櫃台處理' : '櫃台完成',
      detail: at(appointment.deskCompletedAt),
      tone: completed ? 'done' : handedOff ? 'waiting' : 'todo',
    },
  ];
});

const compactTone = computed(() => {
  if (closed.value) return TONE.closed;
  if (props.appointment.status === 'scheduled') return TONE.todo;
  if (state.value.completed) return TONE.done;
  if (state.value.handedOff) return TONE.waiting;
  return state.value.started ? TONE.current : 'bg-accent text-accent-foreground';
});
</script>

<template>
  <Badge v-if="compact" variant="status" :class="compactTone">{{ visitLabel(appointment) }}</Badge>
  <Badge v-else-if="closed" variant="status" :class="TONE.closed">{{ visitLabel(appointment) }}</Badge>
  <ol v-else class="flex flex-wrap items-center gap-x-2 gap-y-1.5" aria-label="看診進度">
    <li v-for="(step, index) in steps" :key="step.key" class="flex items-center gap-2">
      <span
        class="inline-flex h-6 items-center gap-1.5 rounded-full px-3 text-xs leading-none font-medium"
        :class="TONE[step.tone]"
        :aria-current="step.tone === 'current' || step.tone === 'waiting' ? 'step' : undefined"
      >
        <Check v-if="step.tone === 'done'" class="h-3.5 w-3.5" stroke-width="1.75" />
        <span v-else-if="step.tone === 'current' || step.tone === 'waiting'" class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>
        {{ step.label }}
        <span v-if="step.detail" class="tabular-nums opacity-80">{{ step.detail }}</span>
      </span>
      <span v-if="index < steps.length - 1" class="h-px w-4 bg-border" aria-hidden="true"></span>
    </li>
  </ol>
</template>
