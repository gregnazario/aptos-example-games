import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-2xl border px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        default: "border-border bg-card/80 text-foreground",
        success: "border-primary/40 bg-primary/10 text-primary",
        warning: "border-[color:var(--mark-x)]/40 bg-[color:var(--mark-x)]/10 text-[color:var(--mark-x)]",
        destructive: "border-destructive/40 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("leading-relaxed", className)} {...props} />;
}

export { Alert, AlertDescription };
