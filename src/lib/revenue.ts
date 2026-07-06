/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Order aggregation for the admin Payments screen. Pure — unit tested. Mirrors
 * the Deno copy in supabase/functions/admin-api/index.ts's revenueSummary —
 * keep the two in sync. Amounts are integer cents everywhere (never floats).
 */

export interface OrderLike {
  kind: 'event_package' | 'credit_pack' | 'pro_subscription';
  amount_total: number;
  currency: string;
  status: string;
}

export interface RevenueSummary {
  totalsByCurrency: Record<string, number>;
  oneTimeByCurrency: Record<string, number>;
  subscriptionByCurrency: Record<string, number>;
  orderCount: number;
}

/** Aggregates paid orders by currency, split one-time vs subscription.
 *  `refunded` orders are excluded entirely (not just zeroed). */
export function summarizeOrders(orders: OrderLike[]): RevenueSummary {
  const totalsByCurrency: Record<string, number> = {};
  const oneTimeByCurrency: Record<string, number> = {};
  const subscriptionByCurrency: Record<string, number> = {};
  let orderCount = 0;

  for (const o of orders) {
    if (o.status === 'refunded') continue;
    const currency = (o.currency || 'usd').toLowerCase();
    totalsByCurrency[currency] = (totalsByCurrency[currency] ?? 0) + o.amount_total;
    if (o.kind === 'pro_subscription') {
      subscriptionByCurrency[currency] = (subscriptionByCurrency[currency] ?? 0) + o.amount_total;
    } else {
      oneTimeByCurrency[currency] = (oneTimeByCurrency[currency] ?? 0) + o.amount_total;
    }
    orderCount++;
  }

  return { totalsByCurrency, oneTimeByCurrency, subscriptionByCurrency, orderCount };
}
