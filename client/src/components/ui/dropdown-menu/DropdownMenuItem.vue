<script setup>
import { reactiveOmit } from '@vueuse/core';
import { DropdownMenuItem, useForwardPropsEmits } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps({
  disabled: { type: Boolean, required: false },
  textValue: { type: String, required: false },
  // 危險項靜止時就是紅字：選單裡「刪除」跟「複製連結」如果長得一樣，掃過去看不出哪個會出事。
  variant: { type: String, default: 'default' },
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
const emits = defineEmits(['select']);

const delegatedProps = reactiveOmit(props, 'class', 'variant');
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DropdownMenuItem
    data-slot="dropdown-menu-item"
    :data-variant="variant"
    v-bind="forwarded"
    :class="cn(
      'relative flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-base outline-none select-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-[1.125rem] [&_svg]:shrink-0 [&_svg]:text-subtle-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive-surface data-[variant=destructive]:[&_svg]:text-destructive',
      props.class,
    )"
  >
    <slot />
  </DropdownMenuItem>
</template>
