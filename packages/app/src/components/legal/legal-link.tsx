import type { MouseEvent, ReactNode } from "react"

import { usePlatform } from "@/context/platform"
import { cn } from "@/lib/utils"

const legalPageUrls = {
  privacy: "https://blame.so/privacy",
  refund: "https://blame.so/refund-policy",
  terms: "https://blame.so/terms-of-service",
  withdrawal: "https://blame.so/withdraw",
} as const

type LegalPage = keyof typeof legalPageUrls

export function LegalLink({
  children,
  className,
  page,
}: {
  children: ReactNode
  className?: string
  page: LegalPage
}) {
  const platform = usePlatform()
  const href = legalPageUrls[page]

  function openInBrowser(event: MouseEvent<HTMLAnchorElement>) {
    if (!platform.openExternalLink) return
    event.preventDefault()
    platform.openExternalLink(href)
  }

  return (
    <a
      className={cn(
        "underline underline-offset-2 hover:text-foreground",
        className
      )}
      href={href}
      rel="noreferrer"
      target="_blank"
      onClick={openInBrowser}
    >
      {children}
    </a>
  )
}
