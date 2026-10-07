<script setup>
import { computed } from 'vue';
import { Banknote } from '@lucide/vue';
import OptionButtons from './OptionButtons.vue';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { DEPOSIT_REASON_MAX_LENGTH, depositCauseText } from '../../../shared/deposit.js';
import { formatDate } from '../lib/datetime';

// 約診時的保證金決定：這隻貓遲到／未到達到門檻時才出現（規則見 shared/deposit.js）。
// 掛號視窗與櫃台處理視窗的約回診共用。櫃台二選一：已收，或這次不收（要寫原因）。
// 之前取消掛號時留在診所的保證金（state.held）會直接沿用到這一筆，這時只說明、不必選。
// 以前繳過、這次不必再收的（state.since 有值）也提醒一下，只說明、不必選。
// 從來沒繳過、這次也不需要收時整塊不畫。
const props = defineProps({
  // GET /api/pets/:id/attendance 的 deposit：{ required, amount, lateCount, noShowCount, since, held }
  state: { type: Object, default: null },
  petName: { type: String, default: '' },
  // '' | 'collected' | 'waived'
  status: { type: String, default: '' },
  reason: { type: String, default: '' },
  error: { type: String, default: '' },
  idPrefix: { type: String, default: 'deposit' },
});
const emit = defineEmits(['update:status', 'update:reason']);

const options = computed(() => [
  { value: 'collected', label: `已收 ${props.state?.amount ?? ''} 元` },
  { value: 'waived', label: '這次不收' },
]);
const cause = computed(() => depositCauseText(props.state));
// 上次收了之後、還沒到門檻的次數：「遲到 1 次」。都沒有就不寫。
const sinceText = computed(() => [
  props.state?.lateCount > 0 ? `遲到 ${props.state.lateCount} 次` : '',
  props.state?.noShowCount > 0 ? `未到 ${props.state.noShowCount} 次` : '',
].filter(Boolean).join('、'));
</script>

<template>
  <div v-if="state?.required" class="space-y-3 rounded-lg bg-warning-surface px-3.5 py-3 text-warning">
    <div class="flex items-start gap-2.5">
      <Banknote class="mt-0.5 size-5 shrink-0" stroke-width="1.75" aria-hidden="true" />
      <div class="min-w-0">
        <p class="font-semibold">約診前要先收保證金 <span class="num">{{ state.amount }}</span> 元</p>
        <p class="text-sm">{{ petName }}{{ state.since ? '上次收保證金之後' : '' }}已{{ cause }}</p>
      </div>
    </div>
    <OptionButtons :model-value="status" :options="options" aria-label="保證金" @update:model-value="emit('update:status', $event)" />
    <div v-if="status === 'waived'" class="space-y-1.5">
      <Label :for="`${idPrefix}-reason`" class="text-xs font-medium text-warning">不收的原因<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
      <Input :id="`${idPrefix}-reason`" :model-value="reason" :maxlength="DEPOSIT_REASON_MAX_LENGTH" placeholder="例：醫師同意、路上車禍" @update:model-value="emit('update:reason', $event)" />
    </div>
    <p v-if="error" class="text-xs font-medium text-destructive">{{ error }}</p>
  </div>
  <div v-else-if="state?.held" class="flex items-start gap-2.5 rounded-lg bg-success-surface px-3.5 py-3 text-success">
    <Banknote class="mt-0.5 size-5 shrink-0" stroke-width="1.75" aria-hidden="true" />
    <div class="min-w-0">
      <p class="font-semibold">保證金 <span class="num">{{ state.amount }}</span> 元已經收過，這次沿用</p>
      <p class="text-sm"><span class="num">{{ formatDate(state.held.decidedAt) }}</span> 收的那筆掛號後來取消，保證金留在診所</p>
    </div>
  </div>
  <!-- 繳過保證金、這次不必再收：只提醒，讓櫃台知道這隻貓有前例，以及之後又累積了幾次。 -->
  <div v-else-if="state?.since" class="flex items-start gap-2.5 rounded-lg bg-info-surface px-3.5 py-3 text-info">
    <Banknote class="mt-0.5 size-5 shrink-0" stroke-width="1.75" aria-hidden="true" />
    <div class="min-w-0">
      <p class="font-semibold"><span class="num">{{ formatDate(state.since) }}</span> {{ petName }}繳過保證金</p>
      <p v-if="sinceText" class="text-sm">之後又{{ sinceText }}</p>
    </div>
  </div>
</template>
