"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type BubbleProps = ComponentProps<"div"> & {
  variant?: "default" | "muted";
};

function Bubble({ className, variant = "default", ...props }: BubbleProps) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      className={cn(
        "w-fit rounded-2xl px-3 py-2 text-xs font-medium leading-4",
        variant === "muted"
          ? "bg-black/[0.06] text-[#22242b]"
          : "bg-[#3545ad] text-white",
        className,
      )}
      {...props}
    />
  );
}

function BubbleContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="bubble-content" className={cn(className)} {...props} />
  );
}

function BubbleGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("flex flex-col items-start gap-1", className)}
      {...props}
    />
  );
}

function BubbleReactions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-reactions"
      className={cn(
        "mt-1 flex w-fit rounded-full bg-white px-2 py-0.5 text-xs shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Bubble, BubbleContent, BubbleGroup, BubbleReactions };
