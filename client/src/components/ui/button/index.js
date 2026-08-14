import { cva } from "class-variance-authority";

export { default as Button } from "./Button.vue";

export const buttonVariants = cva(
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-xl border bg-clip-padding text-sm font-semibold shadow-sm focus-visible:ring-3 aria-invalid:ring-3 active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*=size-])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-md aria-expanded:bg-primary/90",
        outline:
          "border-primary/35 bg-card text-primary hover:border-primary/60 hover:bg-secondary hover:text-secondary-foreground aria-expanded:border-primary/60 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        secondary:
          "border-secondary bg-secondary text-secondary-foreground hover:border-primary/25 hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground",
        ghost:
          "border-border/70 bg-muted/70 text-foreground hover:border-primary/30 hover:bg-muted aria-expanded:border-primary/30 aria-expanded:bg-muted",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive hover:border-destructive/50 hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        "destructive-solid":
          "border-destructive-solid bg-destructive-solid text-destructive-solid-foreground hover:bg-destructive-solid/90 hover:shadow-md focus-visible:ring-destructive-solid/30",
        "destructive-outline":
          "border-destructive/40 bg-card text-destructive hover:border-destructive/60 hover:bg-destructive/10 focus-visible:ring-destructive/20 dark:border-destructive/50 dark:hover:bg-destructive/15",
        link: "border-transparent bg-transparent text-primary shadow-none underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-11 gap-2 px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-8 gap-1.5 rounded-lg px-2.5 text-xs in-data-[slot=button-group]:rounded-lg [&_svg:not([class*=size-])]:size-3",
        sm: "h-10 gap-1.5 rounded-lg px-3 text-[0.8rem] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*=size-])]:size-3.5",
        lg: "h-12 gap-2 px-5 text-base",
        icon: "size-11",
        "icon-xs": "size-8 rounded-lg [&_svg:not([class*=size-])]:size-3",
        "icon-sm": "size-10 rounded-lg",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
