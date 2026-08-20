<script setup>
// 空狀態原本三種寫法並存：實線框純文字、虛線框加 icon、卡片內第三種。
// 收成一個元件之後，「這裡本來會有東西」在全站是同一個視覺訊號。
//
// inset 給「卡片內部的空狀態」用——那裡外面已經有一層邊框了，
// 再畫一圈虛線會變成框中框。
defineProps({
  icon: { type: [Object, Function], default: null },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  inset: { type: Boolean, default: false },
});
</script>

<template>
  <div
    class="px-5 text-center"
    :class="inset ? 'py-10' : 'rounded-2xl border border-dashed border-border py-14'"
  >
    <component :is="icon" v-if="icon" class="mx-auto mb-2 h-8 w-8 text-muted-foreground" stroke-width="1.75" />
    <p class="text-sm font-medium text-foreground">{{ title }}</p>
    <p v-if="description" class="mt-1 text-xs text-muted-foreground">{{ description }}</p>
    <slot />
  </div>
</template>
