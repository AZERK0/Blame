export type ReceiptLine = { priceCents: number; quantity: number };
export type ReceiptSummary = { count: number; totalCents: number };

export function summarizeReceipt(lines: readonly ReceiptLine[]): ReceiptSummary {
    return { count: 0, totalCents: 0 };
}
