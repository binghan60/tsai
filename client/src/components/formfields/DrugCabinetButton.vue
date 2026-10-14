<script setup>
import { Pill } from '@lucide/vue';
import { Button } from '../ui/button';

// 藥櫃鈕：放在藥單／用藥欄位標籤列的右上角，點了開藥櫃視窗（由欄位元件的 openPicker 處理）。
</script>

<template>
  <Button type="button" variant="secondary" size="xs"><Pill stroke-width="1.75" />藥櫃</Button>
</template>
