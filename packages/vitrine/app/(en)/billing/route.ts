import { NextResponse } from "next/server";

export function GET() {
  const portalUrl = stripePortalUrl();
  if (!portalUrl) {
    return NextResponse.json(
      { message: "The Stripe Customer Portal is not configured" },
      { status: 503 },
    );
  }
  return NextResponse.redirect(portalUrl);
}

function stripePortalUrl() {
  const configuredUrl = process.env.STRIPE_CUSTOMER_PORTAL_URL;
  if (!configuredUrl) return null;
  if (!URL.canParse(configuredUrl)) return null;
  const portalUrl = new URL(configuredUrl);
  if (portalUrl.protocol !== "https:") return null;
  if (portalUrl.hostname !== "billing.stripe.com") return null;
  return portalUrl;
}
