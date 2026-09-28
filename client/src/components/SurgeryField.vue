<script setup>
import { useId } from 'vue';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';

// 手術標記：勾了整列變淡紫底（跟時間軸上的手術卡片同一套），時段規則跟一般門診相同。
// 掛號視窗、櫃台約回診、初診表審核共用；勾了就要填手術名稱（後端 normalizeSurgeryFields 同一條）。
const isSurgery = defineModel('isSurgery', { type: Boolean, default: false });
const surgeryName = defineModel('surgeryName', { type: String, default: '' });
defineProps({
  error: { type: String, default: '' },
});
const id = useId();
</script>

<template>
  <div class="flex items-start gap-3 rounded-lg px-3 py-1.5 transition-colors" :class="isSurgery ? 'bg-surgery-surface' : 'bg-sunken'">
    <label :for="id" class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium" :class="isSurgery ? 'text-surgery' : ''">
      <Checkbox :id="id" v-model="isSurgery" />
      手術
    </label>
    <div class="min-w-0 flex-1 space-y-1 py-1">
      <Input v-model="surgeryName" :disabled="!isSurgery" placeholder="手術名稱" aria-label="手術名稱" />
      <p v-if="error" class="text-sm font-medium text-destructive">{{ error }}</p>
    </div>
  </div>
</template>
