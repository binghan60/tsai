<script setup>
import { ChevronDownIcon } from "@lucide/vue";
import { reactiveOmit } from "@vueuse/core";
import { SelectIcon, SelectTrigger, useForwardProps } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps({
  disabled: { type: Boolean, required: false },
  reference: { type: null, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
  size: { type: String, required: false, default: "default" },
});

const delegatedProps = reactiveOmit(props, "class", "size");
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectTrigger
    data-slot="select-trigger"
    :data-size="size"
    v-bind="forwardedProps"
    :class="
      cn(
        'border-input data-placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:ring-focus-ring aria-invalid:ring-destructive/15 aria-invalid:border-destructive gap-1.5 rounded-lg border bg-field py-2 pr-2.5 pl-3 text-base leading-none transition-[border-color,box-shadow] select-none hover:border-subtle-foreground/50 focus-visible:ring-3 aria-invalid:ring-3 data-[size=default]:h-10 data-[size=sm]:h-9 data-[size=sm]:text-sm *:data-[slot=select-value]:gap-1.5 [&_svg:not([class*=size-])]:size-[1.125rem] [&_svg]:text-subtle-foreground flex w-fit items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
        props.class,
      )
    "
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDownIcon
        class="text-muted-foreground size-4 pointer-events-none"
      />
    </SelectIcon>
  </SelectTrigger>
</template>
