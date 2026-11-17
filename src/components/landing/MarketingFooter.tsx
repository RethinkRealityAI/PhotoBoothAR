/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The public marketing chrome's footer, hoisted out of Landing.tsx unchanged
 * so every public page (landing, guides) closes the same way.
 *
 * `tagline` is the CMS-managed line Landing passes down; a page with no CMS
 * content of its own falls back to the same bundled default the landing page
 * renders before its fetch resolves. The contact entry stays a
 * ReportIssueButton, so the footer works on any surface that mounts it.
 */
import { Link } from 'react-router-dom';
import ReportIssueButton from '../support/ReportIssueButton';
import { DEFAULT_LANDING_CONTENT } from '../../lib/landingContent';

/** Standalone footer control: comfortable tap height without extra visual weight. */
const footerLinkClass =
  'inline-flex min-h-11 items-center rounded px-2 transition hover:text-brand-fg ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]';

export default function MarketingFooter({
  tagline = DEFAULT_LANDING_CONTENT.footerTagline,
}: {
  tagline?: string;
}) {
  return (
    <footer className="flex flex-col items-center gap-3 pb-6 pt-20 text-center">
      <span className="font-serif text-lg text-foil-static">Beamwall</span>
      <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">
        {tagline}
      </p>
      {/* The links carry their own vertical padding (min-h-11 ≈ 44px) rather
          than sitting at their 15px line box: they are standalone controls, not
          words inside a sentence, and at 10px type they were a hard target on a
          phone. `gap-2` keeps the visual rhythm now that each item is taller. */}
      <nav className="flex flex-wrap items-center justify-center gap-2 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">
        <Link to="/guides" className={footerLinkClass}>Guides</Link>
        <span className="text-brand-muted/25" aria-hidden>·</span>
        <Link to="/privacy" className={footerLinkClass}>Privacy</Link>
        <span className="text-brand-muted/25" aria-hidden>·</span>
        <Link to="/terms" className={footerLinkClass}>Terms</Link>
        <span className="text-brand-muted/25" aria-hidden>·</span>
        {/* The marketing surface had no contact route at all — see the note
            above the pricing bullets about claims we could not honour. */}
        <ReportIssueButton
          label="Contact"
          showIcon={false}
          prefill={{ source: 'landing' }}
          className={footerLinkClass}
        />
      </nav>
    </footer>
  );
}
