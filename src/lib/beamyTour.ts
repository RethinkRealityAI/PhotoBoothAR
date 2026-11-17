/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Beamy's guided tour (/beamy) — pure data, no React, no supabase.
 *
 * Who we sell to (the "What applies to you?" picker) and, for each audience,
 * the lines Beamy says on every stop of the tour plus the real platform assets
 * that stop shows (a /try demo kit for the booth, a library 3D prop for the
 * reveal). The page reads this file and nothing else for copy, so a test can
 * hold the copy to the service model: Beamwall is FULLY REMOTE and done for
 * you. Nothing here may promise staff, setup crews or anyone at the venue.
 */

export type AudienceId = 'planner' | 'family' | 'organizer' | 'business' | 'team';

/** The tour's stops, in order. */
export type TourStop = 'intro' | 'snap' | 'prop' | 'deliver' | 'go';

export const TOUR_STOPS: TourStop[] = ['intro', 'snap', 'prop', 'deliver', 'go'];

/** Short label for the progress rail. */
export const STOP_LABELS: Record<TourStop, string> = {
  intro: 'For you',
  snap: 'Snap & beam',
  prop: '3D magic',
  deliver: 'How it works',
  go: 'Start',
};

export interface BeamyProp {
  /** Library GLB, same origin. */
  url: string;
  name: string;
}

export interface Audience {
  id: AudienceId;
  /** Card title in the picker. */
  title: string;
  /** One line under the title. */
  hint: string;
  emoji: string;
  /** Accent for the card glow and chips. */
  hue: string;
  /** /try demo kit id (lib/demoKits). null = the landing's default beam kit. */
  kit: string | null;
  prop: BeamyProp;
  /** What Beamy says on each stop. */
  lines: Record<TourStop, string>;
  /** The intro stop's "what you get" chips. */
  gets: string[];
}

const crown: BeamyProp = { url: '/models/props/royal-crown.glb', name: 'Royal crown' };
const tiara: BeamyProp = { url: '/models/props/queens-tiara.glb', name: 'Tiara' };
const santa: BeamyProp = { url: '/models/props/santa-hat.glb', name: 'Santa hat' };
const halo: BeamyProp = { url: '/models/props/halo-ring.glb', name: 'Halo' };
const shades: BeamyProp = { url: '/models/props/neon-shades.glb', name: 'Neon shades' };

export const AUDIENCES: Audience[] = [
  {
    id: 'planner',
    title: 'Event planner',
    hint: 'Weddings, galas, agency clients',
    emoji: '📋',
    hue: '#D4AF37',
    kit: 'wedding',
    prop: tiara,
    gets: ['A booth branded for each client', 'Live wall for any screen', 'Keepsake cards', 'Built for you, ready in days'],
    lines: {
      intro: 'Planners are my favourite! Tell us about your client and we build their whole booth for you, remotely. You just send one link.',
      snap: 'Here is what your clients’ guests get. Snap a photo and I will beam it onto the wall!',
      prop: 'Want a little extra sparkle? I can put 3D pieces right on every guest’s head.',
      deliver: 'Your part is tiny. Watch, I will show you the three steps.',
      go: 'Ready to wow your next client? Let’s build their booth.',
    },
  },
  {
    id: 'family',
    title: 'Family celebration',
    hint: 'Weddings, birthdays, anniversaries',
    emoji: '🎂',
    hue: '#F2A7B8',
    kit: 'party',
    prop: crown,
    gets: ['Guests use their own phones', 'Every photo on one live wall', 'A keepsake album after', 'No app, no hardware'],
    lines: {
      intro: 'A party! Your guests scan one QR code and the booth opens on their own phones. No app, no equipment to rent.',
      snap: 'Go on, take one! I will beam it straight onto the party wall.',
      prop: 'Birthday royalty needs a crown. Watch this!',
      deliver: 'You don’t have to design a thing. Here is how it goes.',
      go: 'Let’s make your celebration the one everyone remembers!',
    },
  },
  {
    id: 'organizer',
    title: 'Community organizer',
    hint: 'Reunions, clubs, fundraisers',
    emoji: '🤝',
    hue: '#34D399',
    kit: 'party',
    prop: halo,
    gets: ['One link for everyone', 'Photo challenges that get people mingling', 'A live wall for the room', 'Free to start'],
    lines: {
      intro: 'Bringing people together? I love that. One link gets your whole crowd snapping and sharing on one wall.',
      snap: 'Here is the booth your crowd will use. Snap away and I will beam it up!',
      prop: 'Add a little fun people actually wear. Ta-da!',
      deliver: 'You run the event. We handle the booth. Here is how.',
      go: 'Let’s get your crowd beaming!',
    },
  },
  {
    id: 'business',
    title: 'Business or brand',
    hint: 'Launches, activations, conferences',
    emoji: '🚀',
    hue: '#5B8CFF',
    kit: null,
    prop: shades,
    gets: ['Your brand on every photo', 'Live wall for the stage screen', 'Guest emails, with consent', 'Custom 3D for your brand'],
    lines: {
      intro: 'Let’s put your brand in every guest’s camera roll. We build the booth around your brand and hand you the link.',
      snap: 'This is your booth. Every shot carries your brand, then I beam it to the wall!',
      prop: 'We can even make 3D pieces in your brand. Like these!',
      deliver: 'Fully done for you. Here is the whole process.',
      go: 'Let’s build your brand’s booth!',
    },
  },
  {
    id: 'team',
    title: 'Company team',
    hint: 'Holiday parties, offsites, staff events',
    emoji: '🎄',
    hue: '#E5484D',
    kit: 'christmas',
    prop: santa,
    gets: ['Ready-made holiday looks', 'Team photo challenges', 'A live wall for the office screen', 'Set up in minutes'],
    lines: {
      intro: 'Team party time! Pick a holiday look, share one QR code and watch the whole office light up the wall.',
      snap: 'Try the holiday booth. Snap it and I will beam it to the office wall!',
      prop: 'Ho ho ho! Every guest can wear one of these.',
      deliver: 'No IT tickets, no setup. Here is how it works.',
      go: 'Let’s make this year’s party the best one yet!',
    },
  },
];

export function audienceById(id: string | null | undefined): Audience | null {
  return AUDIENCES.find((a) => a.id === id) ?? null;
}

/** The "How it works" cards Beamy walks to and taps, in order. */
export const DELIVER_STEPS: { title: string; body: string; emoji: string }[] = [
  { emoji: '💬', title: 'Tell us about it', body: 'Your event, your colours, your vibe. A quick form or a short call.' },
  { emoji: '✨', title: 'We build it for you', body: 'Frames, 3D filters, challenges, the live wall and keepsakes. All done remotely.' },
  { emoji: '🔗', title: 'You get one link', body: 'Share the link or QR code. Guests open the booth on their own phones.' },
];

/** Opening lines, before an audience is picked. */
export const GREETING = 'Hi! I’m Beamy. I turn every guest’s phone into a photo booth and beam their shots onto a live wall. Who are you planning for?';

/** Things Beamy says when poked. */
export const POKE_LINES = ['Hee hee, that tickles!', 'Boop!', 'Need a hand? Pick a card!', 'I’m made of light, you know.', 'Again! Again!'];
