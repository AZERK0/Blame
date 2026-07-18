import type {
  LegalBlock,
  LegalSection,
} from "@/components/legal-document-page";
import { legalDocumentReadyForPublication } from "@/content/legal-publication";

const paragraph = (text: string): LegalBlock => ({ type: "paragraph", text });
const list = (...items: string[]): LegalBlock => ({ type: "list", items });
const notice = (
  title: string,
  paragraphs: readonly string[],
  items?: readonly string[],
): LegalBlock => ({ type: "notice", title, paragraphs, items });

export const subprocessorsEffectiveDate = "18 July 2026";
export const subprocessorsLastUpdated = "18 July 2026";
export const subprocessorsVersion = "1.0";

export const subprocessorsIntroduction = [
  "This Subprocessor Register identifies the third parties that Blame currently engages to process Customer Personal Data on behalf of Business Users under the Blame Data Processing Addendum.",
  "The register distinguishes a Subprocessor appointed by Blame from a payment provider processing Blame-controller data and from an AI provider, MCP server, repository host, gateway, or other Third-Party Service independently selected or directed by the Customer.",
  "Questions, change-notice requests, and data-protection objections may be sent to legal@blame.so with a copy to privacy@blame.so.",
] as const;

export const subprocessorsSections = [
  {
    id: "scope",
    title: "1. Scope of this register",
    blocks: [
      paragraph(
        "This register applies only where Blame acts as processor or subprocessor for Customer Personal Data. Capitalised terms have the meanings in the Data Processing Addendum at https://blame.so/legal/dpa.",
      ),
      paragraph(
        "A provider is listed when Blame selects and contracts with it to process Customer Personal Data in support of the Services. A provider is not omitted merely because its infrastructure is operated by an affiliate or because it uses its own authorised subprocessors; relevant onward-processing terms remain governed by Blame's contract with the listed provider.",
      ),
    ],
  },
  {
    id: "current-subprocessors",
    title: "2. Current Subprocessors",
    blocks: [
      notice("OVH SAS — OVHcloud", [
        "Legal entity and address: OVH SAS, 2 rue Kellermann, 59100 Roubaix, France.",
        "Processing function: cloud infrastructure, compute, networking, storage, hosting of the Blame API and database, encrypted backup storage, download infrastructure, and hosting of Blame's self-managed observability services.",
        "Customer Personal Data: Customer Content stored or transmitted through Blame cloud services; Account-scoped identifiers needed to operate the hosted service; encrypted provider-connection data; and minimised technical records associated with hosted processing.",
        "Data subjects: the categories determined by Customer and described in Schedule 1 of the DPA.",
        "Primary processing and storage location: Gravelines, France. Limited support, security, maintenance, network, or operational access may occur through OVHcloud affiliates and service-specific subprocessors under OVHcloud's contractual terms.",
        "Transfer safeguard: primary storage is in the EEA. Where OVHcloud makes a Restricted Transfer or permits covered remote access, the safeguards in the OVHcloud Data Processing Agreement apply, including the relevant European Commission Standard Contractual Clauses where required.",
        "Applicable provider documents: https://www.ovhcloud.com/fr/terms-and-conditions/contracts/.",
        "Authorised from: 18 July 2026.",
      ]),
    ],
  },
  {
    id: "provider-classification",
    title: "3. Providers not acting as Customer Content Subprocessors",
    blocks: [
      notice("Stripe", [
        "Stripe processes checkout, payment, subscription, fraud-prevention, dispute, refund, and related billing data for Blame. Those activities concern personal data for which Blame acts as controller and are described in the Privacy Policy. Stripe does not receive repositories, prompts, files, agent content, or other Customer Content as a Subprocessor under the DPA and is therefore not included in Section 2.",
        "Stripe may act as Blame's processor for some payment functions and as an independent controller for regulatory, fraud, risk, network, and related purposes. Its current role depends on the specific Stripe service and its contractual terms.",
      ]),
      notice("Customer-selected Third-Party Services", [
        "An AI provider, OAuth service, custom model gateway, MCP server, repository host, package registry, API, browser target, or other integration that Customer independently selects, contracts with, configures, or directs Blame to contact is not appointed by Blame merely because the Services transmit data to it on Customer's instruction.",
        "Customer is responsible for assessing that recipient's role, terms, security, locations, retention, training practices, and transfer mechanism. If Blame later selects and contracts with a provider to process Customer Personal Data on Blame's behalf, Blame will add it to Section 2 before the processing begins.",
      ]),
      notice("Open-source software", [
        "Software libraries and self-hosted components running inside Blame's OVHcloud infrastructure are not separate recipients merely because their code is used to provide the Services. A maintainer becomes a Subprocessor only if it receives or can access Customer Personal Data on Blame's behalf.",
      ]),
    ],
  },
  {
    id: "change-notification",
    title: "4. Change notification and objections",
    blocks: [
      paragraph(
        "Blame will provide at least 30 days' advance notice before authorising a new material Subprocessor to process Customer Personal Data, normally by updating this register and sending notice through the Account or Customer contact email. A shorter period may apply where an urgent security, availability, legal, or supplier event makes advance notice impracticable; Blame will then give notice as soon as reasonably practicable.",
      ),
      paragraph(
        "Customer may object on reasonable, documented data-protection grounds by emailing legal@blame.so within 15 days after notice. The objection must identify the affected processing and explain the specific risk. Blame and Customer will work in good faith on a reasonable alternative. If no alternative is reasonably available, the termination right in Section 11 of the DPA applies.",
      ),
      paragraph(
        "A change to a listed provider's company name, address, affiliate structure, or description that does not materially change processing risk may be published without a new objection period. Blame will still maintain an accurate current entry.",
      ),
    ],
  },
  {
    id: "change-history",
    title: "5. Change history",
    blocks: [
      list(
        "18 July 2026 — Version 1.0: initial public register; OVH SAS added as Blame's hosting and infrastructure Subprocessor.",
      ),
    ],
  },
] satisfies readonly LegalSection[];

const subprocessorsApprovedForPublication = true;

export const subprocessorsReadyForPublication =
  legalDocumentReadyForPublication(subprocessorsApprovedForPublication, {
    subprocessorsEffectiveDate,
    subprocessorsIntroduction,
    subprocessorsSections,
    subprocessorsVersion,
  });
