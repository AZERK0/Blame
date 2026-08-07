export const pierreGutterUtilityCSS = `
[data-gutter-utility-slot] {
  justify-content: flex-end;
  pointer-events: none;
}

[data-utility-button] {
  align-items: center;
  appearance: none;
  background: var(--primary, #2563eb) !important;
  border: 1px solid color-mix(in oklab, var(--primary, #2563eb) 70%, transparent) !important;
  border-radius: 9999px !important;
  box-shadow: 0 2px 8px color-mix(in oklab, var(--primary, #2563eb) 28%, transparent);
  color: var(--primary-foreground, white) !important;
  display: flex;
  height: 1.75rem !important;
  justify-content: center;
  margin-right: 0.25rem;
  padding: 0;
  pointer-events: auto;
  position: relative;
  width: 1.75rem !important;
}

[data-utility-button] [data-icon] {
  display: none;
}

[data-utility-button]::before {
  background: currentColor;
  content: "";
  display: block;
  flex: 0 0 auto;
  height: 0.9rem;
  inset: auto;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z'/%3E%3C/svg%3E") center / contain no-repeat;
  position: static;
  width: 0.9rem;
}

[data-utility-button]:hover {
  background: color-mix(in oklab, var(--primary, #2563eb) 84%, white) !important;
  box-shadow: 0 3px 10px color-mix(in oklab, var(--primary, #2563eb) 38%, transparent);
}

[data-utility-button]:focus-visible {
  outline: 2px solid var(--ring, currentColor);
  outline-offset: 2px;
}
`

export function labelPierreGutterUtility(node: HTMLElement, label: string) {
  const button = node.shadowRoot?.querySelector<HTMLButtonElement>(
    "[data-utility-button]"
  )
  button?.setAttribute("aria-label", label)
  button?.setAttribute("title", label)
}
