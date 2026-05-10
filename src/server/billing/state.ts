export const BILLING_PRICE_CONFIGURATION_ERROR = "Configura un Stripe Price ID para activar el checkout.";

export type BillingTenantState = {
  plan: string | null;
};

export type BillingSubscriptionState = {
  plan: string;
  status: string;
  currentPeriodEndsAt: Date | string | null;
  stripeCustomerId?: string | null;
  cancelAtPeriodEnd?: boolean | null;
};

export type BillingPlanState = {
  code: string;
  name: string;
  stripePriceId?: string | null;
  limits?: string | null;
};

export type BillingViewModel = {
  plan: {
    code: string;
    name: string;
    limits: string;
  };
  subscription: {
    statusLabel: string;
    renewalLabel: string;
    hasActiveSubscription: boolean;
  };
  checkout: {
    enabled: boolean;
    priceId: string | null;
    configurationError: string | null;
  };
  portal: {
    enabled: boolean;
    stripeCustomerId: string | null;
  };
};

function normalizeConfiguredValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function formatBillingDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function buildRenewalLabel(subscription: BillingSubscriptionState | null) {
  if (!subscription?.currentPeriodEndsAt) return "Sin renovación persistida";

  const formattedDate = formatBillingDate(subscription.currentPeriodEndsAt);
  if (subscription.cancelAtPeriodEnd) return `Cancela al final del periodo: ${formattedDate}`;

  return `Renueva el: ${formattedDate}`;
}

export function buildBillingViewModel(input: {
  tenant: BillingTenantState;
  subscription: BillingSubscriptionState | null;
  plan: BillingPlanState | null;
  defaultStripePriceId?: string | null;
}): BillingViewModel {
  const planCode = input.subscription?.plan ?? input.tenant.plan ?? "free";
  const priceId = normalizeConfiguredValue(input.plan?.stripePriceId) ?? normalizeConfiguredValue(input.defaultStripePriceId);
  const stripeCustomerId = normalizeConfiguredValue(input.subscription?.stripeCustomerId);

  return {
    plan: {
      code: planCode,
      name: input.plan?.name ?? planCode,
      limits: normalizeConfiguredValue(input.plan?.limits) ?? "Sin límites persistidos",
    },
    subscription: {
      statusLabel: input.subscription?.status ?? "sin suscripción",
      renewalLabel: buildRenewalLabel(input.subscription),
      hasActiveSubscription: Boolean(input.subscription),
    },
    checkout: {
      enabled: Boolean(priceId),
      priceId,
      configurationError: priceId ? null : BILLING_PRICE_CONFIGURATION_ERROR,
    },
    portal: {
      enabled: Boolean(stripeCustomerId),
      stripeCustomerId,
    },
  };
}
