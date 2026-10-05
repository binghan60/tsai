<script setup>
import { MoreHorizontal } from '@lucide/vue';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';

// 清單每一列的次要操作。主要操作留在列上，其餘收進這個選單，
// 一列上才不會並排四五顆同等重量的按鈕。危險項放在最後、前面隔一條線、靜止時就是紅字。
const props = defineProps({
  // [{ key, label, icon?, danger?, disabled? }]
  actions: { type: Array, required: true },
  label: { type: String, default: '更多操作' },
  triggerText: { type: String, default: '' },
  // 觸發鈕圖示，預設「更多操作」的刪節號。
  icon: { type: [Function, Object], default: null },
  // 跟同一排的主要按鈕同高：清單列的按鈕是 sm（36），所以預設 sm；旁邊是一般大小（40）的按鈕時傳 default。
  size: { type: String, default: 'sm', validator: (value) => ['sm', 'default'].includes(value) },
});

function triggerSize() {
  if (props.triggerText) return props.size;
  return props.size === 'default' ? 'icon' : 'icon-sm';
}

const emit = defineEmits(['select']);

function isFirstDanger(action, index) {
  return action.danger && index > 0 && !props.actions[index - 1].danger;
}
</script>

<template>
  <DropdownMenu :modal="false">
    <DropdownMenuTrigger as-child>
      <Button type="button" variant="secondary" :size="triggerSize()" :class="props.triggerText ? 'w-full justify-center' : ''" :aria-label="props.label">
        <component :is="props.icon || MoreHorizontal" stroke-width="1.75" />
        <span v-if="props.triggerText">{{ props.triggerText }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <template v-for="(action, index) in props.actions" :key="action.key">
        <DropdownMenuSeparator v-if="isFirstDanger(action, index)" />
        <DropdownMenuItem
          :variant="action.danger ? 'destructive' : 'default'"
          :disabled="action.disabled"
          @select="emit('select', action.key)"
        >
          <component :is="action.icon" v-if="action.icon" stroke-width="1.75" />
          {{ action.label }}
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
