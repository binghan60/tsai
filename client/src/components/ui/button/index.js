import { cva } from "class-variance-authority";

export { default as Button } from "./Button.vue";

export const buttonVariants = cva(
  // 三個刻意的調整：
  // - rounded-xl → rounded-lg：16px 圓角配 h-10/h-11 的按鈕太圓，接近膠囊，
  //   跟 Belle Époque 的平面調性不合。
  // - 拿掉 active:translate-y-px：位移＋陰影是擬物語彙，這套設計不走那個方向。
  // - leading-none：全域行高為了中文可讀性設到 1.6–1.75，但按鈕是單行控制項，
  //   繼承那個行高會讓文字盒撐到 28px，在 h-9/h-10 裡上下就只剩幾 px。
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-lg border bg-clip-padding text-sm leading-none font-semibold shadow-sm focus-visible:ring-3 aria-invalid:ring-3 [&_svg:not([class*=size-])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors outline-none select-none disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:bg-primary/90 aria-expanded:bg-primary/90",
        outline:
          "border-primary/30 bg-primary/8 text-primary hover:border-primary/55 hover:bg-primary/14 aria-expanded:border-primary/55 aria-expanded:bg-primary/14",
        secondary:
          "border-secondary bg-secondary text-secondary-foreground hover:border-primary/25 hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground",
        // ghost 原本帶 border-border/70 bg-muted/70——那是 secondary 的長相，不是 ghost。
        // 結果表格每一列的 icon 按鈕都頂著一塊實心灰底，整張表看起來很髒。
        // 真正的 ghost 平時完全透明，只有 hover 才浮出來。
        ghost:
          "border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive hover:border-destructive/50 hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        "destructive-solid":
          "border-destructive-solid bg-destructive-solid text-destructive-solid-foreground hover:bg-destructive-solid/90 focus-visible:ring-destructive-solid/30",
        "destructive-outline":
          "border-destructive/40 bg-card text-destructive hover:border-destructive/60 hover:bg-destructive/10 focus-visible:ring-destructive/20 dark:border-destructive/50 dark:hover:bg-destructive/15",
        link: "border-transparent bg-transparent text-primary shadow-none underline-offset-4 hover:underline",
      },
      // 高度階層是真的分階，不是四個名字指向同一個 h-11。之前全部塌成 44px，
      // 結果密集表格的每一列都被一顆 44px 的按鈕撐開，清單看起來又鬆又笨重。
      // 文字盒有 leading-none 壓住（16px 字＝16px 盒），h-9 上下仍有 10px 留白。
      // xs 只給桌機的密集表格用；觸控介面最低到 sm(40px)，一般操作用 default(44px)。
      size: {
        default:
          "h-11 gap-2 px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-9 gap-1.5 px-3 text-xs",
        sm: "h-10 gap-2 px-3.5",
        lg: "h-12 gap-2 px-5",
        icon: "size-11",
        "icon-xs": "size-9",
        "icon-sm": "size-10",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
