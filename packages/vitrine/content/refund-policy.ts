import type {
  LegalBlock,
  LegalSection,
} from "@/components/legal-document-page";
import { legalDocumentReadyForPublication } from "@/content/legal-publication";

const paragraph = (text: string): LegalBlock => ({ type: "paragraph", text });
const list = (...items: string[]): LegalBlock => ({ type: "list", items });
const notice = (title: string, paragraphs: readonly string[]): LegalBlock => ({
  type: "notice",
  title,
  paragraphs,
});

export const refundEffectiveDate = "19 July 2026";
export const refundLastUpdated = "19 July 2026";
export const refundVersion = "1.0";

export const refundIntroduction = [
  'This Refund Policy explains when Raphael Charpentier EI, operating under the trade name MK Holding ("Blame"), issues refunds for Blame subscriptions. It supplements the Terms of Service and does not restrict any mandatory Consumer right or legal remedy.',
  "To request a review, contact billing@blame.so from the email address associated with the Account and include the invoice, checkout, or subscription reference and the reason for the request. Do not send full payment-card details.",
] as const;

export const refundSections = [
  {
    id: "standard-rule",
    title: "1. Standard subscription rule",
    blocks: [
      paragraph(
        "A Blame Subscription provides access for the billing period selected at checkout. Except where this Policy, an express checkout promise, the Terms of Service, or mandatory law provides otherwise, amounts already paid are non-refundable and no credit is issued for an unused part of a billing period.",
      ),
      paragraph(
        "Cancelling a Subscription normally prevents its next renewal and leaves paid access available until the end of the current period. Cancellation is available through the Stripe Customer Portal opened by the Billing link under Consumer rights on blame.so.",
      ),
    ],
  },
  {
    id: "withdrawal",
    title: "2. Consumer right of withdrawal",
    blocks: [
      paragraph(
        "An eligible Consumer who concludes a distance contract may generally withdraw without giving a reason within fourteen days after conclusion of the contract. The online function at https://blame.so/withdraw, the model form in the French Conditions Générales de Service, or any other unambiguous statement may be used.",
      ),
      paragraph(
        "For Blame's current Subscription offer, a valid withdrawal is refunded in full. Blame does not deduct a proportional amount for service supplied before withdrawal. Any statutory loss of the right for digital content supplied without a tangible medium applies only where the separate prior express consent and acknowledgement required by law were validly obtained.",
      ),
      notice("Mandatory rights control", [
        "The withdrawal period, exceptions, evidence, and reimbursement rules are determined by the mandatory law applicable to the Consumer. This Policy does not replace or narrow those rules.",
      ]),
    ],
  },
  {
    id: "conformity-remedies",
    title: "3. Legal conformity and defective service",
    blocks: [
      paragraph(
        "Consumers benefit from mandatory legal guarantees, including the French legal guarantee of conformity for digital content and digital services where applicable. A Consumer may be entitled to conformity, a price reduction, termination, or a full or partial refund in the circumstances defined by law.",
      ),
      paragraph(
        "Report the issue to support@blame.so with the affected feature, dates, operating environment, steps to reproduce, and the remedy requested. We may request reasonable cooperation that is necessary and minimally intrusive to determine whether a problem results from incompatibility, while respecting the statutory burden of proof.",
      ),
    ],
  },
  {
    id: "billing-errors",
    title: "4. Billing errors and unauthorised charges",
    blocks: [
      paragraph(
        "We refund a duplicate charge, an amount collected after an effective cancellation, an incorrect price, or another verified billing error to the extent required to correct it. Notify billing@blame.so promptly so that we can investigate with Stripe.",
      ),
      paragraph(
        "If you believe a payment method was used without authority, contact your payment provider without delay and notify us. We may suspend access or preserve transaction evidence while the matter is investigated. This does not affect rights under payment-services law.",
      ),
    ],
  },
  {
    id: "service-discontinuation",
    title: "5. Discontinuation and prolonged unavailability",
    blocks: [
      paragraph(
        "If Blame permanently discontinues a paid Service before the end of a prepaid period for reasons not caused by the user, Blame will provide a pro-rata refund for the unavailable remainder unless the user accepts a materially equivalent replacement or mandatory law requires a different remedy.",
      ),
      paragraph(
        "Routine maintenance, a short interruption, a user-selected third-party provider failure, an unsupported environment, or a local-device issue does not automatically create a refund right. Mandatory conformity, performance, and damages rights remain unaffected.",
      ),
    ],
  },
  {
    id: "business-users",
    title: "6. Business Users",
    blocks: [
      paragraph(
        "Business Users do not receive a voluntary refund unless an order form, quotation, checkout promise, service-level agreement, or mandatory law expressly provides one. A Business User may still claim correction of a billing error and any remedy that cannot lawfully be excluded.",
      ),
    ],
  },
  {
    id: "method-timing",
    title: "7. Refund method and timing",
    blocks: [
      paragraph(
        "Approved refunds are sent to the original payment method unless the user expressly agrees to another lawful method. Blame does not charge a refund fee. Stripe, the bank, or the payment network may require additional processing time after Blame initiates the refund.",
      ),
      list(
        "Valid Consumer withdrawal: without undue delay and no later than fourteen days after Blame receives the withdrawal notice.",
        "Verified billing error: without undue delay after the investigation is completed.",
        "Other approved refund: within a reasonable period stated in the approval notice.",
      ),
      paragraph(
        "Where the law provides interest, penalties, or a shorter deadline, that mandatory rule applies. A refund does not include separate fees charged directly by an AI provider, MCP server, repository host, bank, network provider, or another third party.",
      ),
    ],
  },
  {
    id: "requests-disputes",
    title: "8. Requests, evidence, and disputes",
    blocks: [
      paragraph(
        "Send refund requests to billing@blame.so, withdrawal notices to withdrawal@blame.so, or Consumer complaints to support@blame.so. Include only information reasonably necessary to identify the Account, transaction, and requested remedy.",
      ),
      paragraph(
        "If a French Consumer's written complaint remains unresolved, the Consumer may use the mediator identified in the French Conditions Générales de Service, subject to the mediator's rules and after the required prior complaint. The right to bring proceedings before a competent court remains available.",
      ),
    ],
  },
] satisfies readonly LegalSection[];

export const refundReadyForPublication = legalDocumentReadyForPublication(
  true,
  {
    refundEffectiveDate,
    refundIntroduction,
    refundSections,
    refundVersion,
  },
);
