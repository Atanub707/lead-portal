import { createHmac, timingSafeEqual } from "node:crypto";

export const PRICE_PAISE = 49_900; // ₹499
export const CURRENCY = "INR";
export const PLAN_TOTAL_COUNT = 120; // 10 years of monthly cycles

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function razorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID &&
      process.env.RAZORPAY_KEY_SECRET &&
      process.env.RAZORPAY_PLAN_ID
  );
}

async function razorpayFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const auth = Buffer.from(
    `${env("RAZORPAY_KEY_ID")}:${env("RAZORPAY_KEY_SECRET")}`
  ).toString("base64");
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: { description?: string } })
    | null;
  if (!response.ok) {
    throw new Error(
      json?.error?.description ?? `Razorpay ${path} failed (${response.status})`
    );
  }
  return json as T;
}

export function createSubscription(input: {
  seats: number;
  workspaceId: string;
}) {
  return razorpayFetch<{ id: string; status: string }>("subscriptions", {
    method: "POST",
    body: {
      plan_id: env("RAZORPAY_PLAN_ID"),
      quantity: input.seats,
      total_count: PLAN_TOTAL_COUNT,
      customer_notify: 1,
      notes: { workspace_id: input.workspaceId },
    },
  });
}

export function createSeatOrder(input: { workspaceId: string; seats: number }) {
  return razorpayFetch<{ id: string; amount: number; currency: string }>(
    "orders",
    {
      method: "POST",
      body: {
        amount: PRICE_PAISE,
        currency: CURRENCY,
        notes: {
          kind: "seat",
          workspace_id: input.workspaceId,
          seats_after: String(input.seats),
        },
      },
    }
  );
}

export function cancelSubscription(subscriptionId: string) {
  return razorpayFetch<{ id: string; status: string }>(
    `subscriptions/${subscriptionId}/cancel`,
    { method: "POST", body: { cancel_at_cycle_end: 1 } }
  );
}

export function updateSubscriptionQuantity(
  subscriptionId: string,
  quantity: number
) {
  return razorpayFetch(`subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: { quantity },
  });
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// Checkout handler: subscriptions sign "payment_id|subscription_id",
// orders sign "order_id|payment_id".
export function verifyCheckoutSignature(input: {
  paymentId: string;
  subscriptionId?: string | null;
  orderId?: string | null;
  signature: string;
}): boolean {
  const payload = input.subscriptionId
    ? `${input.paymentId}|${input.subscriptionId}`
    : `${input.orderId}|${input.paymentId}`;
  const expected = createHmac("sha256", env("RAZORPAY_KEY_SECRET"))
    .update(payload)
    .digest("hex");
  return safeEqual(expected, input.signature);
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string
): boolean {
  const expected = createHmac("sha256", env("RAZORPAY_WEBHOOK_SECRET"))
    .update(rawBody)
    .digest("hex");
  return safeEqual(expected, signature);
}
