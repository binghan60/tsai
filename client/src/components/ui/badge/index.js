import { cva } from "class-variance-authority";

export { default as Badge } from "./Badge.vue";

export const badgeVariants = cva(
  // h-5(20px) 是為 12px 文字設計的，裝不下 14px 還要留白。py-0.5 也一併拿掉——
  // 高度由 h-6 決定，留著 padding 只會跟固定高度打架（使用端覆寫 py-1 時尤其明顯）。
  // leading-none 同 Button：徽章是單行元素，不該吃全域的中文行高。
  "h-6 gap-1 rounded-4xl border border-transparent px-2.5 text-xs leading-none font-medium transition-all has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&>svg]:size-3.5! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        // 狀態徽章。底色與文字色由 lib/recordStatus.js 的 meta 提供，
        // 這個 variant 只管形狀與留白、刻意不設任何顏色——不然兩邊會打架。
        // 之前是每個使用點各自寫一次 rounded-full px-3 py-1 text-xs font-medium，
        // 全站重複八次，而且 py-1 還跟 base 的固定高度衝突。
        status: "rounded-full px-3",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
