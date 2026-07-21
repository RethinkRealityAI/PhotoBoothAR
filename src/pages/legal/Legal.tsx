/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Privacy Policy + Terms of Service, rendered by one component keyed on `doc`.
 * Platform surface (outside EventProvider) — uses the semantic app tokens.
 *
 * NOTE: these are honest, plain-English drafts tailored to what Beamwall
 * actually does; the operating entity, contact address and governing law are
 * sensible defaults and should be confirmed with counsel before public launch.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { usePageTitle } from '../../lib/usePageTitle';

/** Confirm these before launch. */
const OPERATOR = 'Beamwall, operated by RethinkReality';
const CONTACT = 'dapo@rethinkreality.ai';
const UPDATED = 'July 15, 2026';

interface Section {
  heading: string;
  body: string[];
}

const PRIVACY: Section[] = [
  {
    heading: 'The short version',
    body: [
      'Beamwall lets event hosts run an AR photo booth and a live photo wall. We collect the little we need to run that service — an account for hosts, and the photos, videos and messages guests choose to share at an event. We don’t sell your data, and the camera runs in your browser: your live camera feed is processed on your own device and is never uploaded unless you capture and share a photo or video.',
    ],
  },
  {
    heading: 'Who we are',
    body: [
      `This service is provided by ${OPERATOR} (“Beamwall”, “we”, “us”). If you have any question about this policy or your data, contact us at ${CONTACT}.`,
    ],
  },
  {
    heading: 'What we collect',
    body: [
      'Host accounts: your name, email address, and the password or Google sign-in you use to log in, plus the events, settings and designs you create.',
      'Event content: when a guest captures a photo or video, records a guestbook message, or signs a card, that content — and any caption or name they add — is stored so it can appear on the event wall and in the host’s gallery.',
      'Payments: if you purchase a plan or credits, payment is handled by Stripe. We receive confirmation and billing metadata (amount, plan, status) but never your full card number.',
      'Technical data: basic logs and device/browser information needed to operate and secure the service.',
      'Camera: the live camera preview and face tracking that power the AR effects run entirely in your browser on your device. Frames are only sent anywhere when you deliberately capture and submit a photo or video.',
    ],
  },
  {
    heading: 'How we use it',
    body: [
      'To provide the service — run booths and walls, show captures to the room, render keepsake cards, and give hosts their gallery and controls.',
      'To process payments, prevent abuse, and keep accounts and events secure.',
      'To support you when you contact us, and to improve the product.',
      'We do not sell your personal information, and we do not use guests’ event photos to train AI models.',
    ],
  },
  {
    heading: 'Who we share it with',
    body: [
      'Service providers who process data on our behalf under contract: Supabase (authentication, database and media storage), Stripe (payments), and the AI providers that generate optional frames, images and 3D props when a host uses those studio features. These providers may only use the data to provide their service to us.',
      'At an event, captures and messages a guest submits are shown publicly on that event’s wall by design, and are visible to the event’s host and staff.',
      'We may disclose information if required by law, or to protect the rights and safety of our users and the service.',
    ],
  },
  {
    heading: 'Retention & your choices',
    body: [
      'Event content is retained for the host’s event and account; hosts can moderate and remove captures, and can request deletion of an event’s data by contacting us.',
      'Hosts can update their account details or ask us to delete their account. Guests who want a capture removed should ask the event host or contact us.',
      `To exercise any data right — access, correction or deletion — email ${CONTACT}.`,
    ],
  },
  {
    heading: 'Cookies & local storage',
    body: [
      'We use essential cookies and browser local storage to keep you signed in and remember your preferences. We do not use third-party advertising trackers.',
    ],
  },
  {
    heading: 'Children',
    body: [
      'Beamwall is intended for adults running and attending events. It is not directed to children under 13, and we do not knowingly collect their personal information.',
    ],
  },
  {
    heading: 'Changes',
    body: [
      'We may update this policy as the product evolves. Material changes will be reflected here with a new “last updated” date.',
    ],
  },
];

const TERMS: Section[] = [
  {
    heading: 'Agreement',
    body: [
      `These Terms govern your use of Beamwall. By creating an account or using the service, you agree to them. If you don’t agree, please don’t use Beamwall. The service is operated by ${OPERATOR}.`,
    ],
  },
  {
    heading: 'Your account',
    body: [
      'You’re responsible for your account, for keeping your credentials secure, and for the activity that happens under it. Provide accurate information and keep it current.',
    ],
  },
  {
    heading: 'Acceptable use',
    body: [
      'Use Beamwall lawfully and respectfully. Don’t upload content that is illegal, infringing, hateful, harassing, or that violates others’ privacy; don’t attempt to break, overload, or reverse-engineer the service; and don’t use it to collect data about people without a lawful basis.',
      'As a host, you’re responsible for your event and its guests’ content — including obtaining any consents your jurisdiction requires for capturing and displaying photos and videos of attendees — and for moderating what appears on your wall.',
    ],
  },
  {
    heading: 'Your content',
    body: [
      'You and your guests keep ownership of the photos, videos, messages and designs you create. You grant Beamwall the limited licence needed to host, process and display that content to operate the service for you (for example, showing a capture on your event wall and in your gallery).',
    ],
  },
  {
    heading: 'Plans, payments & refunds',
    body: [
      'Paid plans, event packages and credits are billed through Stripe at the prices shown at checkout. Credits and event features are consumed as described at purchase. Because events are time-bound, fees are generally non-refundable except where required by law or expressly stated. Taxes may apply.',
    ],
  },
  {
    heading: 'Availability & changes',
    body: [
      'We work to keep Beamwall reliable but provide it “as is” and “as available”, without warranties. We may add, change or remove features, and we’ll aim to give reasonable notice of significant changes.',
    ],
  },
  {
    heading: 'Limitation of liability',
    body: [
      'To the fullest extent permitted by law, Beamwall is not liable for indirect, incidental, or consequential damages, or for loss of data or content. Our total liability for any claim relating to the service is limited to the amount you paid us for it in the three months before the claim.',
    ],
  },
  {
    heading: 'Termination',
    body: [
      'You can stop using Beamwall and close your account at any time. We may suspend or terminate access for breach of these Terms or to protect the service and its users.',
    ],
  },
  {
    heading: 'Contact',
    body: [
      `Questions about these Terms? Email ${CONTACT}.`,
    ],
  },
];

export default function Legal({ doc }: { doc: 'privacy' | 'terms' }) {
  const isPrivacy = doc === 'privacy';
  usePageTitle(isPrivacy ? 'Privacy — Beamwall' : 'Terms — Beamwall');
  const title = isPrivacy ? 'Privacy Policy' : 'Terms of Service';
  const sections = isPrivacy ? PRIVACY : TERMS;
  return (
    <div className="h-full w-full app-bg overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 transition hover:text-brand-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Beamwall
        </Link>

        <h1 className="mt-8 font-serif text-4xl text-foil-static">{title}</h1>
        <p className="mt-2 font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">
          Last updated {UPDATED}
        </p>

        <div className="mt-10 flex flex-col gap-9">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="font-serif text-xl text-brand-fg">{s.heading}</h2>
              <div className="mt-3 flex flex-col gap-3">
                {s.body.map((p, i) => (
                  <p key={i} className="text-[15px] leading-relaxed text-brand-muted/80">
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-14 flex items-center gap-4 border-t border-white/10 pt-6 text-sm">
          <Link to={isPrivacy ? '/terms' : '/privacy'} className="text-accent underline-offset-4 hover:underline">
            {isPrivacy ? 'Terms of Service' : 'Privacy Policy'}
          </Link>
          <span className="text-brand-muted/30">·</span>
          <a href={`mailto:${CONTACT}`} className="text-accent underline-offset-4 hover:underline">
            Contact us
          </a>
        </div>
      </div>
    </div>
  );
}
