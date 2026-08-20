<script setup>
import { DialogClose } from "reka-ui";
import { cn } from "@/lib/utils";
import { Button } from '@/components/ui/button';

const props = defineProps({
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
  showCloseButton: { type: Boolean, required: false, default: false },
});
</script>

<template>
  <div
    data-slot="dialog-footer"
    :class="
      cn(
        'flex flex-col-reverse gap-2.5 border-t border-border bg-muted/30 p-5 px-6 sm:flex-row sm:justify-end sm:gap-3',
        props.class,
      )
    "
  >
    <slot />
    <DialogClose v-if="showCloseButton" as-child>
      <Button variant="outline"> 關閉 </Button>
    </DialogClose>
  </div>
</template>
