/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The deck environment both surfaces build — one place, so the hub's
 * presenter and /pitch can never disagree about what a deck asks for.
 *
 * North America: "Start free" (self-serve checkout; ?ref= carried to /signup).
 * Nigeria: clients are invoiced and there is no payment flow, so the ask is a
 * call / chat with the rep, and "See it live" (the landing demo) is secondary.
 *
 * Booking: a deck opened with ?ref=<code> whose rep has a LIVE booking page
 * (checked by the caller via 042's public RPC) asks "Book a call with <rep>" —
 * primary in Nigeria, secondary in North America (self-serve stays first).
 */
import { SALES_CONTACT } from '../../../lib/salesContent';
import { getOffer } from '../../../lib/salesOffers';
import { contactCta, withRef } from '../../../lib/salesHub';
import type { Market, Offer } from '../../../lib/salesTypes';
import type { DeckCta } from './Slides';

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? '';
}

export interface DeckBooking {
  /** Same-origin path, e.g. /book/jamesa. */
  href: string;
  repName: string;
}

export function asksFor(
  market: Market,
  ref: string,
  booking: DeckBooking | null = null,
): { primary: DeckCta; secondary?: DeckCta } {
  const contact = contactCta(SALES_CONTACT);
  const live: DeckCta = { href: '/', label: 'See it live', external: false };
  if (booking !== null) {
    const who = firstName(booking.repName);
    const book: DeckCta = { href: booking.href, label: who !== '' ? `Book a call with ${who}` : 'Book a call', external: false };
    if (market === 'ng') return { primary: book, secondary: live };
    return { primary: { href: withRef('/signup', ref), label: 'Start free', external: false }, secondary: book };
  }
  if (market === 'ng') {
    if (contact.href === '/') return { primary: live };
    const who = firstName(SALES_CONTACT.name);
    const label = contact.href.startsWith('mailto:') && who !== '' ? `Chat with ${who}` : contact.label;
    return { primary: { ...contact, label }, secondary: live };
  }
  const start: DeckCta = { href: withRef('/signup', ref), label: 'Start free', external: false };
  return { primary: start, secondary: contact.href === '/' ? live : contact };
}

export function offersFromIds(ids: readonly string[] | undefined): Offer[] {
  return (ids ?? []).map((id) => getOffer(id)).filter((o): o is Offer => o !== undefined);
}

/** "James Asumah · Director of Partnerships · james@…" (empty parts dropped). */
export function contactLine(): string {
  return [SALES_CONTACT.name, SALES_CONTACT.title, SALES_CONTACT.email].filter((s) => s.trim() !== '').join(' · ');
}
