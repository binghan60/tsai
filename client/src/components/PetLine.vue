<script setup>
import { computed } from 'vue';
import PetSex from './PetSex.vue';
import { breedText } from '../lib/petDisplay';

// 清單上貓咪名字下面那一行：品種＋性別圖示。其餘資料（年齡、結紮、飼主）只在標頭的規格欄出現。
const props = defineProps({
  pet: { type: Object, default: null },
  // 沒有貓咪文件時（初診尚未建檔）用掛號快照的物種文字。
  fallback: { type: String, default: '' },
  sex: { type: String, default: '' },
});

const breed = computed(() => breedText(props.pet, props.fallback));
const sexValue = computed(() => props.sex || props.pet?.sex || '');
</script>

<template>
  <span v-if="breed || sexValue" class="inline-flex min-w-0 items-center gap-1 text-sm text-subtle-foreground">
    <span class="truncate">{{ breed }}</span>
    <PetSex :sex="sexValue" />
  </span>
</template>
