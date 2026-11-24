/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guards the sales hub content. The load-bearing ones are the prospect gates:
 * publicDeck() must strip every speaker note and publicOfferPrice() must never
 * leak an unconfirmed price — and a Nigeria deck must never push the USD
 * self-serve checkout tiers (NG clients are invoiced).
 */
import { describe, expect, it } from 'vitest';
import {
  CHEAT_SHEET,
  DAILY_ROUTINE,
  DAILY_TARGETS,
  DECKS,
  DELIVERY_SOP,
  DISCOVERY_QUESTIONS,
  OBJECTIONS,
  RESEARCH_NOTES,
  SALES_CONTACT,
  SLIDE_IMAGE_KEYS,
  SOURCING,
  TEMPLATES,
  THIRTY_DAY_PLAN,
  fillTemplate,
  getDeck,
  publicDeck,
  publicOfferPrice,
} from './salesContent';
import { OFFERS, SELF_SERVE_OFFER_IDS, getOffer, offersFor } from './salesOffers';
import { ICP_IDS, MARKETS, TEMPLATE_TOKENS, type Offer } from './salesTypes';

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const tokensIn = (s: string) => [...s.matchAll(TOKEN_RE)].map((m) => m[1]);

describe('decks', () => {
  it('has six decks: every ICP in both markets, NG first', () => {
    expect(DECKS).toHaveLength(6);
    for (const m of MARKETS) {
      expect(DECKS.filter((d) => d.market === m.id).map((d) => d.id).sort()).toEqual([...ICP_IDS].sort());
    }
    expect(DECKS.slice(0, 3).every((d) => d.market === 'ng')).toBe(true);
  });

  it('uses the agreed unique slugs and getDeck resolves each', () => {
    const slugs = DECKS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const d of DECKS) {
      expect(d.slug).toBe(d.market === 'ng' ? `ng-${d.id}` : d.id);
      expect(getDeck(d.slug)).toBe(d);
    }
    expect(getDeck('nope')).toBeUndefined();
  });

  it('each deck has 8–12 slides, starts with cover, ends with cta, has offer + roi', () => {
    for (const d of DECKS) {
      expect(d.slides.length, d.slug).toBeGreaterThanOrEqual(8);
      expect(d.slides.length, d.slug).toBeLessThanOrEqual(12);
      expect(d.slides[0].kind).toBe('cover');
      expect(d.slides[d.slides.length - 1].kind).toBe('cta');
      expect(d.slides.some((s) => s.kind === 'offer' && (s.offerIds?.length ?? 0) > 0), d.slug).toBe(true);
      expect(d.slides.some((s) => s.kind === 'roi'), d.slug).toBe(true);
      const ids = d.slides.map((s) => s.id);
      expect(new Set(ids).size, d.slug).toBe(ids.length);
    }
  });

  it('every slide has speaker notes', () => {
    for (const d of DECKS) for (const s of d.slides) expect(s.notes?.trim(), `${d.slug}/${s.id}`).toBeTruthy();
  });

  it('every offerIds entry resolves to an offer in the deck’s own market', () => {
    for (const d of DECKS) {
      for (const s of d.slides) {
        for (const id of s.offerIds ?? []) {
          const o = getOffer(id);
          expect(o, `${d.slug}/${s.id} → ${id}`).toBeDefined();
          expect(o?.market, `${d.slug} → ${id}`).toBe(d.market);
        }
      }
    }
  });

  it('Nigeria decks never reference a self-serve checkout tier', () => {
    for (const d of DECKS.filter((x) => x.market === 'ng')) {
      for (const s of d.slides) {
        for (const id of s.offerIds ?? []) expect(SELF_SERVE_OFFER_IDS).not.toContain(id);
        const text = [s.title, s.body ?? '', ...(s.bullets ?? [])].join(' ');
        expect(text, `${d.slug}/${s.id}`).not.toMatch(/\$\d/);
      }
    }
  });

  it('every slide image key is in the allowed list', () => {
    const allowed = new Set<string>(SLIDE_IMAGE_KEYS);
    for (const d of DECKS) for (const s of d.slides) if (s.image !== undefined) expect(allowed.has(s.image), `${d.slug}/${s.id}: ${s.image}`).toBe(true);
  });

  it('every stat on a slide has a source', () => {
    for (const d of DECKS) for (const s of d.slides) for (const st of s.stats ?? []) expect(st.source?.trim(), `${d.slug}/${s.id}: ${st.value}`).toBeTruthy();
  });

  it('keeps copy punchy: titles ≤ 8 words, body ≤ 25, bullets ≤ 10', () => {
    for (const d of DECKS) {
      for (const s of d.slides) {
        expect(words(s.title), `${d.slug}/${s.id} title`).toBeLessThanOrEqual(8);
        if (s.body !== undefined) expect(words(s.body), `${d.slug}/${s.id} body`).toBeLessThanOrEqual(25);
        for (const b of s.bullets ?? []) expect(words(b), `${d.slug}/${s.id} bullet: ${b}`).toBeLessThanOrEqual(10);
      }
    }
  });

  it('prospect-facing copy carries no scarcity language and no guarantees', () => {
    for (const d of DECKS) {
      const text = JSON.stringify(publicDeck(d)).toLowerCase();
      expect(text, d.slug).not.toMatch(/limited (spots|slots|places)|only \d+ (spots|slots)|small group|guarantee/);
    }
    for (const o of OFFERS) expect(JSON.stringify(o).toLowerCase(), o.id).not.toMatch(/guarantee|\blimited (spots|slots|places|time)/);
  });

  it('prospect-facing copy speaks in Looks, never "filters"', () => {
    for (const d of DECKS) expect(JSON.stringify(publicDeck(d)).toLowerCase(), d.slug).not.toMatch(/\bfilters?\b/);
    for (const o of OFFERS) expect(JSON.stringify(o).toLowerCase(), o.id).not.toMatch(/\bfilters?\b/);
  });

  it('every deck shows what guests can try on (a looks slide)', () => {
    for (const d of DECKS) expect(d.slides.some((s) => s.kind === 'looks'), d.slug).toBe(true);
  });
});

describe('publicDeck', () => {
  it('strips ALL notes deeply and blanks audience', () => {
    for (const d of DECKS) {
      const p = publicDeck(d);
      expect(p.audience).toBe('');
      expect(JSON.stringify(p)).not.toContain('"notes"');
      for (const s of p.slides) expect('notes' in s).toBe(false);
      expect(p.slides).toHaveLength(d.slides.length);
      expect(p.market).toBe(d.market);
      expect(p.slug).toBe(d.slug);
    }
  });

  it('does not mutate the input and shares no nested references', () => {
    const d = DECKS[0];
    const before = JSON.stringify(d);
    const p = publicDeck(d);
    expect(JSON.stringify(d)).toBe(before);
    expect(d.slides[0].notes).toBeTruthy();
    const withBullets = p.slides.findIndex((s) => s.bullets);
    p.slides[withBullets].bullets!.push('mutated');
    expect(d.slides[withBullets].bullets).not.toContain('mutated');
    const withStats = p.slides.findIndex((s) => s.stats);
    p.slides[withStats].stats![0].value = 'x';
    expect(d.slides[withStats].stats![0].value).not.toBe('x');
  });
});

describe('offers', () => {
  it('ids are unique and every offer has a market + fallback', () => {
    const ids = OFFERS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of OFFERS) {
      expect(o.fallbackPrice.trim(), o.id).toBeTruthy();
      expect(['na', 'ng']).toContain(o.market);
    }
  });

  it('self-serve tiers are the real NA prices, confirmed', () => {
    const expected: Record<string, string> = { free: '$0', essentials: '$49', premium: '$99', deluxe: '$169' };
    for (const id of SELF_SERVE_OFFER_IDS) {
      const o = getOffer(id)!;
      expect(o.price).toBe(expected[id]);
      expect(o.placeholder).toBe(false);
      expect(o.market).toBe('na');
    }
  });

  it('approved sales-led prices are confirmed and priced in the right currency', () => {
    const expected: Record<string, string> = {
      'signature-150': '$495', 'signature-400': '$795', 'signature-custom': 'From $1,495',
      partner: '$499/month or $4,990/year',
      'ng-signature-300': '₦200,000', 'ng-signature-700': '₦350,000', 'ng-signature-custom': 'From ₦600,000',
      'ng-partner': '₦670,000/month',
    };
    for (const [id, price] of Object.entries(expected)) {
      const o = getOffer(id)!;
      expect(o, id).toBeDefined();
      expect(o.price, id).toBe(price);
      expect(o.placeholder, id).toBe(false);
    }
    for (const o of offersFor('ng')) expect(o.price, o.id).toContain('₦');
    for (const o of offersFor('na')) expect(o.price, o.id).not.toContain('₦');
  });

  it('Partner copy never promises white-label, partner branding or a resale tier', () => {
    for (const o of OFFERS.filter((x) => x.id.endsWith('partner'))) {
      const text = JSON.stringify(o).toLowerCase();
      expect(text, o.id).not.toMatch(/white.?label|your (own )?brand|resale|resell/);
      expect(o.blurb).toBe('A licence to build and run Beamwall experiences for your clients and set your own price.');
    }
  });

  it('publicOfferPrice hides placeholder prices', () => {
    for (const o of OFFERS) expect(publicOfferPrice(o), o.id).toBe(o.placeholder ? o.fallbackPrice : o.price);
    const fake: Offer = { ...getOffer('premium')!, id: 'fixture', placeholder: true, price: '$1,234', fallbackPrice: 'Tailored quote' };
    expect(publicOfferPrice(fake)).toBe('Tailored quote');
    expect(publicOfferPrice(fake)).not.toContain('1,234');
    expect(publicOfferPrice({ ...fake, placeholder: false })).toBe('$1,234');
  });
});

describe('templates', () => {
  it('has 18–26 templates with unique ids covering every channel', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(18);
    expect(TEMPLATES.length).toBeLessThanOrEqual(26);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const ch of ['whatsapp', 'instagram', 'linkedin', 'email', 'sms', 'call'] as const) {
      expect(TEMPLATES.some((t) => t.channel === ch), ch).toBe(true);
    }
    expect(TEMPLATES.filter((t) => t.channel === 'whatsapp' && t.market === 'ng').length).toBeGreaterThanOrEqual(5);
  });

  it('uses only allowed tokens (body and subject)', () => {
    const allowed = new Set<string>(TEMPLATE_TOKENS);
    for (const t of TEMPLATES) {
      for (const tok of [...tokensIn(t.body), ...tokensIn(t.subject ?? '')]) expect(allowed.has(tok), `${t.id}: ${tok}`).toBe(true);
    }
  });

  it('email templates have subjects of ≤ 7 words; others have none', () => {
    for (const t of TEMPLATES) {
      if (t.channel === 'email') {
        expect(t.subject?.trim(), t.id).toBeTruthy();
        expect(words(t.subject!), t.id).toBeLessThanOrEqual(7);
      } else {
        expect(t.subject, t.id).toBeUndefined();
      }
    }
  });

  it('DMs stay short (≤ 60 words) and first Instagram DMs carry no link', () => {
    for (const t of TEMPLATES) {
      if (['instagram', 'whatsapp', 'linkedin', 'sms'].includes(t.channel)) expect(words(t.body), t.id).toBeLessThanOrEqual(60);
      if (t.channel === 'instagram' && t.stage === 'opener') {
        expect(t.body, t.id).not.toContain('{{deckLink}}');
        expect(t.body, t.id).not.toMatch(/https?:\/\//);
      }
    }
  });

  it('includes a phone opener and a voicemail script', () => {
    expect(TEMPLATES.some((t) => t.channel === 'call' && t.stage === 'opener')).toBe(true);
    expect(TEMPLATES.some((t) => t.channel === 'call' && /voicemail/i.test(t.title))).toBe(true);
  });
});

describe('fillTemplate', () => {
  it('fills and trims known tokens', () => {
    expect(fillTemplate('Hi {{firstName}} at {{ company }}', { firstName: '  Ada ', company: 'Bloom' })).toBe('Hi Ada at Bloom');
  });

  it('marks missing, empty and unknown tokens as [token]', () => {
    expect(fillTemplate('{{firstName}}|{{company}}|{{bogus}}', { firstName: '   ' })).toBe('[firstName]|[company]|[bogus]');
  });

  it('is pure and leaves plain text alone', () => {
    const vars = { firstName: 'Ada' };
    expect(fillTemplate('no tokens', vars)).toBe('no tokens');
    expect(vars).toEqual({ firstName: 'Ada' });
  });

  it('a fully filled real template has no leftovers', () => {
    const all = Object.fromEntries(TEMPLATE_TOKENS.map((t) => [t, 'x']));
    for (const t of TEMPLATES) expect(fillTemplate(t.body, all), t.id).not.toMatch(/\{\{|\[[a-zA-Z]+\]/);
  });
});

describe('playbook', () => {
  it('every RESEARCH_NOTES url is https and every note has a claim + source', () => {
    expect(RESEARCH_NOTES.length).toBeGreaterThan(10);
    for (const n of RESEARCH_NOTES) {
      expect(new URL(n.url).protocol, n.url).toBe('https:');
      expect(n.claim.trim()).toBeTruthy();
      expect(n.source.trim()).toBeTruthy();
    }
  });

  it('DAILY_TARGETS counts are positive integers', () => {
    expect(DAILY_TARGETS.length).toBeGreaterThan(0);
    for (const t of DAILY_TARGETS) {
      expect(Number.isInteger(t.count), t.id).toBe(true);
      expect(t.count, t.id).toBeGreaterThan(0);
    }
  });

  it('THIRTY_DAY_PLAN weeks are 1..4 in order, each with tasks', () => {
    expect(THIRTY_DAY_PLAN.map((w) => w.week)).toEqual([1, 2, 3, 4]);
    for (const w of THIRTY_DAY_PLAN) expect(w.tasks.length).toBeGreaterThan(0);
  });

  it('has the required playbook sections and counts', () => {
    const ids = CHEAT_SHEET.map((s) => s.id);
    for (const id of ['positioning', 'elevator', 'hooks', 'different', 'qualify', 'demo', 'closing', 'follow-up', 'compliance', 'dont-promise']) expect(ids).toContain(id);
    const compliance = CHEAT_SHEET.find((s) => s.id === 'compliance')!.points.join(' ');
    for (const law of ['CASL', 'CAN-SPAM', 'GDPR', 'NDPA']) expect(compliance).toContain(law);
    expect(CHEAT_SHEET.find((s) => s.id === 'guarantees')?.title).toMatch(/pending/i);
    expect(OBJECTIONS.length).toBeGreaterThanOrEqual(10);
    expect(OBJECTIONS.length).toBeLessThanOrEqual(14);
    expect(DISCOVERY_QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(DISCOVERY_QUESTIONS.length).toBeLessThanOrEqual(10);
    expect(DAILY_ROUTINE.some((b) => /WAT/.test(b.detail))).toBe(true);
  });

  it('DELIVERY_SOP ids are unique and minutes are positive when present', () => {
    expect(DELIVERY_SOP.length).toBeGreaterThan(0);
    const ids = DELIVERY_SOP.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const st of DELIVERY_SOP) {
      expect(st.when.trim() && st.title.trim() && st.detail.trim(), st.id).toBeTruthy();
      if (st.minutes !== undefined) {
        expect(Number.isFinite(st.minutes), st.id).toBe(true);
        expect(st.minutes, st.id).toBeGreaterThan(0);
      }
    }
    expect(CHEAT_SHEET.some((s) => s.id === 'delivery-rules')).toBe(true);
  });

  it('never promises a recap page or unshipped Partner features in prospect copy', () => {
    for (const d of DECKS) expect(JSON.stringify(publicDeck(d)).toLowerCase(), d.slug).not.toMatch(/recap page|white.?label|resell|resale/);
  });

  it('sourcing covers every ICP in both markets', () => {
    for (const m of MARKETS) for (const icp of ICP_IDS) expect(SOURCING.some((s) => s.market === m.id && s.icp === icp), `${m.id}/${icp}`).toBe(true);
  });

  it('SALES_CONTACT is James with his Beamwall mailbox and no external booking URL', () => {
    expect(SALES_CONTACT).toEqual({ name: 'James Asumah', title: 'Director of Partnerships', email: 'james@beamwall.app', bookingUrl: '' });
  });
});
