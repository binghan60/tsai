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
  // 寬度收成三檔。原本 sm:max-w-md 寫死在 CONTENT_CLASS，使用端再用
  // class / contentClass 各自覆寫一次，等於沒有尺度可言。
  // sm 確認框、md 一般表單、lg 多欄位表單（貓咪資料、健檢範本）。
  size: {
    type: String,
    required: false,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg', 'wide', 'xl'].includes(v),
  },
});

const SIZE_CLASS = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  // 雙欄表單（掛號：左欄誰／為什麼、右欄時段格）；比 xl 窄，才不會把兩欄拉得太散。
  wide: 'sm:max-w-[min(60rem,calc(100vw-4rem))]',
  // 長表單與工作台型對話框使用；仍保留視窗邊距，避免小螢幕滿版貼邊。
  xl: 'sm:max-w-[min(80rem,calc(100vw-4rem))]',
};
const emits = defineEmits([
  "escapeKeyDown",
  "pointerDownOutside",
  "focusOutside",
  "interactOutside",
  "openAutoFocus",
  "closeAutoFocus",
]);

const delegatedProps = reactiveOmit(props, "class", "size");

const forwarded = useForwardPropsEmits(delegatedProps, emits);

// 面板本身的樣式。放在這裡而不是寫進 template 的 :class ——
// 模板表達式裡夾 // 註解會被編譯進 render function，能動但很脆弱。
//
// 底色完全不透明（合成器不必連同遮罩一起算）；圓角 16；深色加一圈 border-strong 才浮得起來。
// 進場 150ms、離場 100ms：關閉要比開啟更快，才不會有「黏住」的感覺。
const CONTENT_CLASS = 'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-0 overflow-hidden rounded-2xl border border-border bg-card text-base text-foreground shadow-menu dark:border-border-strong outline-none';
// 進出場動畫只留給小對話框（確認框、短表單）。lg 以上的面板內容多（時段格、表單、工作台），
// 縮放動畫每一幀都要把整塊面板重新光柵化，淡入淡出也會讓開關各多等 100–150ms，
// 在診所的電腦上就是那種「開起來頓一下」；大面板直接出現、直接消失。
const ANIMATE_CLASS = 'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:duration-150 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-100';
const ANIMATE_SIZES = new Set(['sm', 'md']);
</script>

<template>
  <DialogPortal>
    <DialogOverlay :animate="ANIMATE_SIZES.has(props.size)" />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn(CONTENT_CLASS, ANIMATE_SIZES.has(props.size) ? ANIMATE_CLASS : '', SIZE_CLASS[props.size], props.class)"
    >
      <slot />

      <DialogClose v-if="showCloseButton" data-slot="dialog-close" as-child>
        <button
          type="button"
          class="absolute top-4 right-4 z-20 flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground"
        >
          <XIcon class="size-5" stroke-width="1.75" />
          <span class="sr-only">關閉</span>
        </button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
