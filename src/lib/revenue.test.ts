import { describe, it, expect } from 'vitest';
import { summarizeOrders, type OrderLike } from './revenue';

describe('summarizeOrders', () => {
  it('returns zeros for an empty order list', () => {
    expect(summarizeOrders([])).toEqual({
      totalsByCurrency: {},
      oneTimeByCurrency: {},
      subscriptionByCurrency: {},
      orderCount: 0,
    });
  });

  it('excludes refunded orders entirely', () => {
    const orders: OrderLike[] = [
      { kind: 'credit_pack', amount_total: 500, currency: 'usd', status: 'paid' },
      { kind: 'credit_pack', amount_total: 2000, currency: 'usd', status: 'refunded' },
    ];
    const summary = summarizeOrders(orders);
    expect(summary.totalsByCurrency).toEqual({ usd: 500 });
    expect(summary.orderCount).toBe(1);
  });

  it('separates totals by currency', () => {
    const orders: OrderLike[] = [
      { kind: 'event_package', amount_total: 4900, currency: 'usd', status: 'paid' },
      { kind: 'event_package', amount_total: 4500, currency: 'eur', status: 'paid' },
    ];
    const summary = summarizeOrders(orders);
    expect(summary.totalsByCurrency).toEqual({ usd: 4900, eur: 4500 });
  });

  it('is case-insensitive on currency codes', () => {
    const orders: OrderLike[] = [
      { kind: 'credit_pack', amount_total: 100, currency: 'USD', status: 'paid' },
      { kind: 'credit_pack', amount_total: 200, currency: 'usd', status: 'paid' },
    ];
    expect(summarizeOrders(orders).totalsByCurrency).toEqual({ usd: 300 });
  });

  it('splits one-time (event_package + credit_pack) from subscription (pro_subscription)', () => {
    const orders: OrderLike[] = [
      { kind: 'event_package', amount_total: 4900, currency: 'usd', status: 'paid' },
      { kind: 'credit_pack', amount_total: 500, currency: 'usd', status: 'paid' },
      { kind: 'pro_subscription', amount_total: 7900, currency: 'usd', status: 'paid' },
    ];
    const summary = summarizeOrders(orders);
    expect(summary.oneTimeByCurrency).toEqual({ usd: 5400 });
    expect(summary.subscriptionByCurrency).toEqual({ usd: 7900 });
    expect(summary.totalsByCurrency).toEqual({ usd: 13300 });
    expect(summary.orderCount).toBe(3);
  });
});
