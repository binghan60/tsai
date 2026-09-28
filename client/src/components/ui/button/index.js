import { cva } from "class-variance-authority";

export { default as Button } from "./Button.vue";

export const buttonVariants = cva(
  // 層級靠底色分：primary 實色（兩個主題都不加光暈，使用者覺得深色的光暈看了不舒服）、secondary 下凹底加一圈細邊、
  // soft 主色淡面、destructive 淡紅底（這兩種淺色按鈕帶一圈同色系細邊，淡面放在淺色卡片上才不會糊成一片）、destructive-solid 實心紅（只給確認視窗裡的最終動作）。
  // 所有按鈕靜止時都要有底色：曾經有過只在滑過時才出底色的 ghost，使用者覺得「沒有顏色、不好看」，已拿掉；
  // 工具列、清單列上的圖示鈕、關閉鈕、日期前後鈕一律用 secondary。
  // leading-none：按鈕是單行控制項，不吃全域的中文行高。
  "focus-visible:ring-focus-ring aria-invalid:ring-destructive/20 aria-invalid:border-destructive border border-transparent bg-clip-padding text-sm leading-none font-semibold focus-visible:ring-3 aria-invalid:ring-3 [&_svg:not([class*=size-])]:size-[1.125rem] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[background-color,color,box-shadow] outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 aria-expanded:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-secondary-hover aria-expanded:bg-secondary-hover",
        soft:
          "border-primary/30 bg-accent text-accent-foreground hover:bg-accent/80 aria-expanded:bg-accent/80",
        destructive:
          "border-destructive/30 bg-destructive-surface text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/25 dark:hover:bg-destructive/20",
        "destructive-solid":
          "bg-destructive-solid text-destructive-solid-foreground hover:bg-destructive-solid/90 focus-visible:ring-destructive-solid/30",
        link: "bg-transparent px-0 text-primary underline-offset-4 hover:underline",
      },
      // 高度 36／40／44／48，預設 40。圖示按鈕跟一般按鈕同圓角（8px），不另外做成圓形。
      size: {
        default:
          "h-10 gap-2 rounded-lg px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-9 gap-1.5 rounded-lg px-3",
        sm: "h-9 gap-1.5 rounded-lg px-3.5",
        lg: "h-12 gap-2 rounded-lg px-5 text-base",
        icon: "size-10 rounded-lg",
        "icon-xs": "size-8 rounded-md",
        "icon-sm": "size-9 rounded-lg",
        "icon-lg": "size-11 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
