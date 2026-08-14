<script setup>
import { XIcon } from "@lucide/vue";
import { reactiveOmit } from "@vueuse/core";
import {
  DialogClose,
  DialogContent,
  DialogPortal,
  useForwardPropsEmits,
} from "reka-ui";
import { cn } from "@/lib/utils";
import { Button } from '@/components/ui/button';
import DialogOverlay from "./DialogOverlay.vue";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps({
  forceMount: { type: Boolean, required: false },
  disableOutsidePointerEvents: { type: Boolean, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
  showCloseButton: { type: Boolean, required: false, default: true },
});
const emits = defineEmits([
  "escapeKeyDown",
  "pointerDownOutside",
  "focusOutside",
  "interactOutside",
  "openAutoFocus",
  "closeAutoFocus",
]);

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-0 overflow-hidden rounded-2xl border border-cream-300/90 bg-cream-50/95 text-ink-900 shadow-2xl shadow-ink-900/20 ring-1 ring-white/60 backdrop-blur-xl duration-200 dark:border-zinc-700/80 dark:bg-zinc-900/95 dark:text-zinc-100 dark:shadow-black/70 dark:ring-white/10 data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 outline-none sm:max-w-md',
          props.class,
        )
      "
    >
      <!-- Top Filigree Accent Bar -->
      <div class="absolute inset-x-0 top-0 z-10 h-1 bg-gradient-to-r from-brand-300 via-belle-500 to-brand-500 dark:from-brand-500 dark:via-belle-400 dark:to-amber-300"></div>

      <!-- Ambient Soft Corner Glow -->
      <div class="pointer-events-none absolute -right-20 -top-20 z-0 h-44 w-44 rounded-full bg-brand-500/10 blur-3xl dark:bg-brand-500/15"></div>

      <slot />

      <DialogClose v-if="showCloseButton" data-slot="dialog-close" as-child>
        <button
          type="button"
          class="absolute top-3.5 right-3.5 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-cream-300 bg-cream-100 text-ink-600 shadow-sm transition-all duration-150 hover:bg-cream-200 hover:text-ink-900 active:scale-95 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-white"
        >
          <XIcon class="h-4 w-4" stroke-width="2" />
          <span class="sr-only">關閉</span>
        </button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
