"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Marker({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="marker"
      className={cn("flex items-center justify-center", className)}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="marker-content"
      className={cn(
        "rounded-full border border-black/[0.06] bg-white/70 px-3 py-1 text-[9px] font-semibold text-black/42",
        className,
      )}
      {...props}
    />
  );
}

export { Marker, MarkerContent };
