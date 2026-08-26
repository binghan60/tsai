<script setup>
import { ref } from 'vue';
import { MoreHorizontal } from '@lucide/vue';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

// 清單每一列的次要操作。
//
// 存在的理由：一列上並排四五個同等重量的按鈕時，「這一列最該做的事是哪個」就消失了，
// 而且窄螢幕會折成兩三行，整份清單的節奏跟著散掉。主要操作留在列上，其餘收進這裡。
//
// 危險項用常駐的紅字而不是 hover 才變紅——選單裡「刪除」跟「複製連結」如果靜止時
// 長得一樣，掃過去時看不出哪一個會出事。
const props = defineProps({
  // [{ key, label, icon?, danger?, disabled? }]
  actions: { type: Array, required: true },
  label: { type: String, default: '更多操作' },
});

const emit = defineEmits(['select']);
const open = ref(false);

function choose(action) {
  if (action.disabled) return;
  open.value = false;
  emit('select', action.key);
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button type="button" variant="secondary" size="icon-sm" :aria-label="props.label">
        <MoreHorizontal class="h-4 w-4" stroke-width="1.75" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-48 p-1">
      <button
        v-for="action in props.actions"
        :key="action.key"
        type="button"
        class="flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
        :class="action.danger ? 'bg-destructive/10 text-destructive hover:bg-destructive/20' : 'bg-muted/60 text-foreground hover:bg-secondary'"
        :disabled="action.disabled"
        @click="choose(action)"
      >
        <component :is="action.icon" v-if="action.icon" class="h-4 w-4 shrink-0" stroke-width="1.75" />
        {{ action.label }}
      </button>
    </PopoverContent>
  </Popover>
</template>
