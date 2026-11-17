/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE COVERAGE CONTRACT.
 *
 * Guides rot in exactly one way: somebody ships a new studio tab, a new
 * Power-Up or a new plan flag, and nothing anywhere notices that no guide
 * explains it. Six months later the guides describe a product that no longer
 * exists and a support ticket arrives instead.
 *
 * So every host-visible registry in the app is walked against GUIDE_COVERAGE
 * in BOTH directions here — a surface with no coverage fails, and coverage for
 * a surface that no longer exists fails too. Failure messages are written for
 * the developer who trips them: they name the guide file to extend and the map
 * to update, because a red test that only says "expected 9 to be 8" gets
 * deleted rather than fixed.
 *
 * The numbers the copy quotes out loud (GUIDE_COUNTS) are checked against the
 * modules that own them for the same reason: "up to 6 per scene" printed on a
 * public page is a promise, and MAX_TRIGGERS is the only thing that can keep it.
 *
 * NODE-SAFETY: every import below is a pure module with its own colocated node
 * test. src/lib/studio/featureHelp.ts is deliberately NOT imported at runtime —
 * it pulls lucide-react and .webm/.jpg assets, which a vitest node run cannot
 * load — so its topic list is mirrored as a local literal keyed on its own
 * exported TYPE (an `import type`, erased at transform), which means a fifth
 * help topic still breaks this file at compile time.
 */
import { describe, it, expect } from 'vitest';
import {
  FEATURE_KEYS,
  visibleHostNav,
  visibleStudioTabs,
  type FeatureSet,
} from './features';
import { ENTITLEMENTS } from './plans';
import { ADD_ONS } from './studio/addOns';
import { TRIGGER_SOURCES, type TriggerAction } from './studio/triggers';
import { MAX_OBJECTS, MAX_TRIGGERS } from './studio/state';
import { FRAME_LAYOUT_SPEC } from './assetPrompt';
import { MAX_ACTIONS } from './copilot';
import { CONTENT_PACKS, PACK_IDS } from './contentPacks';
import { GUIDES, GUIDE_COUNTS, GUIDE_COVERAGE, type GuideCoverageEntry } from './guidesContent';
import type { FeatureHelpTopic } from './studio/featureHelp';

/**
 * The in-studio "?" tutorial topics.
 *
 * Source of truth: `FeatureHelpTopic` / `FEATURE_HELP` in
 * src/lib/studio/featureHelp.ts. Only the TYPE is imported (see the node-safety
 * note above); keying this record on it makes a new topic a compile error here,
 * and the two-way assertion below turns that into an actionable message.
 */
const HELP_TOPICS: Record<FeatureHelpTopic, true> = {
  library: true,
  modes: true,
  director: true,
  triggers: true,
};

/**
 * The TriggerAction union has no runtime list to count (BURST_STYLES and
 * friends enumerate the styles WITHIN an action, not the actions), so this
 * record stands in for one. Keyed on the union: add a sixth action and this
 * file stops compiling until the guides admit it exists.
 */
const TRIGGER_ACTION_TYPES: Record<TriggerAction['type'], true> = {
  burst: true,
  reveal: true,
  filterPulse: true,
  beam: true,
  animate: true,
};

/** Highest tier, so every conditionally-visible tab (e.g. `cards`) appears. */
const TOP_TIER: FeatureSet = ENTITLEMENTS.deluxe;

const FIX = 'add real copy to src/lib/guidesContent.ts and map it in GUIDE_COVERAGE';

/** Both directions of one registry, with messages a developer can act on. */
function assertCovered(
  what: string,
  members: readonly string[],
  coverage: Record<string, GuideCoverageEntry>,
  mapPath: string,
) {
  for (const key of members) {
    expect(
      coverage[key],
      `${what} '${key}' has no guides coverage. A host-visible surface shipped without guides: ${FIX}.${mapPath}.`,
    ).toBeDefined();
  }
  for (const key of Object.keys(coverage)) {
    expect(
      members.includes(key),
      `${mapPath} still covers ${what} '${key}', which no longer exists in the app. Remove it, and check the guide copy that described it is not now describing a feature nobody has.`,
    ).toBe(true);
  }
}

describe('guides coverage — every host-visible surface is explained', () => {
  it('covers every studio tab', () => {
    assertCovered(
      'Studio tab',
      visibleStudioTabs(TOP_TIER),
      GUIDE_COVERAGE.studioTabs,
      'GUIDE_COVERAGE.studioTabs',
    );
  });

  it('covers every host nav destination', () => {
    assertCovered(
      'Host nav item',
      visibleHostNav(TOP_TIER),
      GUIDE_COVERAGE.hostNav,
      'GUIDE_COVERAGE.hostNav',
    );
  });

  it('covers every Power-Up', () => {
    assertCovered(
      'Power-Up',
      ADD_ONS.map((a) => a.id),
      GUIDE_COVERAGE.addOns,
      'GUIDE_COVERAGE.addOns',
    );
  });

  it('covers every in-studio help topic', () => {
    assertCovered(
      'Studio help topic',
      Object.keys(HELP_TOPICS),
      GUIDE_COVERAGE.helpTopics,
      'GUIDE_COVERAGE.helpTopics',
    );
  });

  it('covers every feature flag', () => {
    assertCovered(
      'Feature flag',
      FEATURE_KEYS,
      GUIDE_COVERAGE.featureKeys,
      'GUIDE_COVERAGE.featureKeys',
    );
  });

  it('points every coverage note at a guide that exists, and says where', () => {
    const groups = Object.entries(GUIDE_COVERAGE);
    for (const [group, map] of groups) {
      for (const [key, entry] of Object.entries(map)) {
        expect(
          GUIDES[entry.guide],
          `GUIDE_COVERAGE.${group}.${key} points at guide '${entry.guide}', which is not in GUIDES.`,
        ).toBeDefined();
        // The note is what makes the map maintainable — "yes" is not a note.
        expect(
          entry.note.length,
          `GUIDE_COVERAGE.${group}.${key} has no useful note. Say which section of '${entry.guide}' explains it.`,
        ).toBeGreaterThan(20);
      }
    }
  });
});

describe('guides counts — the numbers the copy says out loud', () => {
  it('matches the trigger registries', () => {
    expect(
      GUIDE_COUNTS.triggerSources,
      `The guides claim ${GUIDE_COUNTS.triggerSources} gesture cues but TRIGGER_SOURCES has ${TRIGGER_SOURCES.length} (src/lib/studio/triggers.ts). ${FIX}.`,
    ).toBe(TRIGGER_SOURCES.length);
    expect(
      GUIDE_COUNTS.triggerActions,
      `The guides claim ${GUIDE_COUNTS.triggerActions} trigger actions but the TriggerAction union has ${Object.keys(TRIGGER_ACTION_TYPES).length}. ${FIX}.`,
    ).toBe(Object.keys(TRIGGER_ACTION_TYPES).length);
  });

  it('matches the scene caps', () => {
    expect(
      GUIDE_COUNTS.maxObjects,
      `The guides claim a scene holds ${GUIDE_COUNTS.maxObjects} pieces but MAX_OBJECTS is ${MAX_OBJECTS} (src/lib/studio/state.ts). ${FIX}.`,
    ).toBe(MAX_OBJECTS);
    expect(
      GUIDE_COUNTS.maxTriggers,
      `The guides claim ${GUIDE_COUNTS.maxTriggers} Magic Triggers per scene but MAX_TRIGGERS is ${MAX_TRIGGERS} (src/lib/studio/state.ts). ${FIX}.`,
    ).toBe(MAX_TRIGGERS);
  });

  it('matches the frame archetypes offered by AI Frame Studio', () => {
    const real = Object.keys(FRAME_LAYOUT_SPEC).length;
    expect(
      GUIDE_COUNTS.frameArchetypes,
      `The guides list ${GUIDE_COUNTS.frameArchetypes} frame layouts but FRAME_LAYOUT_SPEC has ${real} (src/lib/assetPrompt.ts). ${FIX}.`,
    ).toBe(real);
  });

  it('matches the studio tab count and the Power-Up shelf', () => {
    const tabs = visibleStudioTabs(TOP_TIER).length;
    expect(
      GUIDE_COUNTS.studioTabs,
      `The guides say the studio has ${GUIDE_COUNTS.studioTabs} tabs but visibleStudioTabs returns ${tabs} at the top tier (src/lib/features.ts). ${FIX}.`,
    ).toBe(tabs);
    expect(
      GUIDE_COUNTS.powerUps,
      `The guides say there are ${GUIDE_COUNTS.powerUps} Power-Ups but ADD_ONS has ${ADD_ONS.length} (src/lib/studio/addOns.ts). ${FIX}.`,
    ).toBe(ADD_ONS.length);
  });

  it('matches the Copilot proposal cap and the starter packs', () => {
    expect(
      GUIDE_COUNTS.copilotMaxActions,
      `The guides say the Copilot proposes up to ${GUIDE_COUNTS.copilotMaxActions} changes at a time but MAX_ACTIONS is ${MAX_ACTIONS} (src/lib/copilot.ts). ${FIX}.`,
    ).toBe(MAX_ACTIONS);
    expect(
      GUIDE_COUNTS.starterPacks,
      `The guides describe ${GUIDE_COUNTS.starterPacks} starter packs but PACK_IDS has ${PACK_IDS.length} (src/lib/contentPacks.ts). ${FIX}.`,
    ).toBe(PACK_IDS.length);
    // "five ready-made photo missions" is printed for EVERY style, so every
    // pack must carry exactly that many — an average would let one pack lie.
    for (const id of PACK_IDS) {
      const n = CONTENT_PACKS[id].challenges.length;
      expect(
        n,
        `The guides promise ${GUIDE_COUNTS.starterPackMissions} missions in every starter pack but the "${id}" pack has ${n} (src/lib/contentPacks.ts). ${FIX}.`,
      ).toBe(GUIDE_COUNTS.starterPackMissions);
    }
  });

  it('quotes those numbers somewhere a reader can see them', () => {
    // A count kept in sync but never printed is dead weight; this is what makes
    // the checks above worth running.
    const printed = JSON.stringify(GUIDES);
    for (const n of [GUIDE_COUNTS.maxObjects, GUIDE_COUNTS.maxTriggers, GUIDE_COUNTS.triggerSources, GUIDE_COUNTS.copilotMaxActions]) {
      expect(printed.includes(String(n)), `no guide mentions the number ${n}`).toBe(true);
    }
  });
});
