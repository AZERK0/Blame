"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type MessageProps = ComponentProps<"div"> & {
  align?: "start" | "end";
};

function Message({ align = "start", className, ...props }: MessageProps) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "flex w-full items-end gap-2",
        align === "end" && "flex-row-reverse",
        className,
      )}
      {...props}
    />
  );
}

function MessageAvatar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn("shrink-0 [&_[data-slot=avatar]]:size-7", className)}
      {...props}
    />
  );
}

function MessageContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn("flex max-w-[82%] flex-col gap-1", className)}
      {...props}
    />
  );
}

function MessageFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn("px-1 text-[9px] font-medium text-black/38", className)}
      {...props}
    />
  );
}

export { Message, MessageAvatar, MessageContent, MessageFooter };
