<script setup>
import { Input } from './ui/input';

// 頻率二擇一：每日幾次（daily）或每幾天一次（every）。被選中的那一段亮起並帶輸入框，另一段只是文字，點了切換。
// 兩段寬度固定，切換時整排不跳動；數字只有一格，切換時保留。
// 整組共用時（withDays）「每日幾次」後面多一格「共幾日」，天數只屬於每日這一段。
const props = defineProps({
  label: { type: String, default: '頻率' },
  withDays: { type: Boolean, default: false },
});
const mode = defineModel('mode', { type: String, default: 'daily' });
const count = defineModel('count', { type: String, default: '' });
const days = defineModel('days', { type: String, default: '' });

const OPTIONS = [
  { mode: 'daily', before: '每日', after: '次', width: 'w-28', daysWidth: 'w-64' },
  { mode: 'every', before: '每', after: '天一次', width: 'w-32', daysWidth: 'w-32' },
];

const digits = (value) => String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');
const onCount = (value) => { count.value = digits(value); };
const onDays = (value) => { days.value = digits(value); };
const widthOf = (option) => (props.withDays ? option.daysWidth : option.width);
const hasDays = (option) => props.withDays && option.mode === 'daily';
</script>

<template>
  <div class="flex shrink-0 items-center gap-0.5 rounded-lg bg-sunken p-0.5" role="radiogroup" :aria-label="label">
    <template v-for="option in OPTIONS" :key="option.mode">
      <span v-if="mode === option.mode" :class="widthOf(option)" class="flex h-8 shrink-0 items-center justify-center gap-1 rounded-md bg-card px-2 text-sm whitespace-nowrap ring-1 ring-primary" role="radio" aria-checked="true">{{ option.before }}<Input :model-value="count" class="num h-6 w-11 px-1 text-center placeholder:text-subtle-foreground/50" placeholder="2" inputmode="numeric" maxlength="2" autocomplete="off" :aria-label="`${label}：${option.before}幾${option.after}`" @update:model-value="onCount" />{{ option.after }}<template v-if="hasDays(option)">，共<Input :model-value="days" class="num h-6 w-12 px-1 text-center placeholder:text-subtle-foreground/50" placeholder="7" inputmode="numeric" maxlength="3" autocomplete="off" :aria-label="`${label}：共幾日`" @update:model-value="onDays" />日</template></span>
      <button v-else type="button" :class="widthOf(option)" class="flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-hover hover:text-foreground" role="radio" aria-checked="false" @click="mode = option.mode">{{ option.before }}＿{{ option.after }}<template v-if="hasDays(option)">，共＿日</template></button>
    </template>
  </div>
</template>
