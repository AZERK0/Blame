import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from 'react-email'
import React, { type ReactNode } from 'react'

export type AuthEmailBrandProps = {
  homeUrl: string
  logoUrl: string
  recipientName: string
}

type AuthEmailLayoutProps = Omit<AuthEmailBrandProps, 'recipientName'> & {
  children: ReactNode
  preview: string
  title: string
}

export function AuthEmailLayout({
  children,
  homeUrl,
  logoUrl,
  preview,
  title,
}: AuthEmailLayoutProps) {
  return (
    <Html dir="ltr" lang="en">
      <Head>
        <meta content="dark" name="color-scheme" />
        <meta content="dark" name="supported-color-schemes" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <BrandHeader homeUrl={homeUrl} logoUrl={logoUrl} />
          <Section style={styles.card}>
            <Heading style={styles.heading}>{title}</Heading>
            {children}
          </Section>
          <EmailFooter homeUrl={homeUrl} />
        </Container>
      </Body>
    </Html>
  )
}

export function EmailText({ children }: { children: ReactNode }) {
  return <Text style={styles.text}>{children}</Text>
}

export function EmailAction({ href, label }: { href: string; label: string }) {
  return (
    <Section style={styles.actionSection}>
      <Button href={href} style={styles.button}>
        {label}
      </Button>
      <Text style={styles.fallbackLabel}>If the button does not work, copy this secure link:</Text>
      <Link href={href} style={styles.fallbackLink}>
        {href}
      </Link>
    </Section>
  )
}

export function EmailNotice({ children, title }: { children: ReactNode; title: string }) {
  return (
    <Section style={styles.notice}>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeText}>{children}</Text>
    </Section>
  )
}

export function EmailCode({ value }: { value: string }) {
  return (
    <Section style={styles.codeContainer}>
      <Text style={styles.code}>{value}</Text>
    </Section>
  )
}

function BrandHeader({ homeUrl, logoUrl }: Pick<AuthEmailBrandProps, 'homeUrl' | 'logoUrl'>) {
  return (
    <Link href={homeUrl} style={styles.brandLink}>
      <Row>
        <Column style={styles.logoColumn}>
          <Img alt="Blame" height="48" src={logoUrl} style={styles.logo} width="48" />
        </Column>
        <Column>
          <Text style={styles.brandName}>Blame</Text>
          <Text style={styles.brandTagline}>Code with confidence.</Text>
        </Column>
      </Row>
    </Link>
  )
}

function EmailFooter({ homeUrl }: Pick<AuthEmailBrandProps, 'homeUrl'>) {
  return (
    <Section style={styles.footer}>
      <Hr style={styles.footerDivider} />
      <Text style={styles.footerText}>This is an automated account security email from Blame.</Text>
      <Text style={styles.footerText}>
        © {new Date().getUTCFullYear()} Blame ·{' '}
        <Link href={homeUrl} style={styles.footerLink}>
          {websiteLabel(homeUrl)}
        </Link>
      </Text>
    </Section>
  )
}

function websiteLabel(homeUrl: string) {
  return new URL(homeUrl).host
}

const styles = {
  actionSection: {
    margin: '30px 0 26px',
  },
  body: {
    backgroundColor: '#0a0a0a',
    color: '#f5f7ff',
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    margin: '0',
    padding: '0',
  },
  brandLink: {
    color: '#f5f7ff',
    display: 'block',
    padding: '32px 8px 22px',
    textDecoration: 'none',
  },
  brandName: {
    color: '#ffffff',
    fontSize: '20px',
    fontWeight: '700',
    letterSpacing: '-0.3px',
    lineHeight: '24px',
    margin: '0',
  },
  brandTagline: {
    color: '#8f97ad',
    fontSize: '12px',
    lineHeight: '18px',
    margin: '2px 0 0',
  },
  button: {
    backgroundColor: '#3159e8',
    borderRadius: '12px',
    boxSizing: 'border-box',
    color: '#ffffff',
    display: 'block',
    fontSize: '15px',
    fontWeight: '700',
    lineHeight: '20px',
    padding: '15px 24px',
    textAlign: 'center',
    textDecoration: 'none',
    width: '100%',
  },
  card: {
    backgroundColor: '#171717',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '20px',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.34)',
    padding: '42px 44px',
  },
  code: {
    color: '#ffffff',
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: '34px',
    fontWeight: '700',
    letterSpacing: '10px',
    lineHeight: '44px',
    margin: '0',
    paddingLeft: '10px',
    textAlign: 'center',
  },
  codeContainer: {
    backgroundColor: '#262626',
    border: '1px solid #3159e8',
    borderRadius: '14px',
    margin: '28px 0',
    padding: '20px 12px',
  },
  container: {
    margin: '0 auto',
    maxWidth: '600px',
    padding: '20px 16px 38px',
    width: '100%',
  },
  fallbackLabel: {
    color: '#777f96',
    fontSize: '12px',
    lineHeight: '18px',
    margin: '18px 0 5px',
  },
  fallbackLink: {
    color: '#9eb0f7',
    fontSize: '12px',
    lineHeight: '18px',
    overflowWrap: 'anywhere',
    textDecoration: 'underline',
  },
  footer: {
    padding: '4px 8px 0',
  },
  footerDivider: {
    borderColor: '#262626',
    margin: '24px 0 18px',
  },
  footerLink: {
    color: '#9aa4bb',
    textDecoration: 'underline',
  },
  footerText: {
    color: '#656d82',
    fontSize: '11px',
    lineHeight: '18px',
    margin: '4px 0',
    textAlign: 'center',
  },
  heading: {
    color: '#ffffff',
    fontSize: '30px',
    fontWeight: '700',
    letterSpacing: '-0.8px',
    lineHeight: '38px',
    margin: '0 0 22px',
  },
  logo: {
    border: '0',
    borderRadius: '12px',
    display: 'block',
  },
  logoColumn: {
    paddingRight: '13px',
    width: '61px',
  },
  notice: {
    backgroundColor: '#262626',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    margin: '26px 0 0',
    padding: '16px 18px',
  },
  noticeText: {
    color: '#8f97ad',
    fontSize: '13px',
    lineHeight: '20px',
    margin: '4px 0 0',
  },
  noticeTitle: {
    color: '#dfe4f3',
    fontSize: '13px',
    fontWeight: '700',
    lineHeight: '20px',
    margin: '0',
  },
  text: {
    color: '#aeb5c7',
    fontSize: '15px',
    lineHeight: '25px',
    margin: '0 0 16px',
  },
} satisfies Record<string, React.CSSProperties>
