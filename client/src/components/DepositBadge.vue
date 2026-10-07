<script setup>
import { computed } from 'vue';
import { Banknote } from '@lucide/vue';
import { Badge } from './ui/badge';
import { DEPOSIT_AMOUNT } from '../../../shared/deposit.js';

// 保證金標記（規則見 shared/deposit.js），兩種用法：
// - 掛號上：這筆約診時「已收保證金」——系統不追蹤退還或抵扣，櫃台結帳時要看得到才記得處理；
//   「這次不收」的掛號不畫（沒有錢要處理），原因放滑過提示沒有意義，所以整顆不出現。
// - 貓咪上（required）：這隻貓下次約診要先收。
const props = defineProps({
  // 掛號的 depositStatus
  status: { type: String, default: '' },
  // 貓咪現在約診需要先收
  required: { type: Boolean, default: false },
});

const label = computed(() => {
  if (props.required) return `約診需收保證金 ${DEPOSIT_AMOUNT}`;
  return props.status === 'collected' ? `已收保證金 ${DEPOSIT_AMOUNT}` : '';
});
</script>

<template>
  <Badge v-if="label" variant="status" class="bg-warning-surface font-semibold text-warning tabular-nums">
    <Banknote stroke-width="1.75" aria-hidden="true" />
    {{ label }}
  </Badge>
</template>
