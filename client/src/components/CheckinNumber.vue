<script setup>
import { computed } from 'vue';
import { Ticket } from '@lucide/vue';
import { checkinTone } from '../lib/appointmentDisplay';

// 現場發出去的實體號碼牌。櫃台與診療台用同一套「依階段上色」：
// 候診灰、看診中主色實心、待櫃台主色淡面、已完成淡灰——兩頁看到同一個人時顏色一致。
const props = defineProps({
  appointment: { type: Object, required: true },
  // md：清單（40px）；lg：工作區與處理視窗標頭（48px）。
  size: { type: String, default: 'md' },
});

const TONE_CLASS = {
  waiting: 'bg-sunken text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]',
  visiting: 'bg-primary text-primary-foreground',
  handoff: 'bg-accent text-accent-foreground',
  done: 'bg-sunken text-subtle-foreground',
};

const sizeClass = computed(() => {
  if (props.size === 'lg') return 'size-12 text-lg';
  if (props.size === 'sm') return 'size-8 text-sm';
  return 'size-10 text-base';
});
const iconClass = computed(() => (props.size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'));
const hasNumber = computed(() => props.appointment.checkinNumber != null);
</script>

<template>
  <span
    v-if="hasNumber"
    class="num flex shrink-0 items-center justify-center rounded-full font-semibold"
    :class="[sizeClass, TONE_CLASS[checkinTone(appointment)]]"
  >{{ appointment.checkinNumber }}</span>
  <span
    v-else
    class="flex shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-subtle-foreground"
    :class="sizeClass"
    v-tip="'未取號'"
  >
    <Ticket :class="iconClass" stroke-width="1.75" aria-hidden="true" />
    <span class="sr-only">未取號</span>
  </span>
</template>
