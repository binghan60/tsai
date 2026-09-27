import { cva } from "class-variance-authority";

export { default as Badge } from "./Badge.vue";

export const badgeVariants = cva(
  // 26px 高的膠囊，15px 字。leading-none 同 Button：徽章是單行元素。
  "h-[1.625rem] gap-1 rounded-full border border-transparent px-2.5 text-xs leading-none font-semibold transition-colors has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&>svg]:size-3.5! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-3 focus-visible:ring-focus-ring [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground",
        neutral: "bg-sunken text-muted-foreground",
        secondary: "bg-sunken text-muted-foreground",
        destructive: "bg-destructive-surface text-destructive",
        outline: "bg-transparent text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]",
        // 狀態徽章：顏色由 lib/recordStatus.js 等 meta 提供，這裡只管形狀。
        status: "",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
