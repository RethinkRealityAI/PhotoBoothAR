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
 * hold the copy to the service model: Beamwall is self-serve and FULLY
 * REMOTE (we can also build an event for you, remotely). Nothing here may
 * promise staff, setup crews or anyone at the venue, and nothing may carry an
 * emoji (icons are lucide-react names the page maps to line icons).
 */

export type AudienceId = 'planner' | 'family' | 'organizer' | 'business' | 'team';

/** Icon names the page maps to lucide-react components. */
export type AudienceIcon = 'ClipboardList' | 'Cake' | 'Users' | 'Briefcase' | 'Gift';

/** The tour's stops, in order. */
export type TourStop = 'intro' | 'snap' | 'prop' | 'deliver' | 'go';

export const TOUR_STOPS: TourStop[] = ['intro', 'snap', 'prop', 'deliver', 'go'];

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
  /** lucide-react icon name for the card's icon tile (no emoji anywhere). */
  icon: AudienceIcon;
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
    icon: 'ClipboardList',
    hue: '#D4AF37',
    kit: 'wedding',
    prop: tiara,
    gets: ['A booth branded for each client', 'Live wall for any screen', 'Digital keepsake cards', 'Built for you, ready in days'],
    lines: {
      intro: 'Planners are my favourite! A booth for every client, ready in minutes.',
      snap: 'This is what your clients’ guests get. Snap one and I’ll beam it to the wall!',
      prop: 'A little extra sparkle, right on every guest’s head.',
      deliver: 'Your part is tiny. Three steps.',
      go: 'Ready to wow your next client? Let’s build their booth.',
    },
  },
  {
    id: 'family',
    title: 'Family celebration',
    hint: 'Weddings, birthdays, anniversaries',
    icon: 'Cake',
    hue: '#F2A7B8',
    kit: 'party',
    prop: crown,
    gets: ['Guests use their own phones', 'Every photo on one live wall', 'A digital album after', 'No app, no hardware'],
    lines: {
      intro: 'A party! Guests scan one QR code and the booth opens on their phones.',
      snap: 'Go on, take one! I’ll beam it straight onto the party wall.',
      prop: 'Birthday royalty needs a crown. Watch this!',
      deliver: 'No design skills needed. Here’s how it goes.',
      go: 'Let’s make your celebration the one everyone remembers!',
    },
  },
  {
    id: 'organizer',
    title: 'Community organizer',
    hint: 'Reunions, clubs, fundraisers',
    icon: 'Users',
    hue: '#34D399',
    kit: 'party',
    prop: halo,
    gets: ['One link for everyone', 'Photo challenges that get people mingling', 'A live wall for the room', 'Free to start'],
    lines: {
      intro: 'Bringing people together? One link gets your whole crowd on one wall.',
      snap: 'This is the booth your crowd will use. Snap away and I’ll beam it up!',
      prop: 'Add a little fun people actually wear. Ta-da!',
      deliver: 'You run the event. The booth runs itself.',
      go: 'Let’s get your crowd beaming!',
    },
  },
  {
    id: 'business',
    title: 'Business or brand',
    hint: 'Launches, activations, conferences',
    icon: 'Briefcase',
    hue: '#5B8CFF',
    kit: null,
    prop: shades,
    gets: ['Your brand on every photo', 'Live wall for the stage screen', 'Guest emails, with consent', 'Custom 3D for your brand'],
    lines: {
      intro: 'Let’s put your brand in every guest’s camera roll.',
      snap: 'Every shot carries your brand. Snap one and I’ll beam it to the wall!',
      prop: 'Real 3D pieces your guests wear. Like these!',
      deliver: 'Live in minutes. Here’s the whole process.',
      go: 'Let’s build your brand’s booth!',
    },
  },
  {
    id: 'team',
    title: 'Company team',
    hint: 'Holiday parties, offsites',
    icon: 'Gift',
    hue: '#E5484D',
    kit: 'christmas',
    prop: santa,
    gets: ['Ready-made holiday looks', 'Team photo challenges', 'A live wall for the office screen', 'Set up in minutes'],
    lines: {
      intro: 'Team party time! Pick a holiday look and share one QR code.',
      snap: 'Try the holiday booth. Snap it and I’ll beam it to the office wall!',
      prop: 'Ho ho ho! Every guest can wear one of these.',
      deliver: 'No IT tickets, no setup. Here’s how.',
      go: 'Let’s make this year’s party the best one yet!',
    },
  },
];

export function audienceById(id: string | null | undefined): Audience | null {
  return AUDIENCES.find((a) => a.id === id) ?? null;
}

/** lucide-react icon names for the "How it works" steps. */
export type StepIcon = 'CalendarPlus' | 'Palette' | 'Link2';

/** "How it works", written for the self-serve host making a quick event. */
export const DELIVER_STEPS: { title: string; body: string; icon: StepIcon }[] = [
  { icon: 'CalendarPlus', title: 'Create your event', body: 'Name it, pick a date. Takes a minute.' },
  { icon: 'Palette', title: 'Pick a look', body: 'Frames, effects and 3D pieces, ready to go.' },
  { icon: 'Link2', title: 'Share one link', body: 'Guests scan a QR code and the booth opens on their phones.' },
];

/** The "we can do it for you" line under the steps. Remote, always. */
export const DONE_FOR_YOU = 'Short on time? We can build it for you, remotely.';

/** Opening line on the intro, and the line before an audience is picked. */
export const HELLO = 'Hi, I’m Beamy!';
export const GREETING = 'Who are you planning for? Pick one and I’ll tailor the tour.';

/** Things Beamy says when poked, from a single poke up to a streak. */
export const POKE_LINES = ['Boop!', 'Hee hee, that tickles!', 'I’m made of light, you know.', 'Again! Again!', 'Okay, okay, dance break!'];
