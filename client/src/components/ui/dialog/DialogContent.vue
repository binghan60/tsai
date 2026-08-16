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

// 面板本身的樣式。放在這裡而不是寫進 template 的 :class ——
// 模板表達式裡夾 // 註解會被編譯進 render function，能動但很脆弱。
//
// 幾個刻意的選擇：
// - 底色完全不透明：半透明面板會逼合成器連同底下的遮罩一起算，
//   不透明的話這塊區域可以直接蓋掉，下層不必繪製。
// - 不加 ring：ring 是額外一圈 box-shadow，和 border 視覺上重疊。
// - 深色的邊框帶一點 brand，呼應「深色 = 琥珀橘」的主色分工。
// - 進場 150ms、離場 100ms：關閉要比開啟更快，才不會有「黏住」的感覺。
const CONTENT_CLASS = 'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-0 overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 text-ink-900 shadow-xl shadow-ink-900/25 dark:border-brand-500/25 dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-black/70 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:duration-150 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-100 outline-none sm:max-w-md';
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn(CONTENT_CLASS, props.class)"
    >
      <!-- 頂部飾線。兩個主題各用各的主色，不混色：
           淺色是 Belle Époque 的酒紅描金，深色是科技感的琥珀橘。 -->
      <div class="absolute inset-x-0 top-0 z-10 h-0.5 bg-gradient-to-r from-belle-600 via-brand-300 to-belle-600 dark:from-brand-600 dark:via-brand-300 dark:to-brand-600"></div>

      <!-- Ambient Soft Corner Glow -->
      <div class="ambient-glow pointer-events-none absolute -right-20 -top-20 z-0 h-44 w-44 rounded-full [--glow-color:color-mix(in_oklab,var(--color-belle-500)_12%,transparent)] dark:[--glow-color:color-mix(in_oklab,var(--color-brand-500)_20%,transparent)]"></div>

      <slot />

      <DialogClose v-if="showCloseButton" data-slot="dialog-close" as-child>
        <button
          type="button"
          class="absolute top-3.5 right-3.5 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-cream-300 bg-cream-100 text-ink-500 transition-colors duration-150 hover:border-belle-500/40 hover:bg-belle-50 hover:text-belle-600 active:scale-95 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:border-brand-500/50 dark:hover:bg-zinc-700 dark:hover:text-brand-400"
        >
          <XIcon class="h-4 w-4" stroke-width="1.75" />
          <span class="sr-only">關閉</span>
        </button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
