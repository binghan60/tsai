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
    :class="inset ? 'py-10' : 'rounded-xl border border-dashed border-border-strong py-14'"
  >
    <component :is="icon" v-if="icon" class="mx-auto mb-3 size-9 text-subtle-foreground" stroke-width="1.75" />
    <p class="text-base font-semibold text-foreground">{{ title }}</p>
    <p v-if="description" class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
    <slot />
  </div>
</template>
