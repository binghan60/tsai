import { cva } from "class-variance-authority";

export { default as Button } from "./Button.vue";

export const buttonVariants = cva(
  // 版面重新設計後的按鈕語言：拿掉外框，靠實色／淡色填底分層級——border 留在
  // base 裡只是為了 aria-invalid 狀態需要一圈可見邊框，平常一律 border-transparent，
  // 不吃 box-sizing 也不會跳動。圓角改放進 size（見下）：一般按鈕維持 rounded-lg，
  // 純圖示按鈕改圓形，跟其他按鈕的方形（含 outline）做出區隔。
  // leading-none：全域行高為了中文可讀性設到 1.6–1.75，但按鈕是單行控制項，
  // 繼承那個行高會讓文字盒撐到 28px，在 h-9/h-10 裡上下就只剩幾 px。
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 border border-transparent bg-clip-padding text-sm leading-none font-semibold shadow-sm focus-visible:ring-3 aria-invalid:ring-3 [&_svg:not([class*=size-])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors outline-none select-none disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 aria-expanded:bg-primary/90",
        // 淡色填底取代「描邊＋極淡填色」——跟現況比對比更清楚，也不用再畫一圈邊框。
        outline:
          "bg-accent text-accent-foreground hover:bg-primary/15 aria-expanded:bg-primary/15",
        // 中性淡底，跟 outline 的主色調分開：這個是「可重複執行的支援操作」，不代表主色。
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-muted aria-expanded:bg-muted",
        destructive:
          "bg-destructive-surface text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        "destructive-solid":
          "bg-destructive-solid text-destructive-solid-foreground hover:bg-destructive-solid/90 focus-visible:ring-destructive-solid/30",
        // 唯一保留邊框的 variant：跟卡片同底色、只靠一圈危險色邊框區分，
        // 用在「撤銷」這類比 destructive-solid 輕、又不想跟 destructive 的淡底混淆的場合。
        "destructive-outline":
          "border-destructive/40 bg-card text-destructive hover:border-destructive/60 hover:bg-destructive/10 focus-visible:ring-destructive/20 dark:border-destructive/50 dark:hover:bg-destructive/15",
        link: "bg-accent/70 text-primary shadow-none underline-offset-4 hover:bg-accent hover:underline",
      },
      // 高度階層是真的分階，不是四個名字指向同一個 h-11。xs 只給桌機的密集表格用；
      // 觸控介面最低到 sm(40px)，一般操作用 default(44px)。
      // icon 系列改成 rounded-full：純圖示的圓形跟一般按鈕的方形是兩種語彙，
      // 圓形留給「只有一個動作、佔最小空間」的場合（分頁按鈕、篩選送出鈕…）。
      size: {
        default:
          "h-11 gap-2 rounded-lg px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-9 gap-1.5 rounded-lg px-3 text-xs",
        sm: "h-10 gap-2 rounded-lg px-3.5",
        lg: "h-12 gap-2 rounded-lg px-5",
        icon: "size-11 rounded-full",
        "icon-xs": "size-9 rounded-full",
        "icon-sm": "size-10 rounded-full",
        "icon-lg": "size-12 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
