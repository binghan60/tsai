<script setup>
import { ref } from 'vue';
import { ChevronDown, PawPrint, Phone, Scissors, UserRound } from '@lucide/vue';
import { APPOINTMENT_STATUS_META } from '../lib/appointmentStatus';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

const props = defineProps({
  appointment: { type: Object, required: true },
  actions: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  vitalsSaving: { type: Boolean, default: false },
});

const emit = defineEmits(['action', 'save-vitals']);

const expanded = ref(false);
const vitalsDraft = ref({ weightKg: '', temperatureC: '', notes: '' });

function toggleExpanded() {
  if (!expanded.value) {
    vitalsDraft.value = {
      weightKg: props.appointment.weightKg ?? '',
      temperatureC: props.appointment.temperatureC ?? '',
      notes: props.appointment.notes ?? '',
    };
  }
  expanded.value = !expanded.value;
}

function toOptionalNumber(value) {
  return value === '' || value == null ? null : Number(value);
}

function saveVitals() {
  emit('save-vitals', {
    weightKg: toOptionalNumber(vitalsDraft.value.weightKg),
    temperatureC: toOptionalNumber(vitalsDraft.value.temperatureC),
    notes: vitalsDraft.value.notes,
  });
}
</script>

<template>
  <article class="group border-b border-border bg-card last:border-b-0">
    <div class="flex flex-wrap items-stretch">
      <div class="flex w-18 shrink-0 flex-col items-center justify-center border-r border-border bg-muted/30 px-2 py-2 text-center tabular-nums sm:w-23">
        <time class="text-lg font-semibold tracking-tight text-foreground">{{ appointment.time || '待定' }}</time>
        <span v-if="appointment.checkinNumber" class="mt-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
          {{ appointment.checkinNumber }} 號
        </span>
        <span v-else class="mt-0.5 text-xs text-muted-foreground">尚未報到</span>
      </div>

      <div class="min-w-0 flex-1 px-3 py-2">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <router-link
            v-if="appointment.petId"
            :to="`/pets/${appointment.petId}`"
            class="inline-flex min-w-0 max-w-64 items-center gap-2 text-base font-semibold text-primary"
            :title="appointment.petName || '未命名寵物'"
          >
            <PawPrint class="h-4 w-4 shrink-0" stroke-width="1.75" />
            <span class="truncate">{{ appointment.petName || '未命名寵物' }}</span>
          </router-link>
          <span v-else class="inline-flex min-w-0 max-w-64 items-center gap-2 text-base font-semibold text-foreground" :title="appointment.petName || appointment.ownerName">
            <UserRound class="h-4 w-4 shrink-0" stroke-width="1.75" />
            <span class="truncate">{{ appointment.petName || appointment.ownerName }}</span>
          </span>

          <Badge variant="status" :class="APPOINTMENT_STATUS_META[appointment.status]?.class">
            {{ APPOINTMENT_STATUS_META[appointment.status]?.label || appointment.status }}
          </Badge>
          <Badge v-if="!appointment.petId" variant="status" class="bg-muted text-muted-foreground">未建檔</Badge>
          <Badge v-if="appointment.isSurgery" variant="status" class="bg-accent text-accent-foreground">
            <Scissors class="mr-1 h-3 w-3" />手術
          </Badge>
        </div>

        <div class="mt-0.5 flex min-w-0 items-center gap-2 text-muted-foreground">
          <span class="max-w-44 shrink-0 truncate text-sm" :title="`飼主 ${appointment.ownerName}`">飼主 {{ appointment.ownerName }}</span>
          <span v-if="appointment.reason" class="min-w-0 flex-1 truncate text-sm" :title="appointment.reason">· {{ appointment.reason }}</span>
          <span v-if="appointment.ownerPhone" class="inline-flex shrink-0 items-center gap-1 text-xs">
            <Phone class="h-3 w-3" stroke-width="1.75" />{{ appointment.ownerPhone }}
          </span>
        </div>
      </div>

      <div v-if="actions.length" class="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 border-t border-border px-3 py-1.5 sm:w-auto sm:border-t-0 sm:border-l">
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

      <button
        v-if="appointment.status === 'arrived'"
        type="button"
        class="flex shrink-0 items-center justify-center border-t border-border px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:border-t-0 sm:border-l"
        :aria-expanded="expanded"
        aria-label="展開報到量測資訊"
        @click="toggleExpanded"
      >
        <ChevronDown class="h-4 w-4 transition-transform" :class="expanded ? 'rotate-180' : ''" stroke-width="1.75" />
      </button>
    </div>

    <div v-if="expanded && appointment.status === 'arrived'" class="border-t border-border bg-muted/20 px-4 py-3">
      <div class="grid gap-3 sm:grid-cols-[8rem_8rem_minmax(0,1fr)_auto] sm:items-end">
        <div>
          <Label :for="`weight-${appointment._id}`">體重（kg）</Label>
          <Input :id="`weight-${appointment._id}`" v-model="vitalsDraft.weightKg" type="number" step="0.01" min="0" class="mt-1" placeholder="kg" />
        </div>
        <div>
          <Label :for="`temperature-${appointment._id}`">體溫（°C）</Label>
          <Input :id="`temperature-${appointment._id}`" v-model="vitalsDraft.temperatureC" type="number" step="0.1" min="0" class="mt-1" placeholder="°C" />
        </div>
        <div>
          <Label :for="`vitals-notes-${appointment._id}`">備註</Label>
          <Textarea :id="`vitals-notes-${appointment._id}`" v-model="vitalsDraft.notes" rows="1" class="mt-1 min-h-10" />
        </div>
        <Button type="button" size="sm" :disabled="vitalsSaving" @click="saveVitals">{{ vitalsSaving ? '處理中…' : '完成看診' }}</Button>
      </div>
    </div>
  </article>
</template>
