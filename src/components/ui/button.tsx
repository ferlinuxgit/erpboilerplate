import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[2px] border border-window-dark-shadow bg-clip-padding font-mono text-[0.78rem] font-bold whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-window-surface active:not-aria-[haspopup]:translate-x-px active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.55)] hover:brightness-125 active:shadow-[inset_1px_1px_0_rgba(0,0,0,0.6),inset_-1px_-1px_0_rgba(255,255,255,0.25)]",
        outline:
          "bg-window-surface text-window-text shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] hover:bg-window-highlight aria-expanded:bg-window-highlight active:shadow-[inset_1px_1px_0_var(--window-shadow),inset_-1px_-1px_0_var(--window-highlight)]",
        secondary:
          "bg-window-panel text-window-text shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] hover:bg-window-highlight aria-expanded:bg-window-highlight",
        ghost:
          "border-transparent bg-transparent text-current shadow-none hover:border-window-dark-shadow hover:bg-window-highlight hover:text-window-text aria-expanded:bg-window-highlight",
        destructive:
          "bg-destructive text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.4),inset_-1px_-1px_0_rgba(0,0,0,0.55)] hover:brightness-110 focus-visible:ring-destructive",
        link: "border-transparent bg-transparent text-primary shadow-none underline-offset-2 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-1.5 text-[0.67rem] has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2 text-[0.72rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-9 gap-1.5 px-3.5 text-[0.8rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-9 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
