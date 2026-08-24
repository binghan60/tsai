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
  // sm 確認框、md 一般表單、lg 多欄位表單（寵物資料、健檢範本）。
  size: {
    type: String,
    required: false,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v),
  },
});

const SIZE_CLASS = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
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
// 幾個刻意的選擇：
// - 底色完全不透明：半透明面板會逼合成器連同底下的遮罩一起算，
//   不透明的話這塊區域可以直接蓋掉，下層不必繪製。
// - 不加 ring：ring 是額外一圈 box-shadow，和 border 視覺上重疊。
// - 深色的邊框帶一點 brand，呼應「深色 = 琥珀橘」的主色分工。
// - 進場 150ms、離場 100ms：關閉要比開啟更快，才不會有「黏住」的感覺。
// 陰影從 shadow-xl 降到 shadow-lg：遮罩已經從 /75 降到 /60，兩者原本都很重，
// 疊起來對比過猛，面板像是浮在很遠的地方。
const CONTENT_CLASS = 'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-0 overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-lg shadow-black/20 dark:shadow-black/60 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:duration-150 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-100 outline-none';
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn(CONTENT_CLASS, SIZE_CLASS[props.size], props.class)"
    >
      <!-- 頂部飾線。兩個主題各用各的主色，不混色：
           淺色是 Belle Époque 的酒紅描金，深色是科技感的琥珀橘。 -->
      <div class="absolute inset-x-0 top-0 z-10 h-0.5 bg-primary/70"></div>

      <!-- 原本這裡還有一層角落光暈。拿掉的理由是它出現在「確定要刪除嗎」這種
           兩行的對話框上時，裝飾元素比內容還多——頂部飾線已經足夠標示這是誰的介面。 -->
      <slot />

      <DialogClose v-if="showCloseButton" data-slot="dialog-close" as-child>
        <button
          type="button"
          class="absolute top-5 right-5 z-20 sm:top-6 sm:right-6 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-accent hover:text-primary active:scale-95"
        >
          <XIcon class="h-4 w-4" stroke-width="1.75" />
          <span class="sr-only">關閉</span>
        </button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
