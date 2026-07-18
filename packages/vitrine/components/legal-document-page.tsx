import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";

import { LandingRevealStyles } from "@/components/landing-reveal-styles";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";

export type LegalBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: readonly string[] }
  | {
      type: "notice";
      title: string;
      paragraphs: readonly string[];
      items?: readonly string[];
    };

export type LegalSection = {
  blocks: readonly LegalBlock[];
  id: string;
  title: string;
};

type LegalDocumentPageProps = {
  effectiveDate: string;
  introduction: readonly string[];
  lastUpdated: string;
  sections: readonly LegalSection[];
  title: string;
  version: string;
};

const inlineReferencePattern =
  /(https?:\/\/[^\s<>()]*[^\s<>().,;:!?]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g;
const emailAddressPattern = /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/;
const inlineReferenceClassName =
  "text-[#dedaff] underline decoration-[#b3acf3]/45 underline-offset-4 transition hover:decoration-[#dedaff]";

export function LegalDocumentPage(props: LegalDocumentPageProps) {
  return (
    <main className="min-h-screen overflow-x-clip bg-[#050712] text-white">
      <SiteHeader />
      <LegalDocumentHeader {...props} />
      <LegalDocumentBody
        documentTitle={props.title}
        sections={props.sections}
      />
      <LandingRevealStyles />
    </main>
  );
}

function LegalDocumentHeader(props: LegalDocumentPageProps) {
  return (
    <header className="relative isolate px-5 pb-14 pt-32 sm:px-8 sm:pb-18 lg:px-10">
      <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_48%_12%,rgba(179,172,243,0.14),transparent_34%),linear-gradient(180deg,#070a17_0%,#050712_88%)]" />
      <div className="mx-auto w-full max-w-5xl">
        <DocumentIdentity title={props.title} />
        <DocumentDates
          effectiveDate={props.effectiveDate}
          lastUpdated={props.lastUpdated}
          version={props.version}
        />
        <Introduction paragraphs={props.introduction} />
      </div>
    </header>
  );
}

function DocumentIdentity({
  title,
}: Pick<LegalDocumentPageProps, "title">) {
  return (
    <div>
      <h1 className="landing-reveal landing-reveal-title mt-4 max-w-4xl text-balance text-[clamp(3rem,8vw,6rem)] font-semibold leading-[0.92] tracking-[-0.065em]">
        {title}
      </h1>
    </div>
  );
}

function DocumentDates({
  effectiveDate,
  lastUpdated,
  version,
}: Pick<LegalDocumentPageProps, "effectiveDate" | "lastUpdated" | "version">) {
  return (
    <dl className="landing-reveal landing-reveal-copy mt-8 flex flex-wrap gap-x-10 gap-y-3 text-sm text-white/48">
      <div className="flex gap-2">
        <dt>Effective date:</dt>
        <dd className="text-white/72">{effectiveDate}</dd>
      </div>
      <div className="flex gap-2">
        <dt>Last updated:</dt>
        <dd className="text-white/72">{lastUpdated}</dd>
      </div>
      <div className="flex gap-2">
        <dt>Version:</dt>
        <dd className="text-white/72">{version}</dd>
      </div>
    </dl>
  );
}

function Introduction({ paragraphs }: { paragraphs: readonly string[] }) {
  return (
    <div className="landing-reveal landing-reveal-copy mt-10 border-t border-white/10 pt-8">
      {paragraphs.map((paragraph) => (
        <p
          key={paragraph}
          className="mt-5 max-w-4xl text-base leading-8 text-white/68 first:mt-0 sm:text-lg"
        >
          <LegalText text={paragraph} />
        </p>
      ))}
    </div>
  );
}

function LegalDocumentBody({
  documentTitle,
  sections,
}: {
  documentTitle: string;
  sections: readonly LegalSection[];
}) {
  return (
    <div className="px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10">
      <div className="mx-auto w-full max-w-5xl">
        <article className="min-w-0 divide-y divide-white/10 rounded-[2rem] border border-white/12 bg-white/[0.045] px-6 shadow-[0_32px_120px_rgba(0,0,0,0.32)] backdrop-blur-2xl sm:px-10">
          {sections.map((section) => (
            <LegalSectionView key={section.id} section={section} />
          ))}
          <DocumentBackLink />
        </article>
      </div>
    </div>
  );
}

function TableOfContents({
  documentTitle,
  sections,
}: {
  documentTitle: string;
  sections: readonly LegalSection[];
}) {
  return (
    <nav
      aria-label={`${documentTitle} sections`}
      className="self-start lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pr-3"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#b3acf3]">
        Contents
      </p>
      <ol className="mt-5 space-y-2 border-l border-white/10 pl-4 text-sm leading-6 text-white/48">
        {sections.map((section) => (
          <li key={section.id}>
            <a className="transition hover:text-white" href={`#${section.id}`}>
              {section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function LegalSectionView({ section }: { section: LegalSection }) {
  return (
    <section id={section.id} className="scroll-mt-28 py-9 sm:py-11">
      <h2 className="text-2xl font-semibold tracking-[-0.035em] text-white sm:text-3xl">
        {section.title}
      </h2>
      <div className="mt-6 space-y-5">{section.blocks.map(LegalBlockView)}</div>
    </section>
  );
}

function LegalBlockView(block: LegalBlock, index: number) {
  const key = `${block.type}-${index}`;
  if (block.type === "paragraph")
    return <LegalParagraph key={key} text={block.text} />;
  if (block.type === "list") return <LegalList key={key} items={block.items} />;
  return <LegalNotice key={key} notice={block} />;
}

function LegalParagraph({ text }: { text: string }) {
  return (
    <p className="text-base leading-8 text-white/64">
      <LegalText text={text} />
    </p>
  );
}

function LegalList({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-3 pl-5 text-base leading-8 text-white/64 marker:text-[#b3acf3]">
      {items.map((item) => (
        <li key={item} className="list-disc pl-1">
          <LegalText text={item} />
        </li>
      ))}
    </ul>
  );
}

function LegalNotice({
  notice,
}: {
  notice: Extract<LegalBlock, { type: "notice" }>;
}) {
  return (
    <aside className="rounded-2xl border border-[#b3acf3]/20 bg-[#b3acf3]/[0.07] p-5 sm:p-6">
      <h3 className="font-semibold text-[#dedaff]">{notice.title}</h3>
      {notice.paragraphs.map((paragraph) => (
        <p key={paragraph} className="mt-3 text-sm leading-7 text-white/66">
          <LegalText text={paragraph} />
        </p>
      ))}
      {notice.items ? <NoticeList items={notice.items} /> : null}
    </aside>
  );
}

function NoticeList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-4 space-y-2 pl-5 text-sm leading-7 text-white/66 marker:text-[#b3acf3]">
      {items.map((item) => (
        <li key={item} className="list-disc pl-1">
          <LegalText text={item} />
        </li>
      ))}
    </ul>
  );
}

function LegalText({ text }: { text: string }) {
  return text
    .split(inlineReferencePattern)
    .map((segment, index) => (
      <LegalTextSegment key={`${segment}-${index}`} value={segment} />
    ));
}

function LegalTextSegment({ value }: { value: string }) {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return (
      <a className={inlineReferenceClassName} href={value}>
        {value}
      </a>
    );
  }
  if (emailAddressPattern.test(value)) {
    return (
      <a className={inlineReferenceClassName} href={`mailto:${value}`}>
        {value}
      </a>
    );
  }
  return value;
}

function DocumentBackLink() {
  return (
    <div className="py-10">
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        <ArrowLeft className="size-4" />
        Back to Blame
      </Link>
    </div>
  );
}
