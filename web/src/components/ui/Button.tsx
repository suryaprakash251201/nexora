import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-xl text-sm font-medium transition-all duration-200 ease-out whitespace-nowrap outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-[0_4px_16px_var(--color-accent-glow)] hover:opacity-90 hover:shadow-[0_6px_24px_var(--color-accent-glow)] active:translate-y-px",
        secondary:
          "bg-glass-bg text-foreground border border-glass-border hover:bg-glass-bg-strong hover:border-accent/30 active:translate-y-px",
        ghost:
          "text-text-secondary hover:bg-accent hover:text-accent-foreground active:translate-y-px",
        danger:
          "bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 active:translate-y-px",
        outline:
          "border border-glass-border bg-transparent text-foreground hover:bg-glass-bg active:translate-y-px",
        default:
          "bg-primary text-primary-foreground shadow-[0_4px_16px_var(--color-accent-glow)] hover:opacity-90 active:translate-y-px",
        link:
          "text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 gap-1 px-2.5 text-xs rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-9 gap-2 px-3.5 text-sm",
        lg: "h-10 gap-2.5 px-5 text-base",
        default: "h-9 gap-2 px-3.5 text-sm",
        xs: "h-6 gap-1 rounded-lg px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-lg p-0 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-9 rounded-xl p-0",
        "icon-lg": "size-10 rounded-xl p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, icon, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={props.disabled || loading}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
