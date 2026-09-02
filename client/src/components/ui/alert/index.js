import { cva } from "class-variance-authority";

export { default as Alert } from "./Alert.vue";
export { default as AlertAction } from "./AlertAction.vue";
export { default as AlertDescription } from "./AlertDescription.vue";
export { default as AlertTitle } from "./AlertTitle.vue";

export const alertVariants = cva(
  // px-2.5 py-2 對頁面層級的錯誤橫幅太窄——那些原本是各頁手寫的 px-4 py-3。
  // 統一在這裡放寬，對話框裡的 Alert 一起受惠。
  "grid gap-0.5 rounded-lg border px-4 py-3 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*=size-])]:size-4 group/alert relative w-full",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        // 原本是 bg-card——只有紅字沒有紅底。但各頁手寫的錯誤橫幅一直是紅底的，
        // 於是同一件事在對話框裡和頁面上長得不一樣。統一成帶底色的版本：
        // 錯誤需要在掃視時就被看到，只靠文字色不夠。
        // 用 destructive token 而不是 red-50/red-200，深色主題才會跟著翻。
        destructive:
          "border-destructive/30 bg-destructive-surface text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
