/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * homeAssetSources — what /admin/home-assets offers to pick from, as looks
 * the homepage can wear: the shared Studio library (admin-api
 * list_library_items rows), the props and frames bundled in public/, and the
 * page's built-in filters (`tint:`) and effects (`fx:`). Pure, tested in node.
 *
 * Kept apart from homeAssets.ts because it READS the page's bundled defaults
 * (lib/beamyAssets HOME_ASSET_DEFAULTS) at runtime: a bundled prop that the
 * homepage already wears is offered with the fit measured for it there, and a
 * new default row shows up here without a second list to update. homeAssets.ts
 * rides the classic landing page's bundle, so it must not pull that in.
 */
import { HOME_ASSET_DEFAULTS, type HomeLook, type LookCategory } from './beamyAssets';
import {
  FX_IDS, guessAnchor, lookUrlKind, normalizeLook, normalizeLooks, presetFit, resolveAssetUrl,
  HERO_CATEGORIES, LOOK_CATEGORIES, HERO_LOOKS_MAX, AR_LOOKS_MAX, type AnchorId,
} from './homeAssets';

/** The fields of an admin-api `list_library_items` row this module reads. */
export interface LibraryItemLike {
  id: string;
  name: string;
  kind: string;
  assetUrl: string | null;
  thumbnailUrl: string | null;
  modelUrl?: string | null;
}

/** The homepage category a library item lands in by default. */
export function categoryForLibraryKind(kind: string): LookCategory {
  if (kind === 'border') return 'frame';
  if (kind === '3d_attachment') return 'prop';
  if (kind === 'shader') return 'filter';
  return 'effect'; // 2d_filter (stickers), composite scenes
}

/** A fit for a prop file: the page's own when it already wears that file, else a guess from its name. */
export function fitForProp(url: string, name: string, anchor?: AnchorId) {
  if (anchor !== undefined) return presetFit(anchor);
  const known = [...HOME_ASSET_DEFAULTS.arLooks, ...HOME_ASSET_DEFAULTS.heroLooks].find((l) => l.category === 'prop' && l.url === url && l.fit !== undefined);
  if (known?.fit !== undefined) return { ...known.fit, at: [known.fit.at[0], known.fit.at[1], known.fit.at[2]] as [number, number, number] };
  return presetFit(guessAnchor(`${url} ${name}`));
}

/**
 * A library item as a homepage look, or null when it has no usable media for
 * the category. A prop takes the item's GLB (its own, or a scene's first 3D
 * layer); a filter or effect with no image of its own shows its thumbnail,
 * the "after" shot of the look.
 */
export function lookFromLibraryItem(item: LibraryItemLike, category: LookCategory = categoryForLibraryKind(item.kind)): HomeLook | null {
  const thumb = resolveAssetUrl(item.thumbnailUrl, 'image');
  const candidates =
    category === 'prop' ? [item.modelUrl, item.assetUrl]
      : category === 'frame' ? [item.assetUrl]
        : [item.assetUrl, item.thumbnailUrl];
  const url = candidates.find((c) => lookUrlKind(c, category) !== undefined && lookUrlKind(c, category) !== 'builtin');
  if (url == null) return null;
  return normalizeLook({
    id: `lib-${item.id.slice(0, 8)}-${item.name}`,
    name: item.name,
    category,
    url,
    thumb: thumb ?? (category === 'frame' ? url : undefined),
    ...(category === 'prop' ? { fit: fitForProp(url, item.name) } : {}),
  });
}

/** A file shipped in public/, offered beside the library. */
export interface BuiltinAsset {
  name: string;
  category: 'prop' | 'frame';
  url: string;
  thumb: string;
}

/** Every bundled prop GLB (public/models/props/<file>.glb, its .webp beside it). */
const BUNDLED_PROPS: Array<[string, string]> = [
  ['aviator-glasses', 'Aviators'], ['beamy-face-paint', 'Butterfly face paint'], ['beamy-masquerade', 'Gold masquerade'],
  ['elf-ears', 'Elf ears'], ['elf-hat', 'Elf hat'], ['emerald-necklace', 'Emerald necklace'], ['garnet-earrings', 'Garnet earrings'],
  ['gold-crown', 'Gold crown'], ['halo-ring', 'Halo'], ['holly-crown', 'Holly crown'], ['neon-shades', 'Neon shades'],
  ['queens-tiara', 'Tiara'], ['reindeer-antlers', 'Reindeer antlers'], ['royal-crown', 'Royal crown'], ['rudolph-nose', 'Rudolph nose'],
  ['santa-beard', 'Santa beard'], ['santa-hat', 'Santa hat'], ['snowflake-tiara', 'Snowflake tiara'], ['top-hat', 'Top hat'],
  ['tree-hat', 'Christmas tree hat'],
];
/** Every bundled frame (public/guides/frames/<file>.png, thumb/<file>.webp). */
const BUNDLED_FRAMES: Array<[string, string]> = [
  ['birthday-character-hands', 'Birthday hands'], ['birthday-monogram-corner', 'Birthday monogram'],
  ['christmas-elf-hands', 'Elf hands'], ['christmas-santa-cover', 'Holiday cover'], ['corporate-badge-mask', 'Corporate badge'],
  ['cultural-asoebi-arch', 'Aso ebi arch'], ['cultural-mehndi-arch', 'Sangeet arch'], ['gala-artdeco-mask', 'Art deco'],
  ['gala-magazine-cover', 'Gala cover'], ['launch-product-side', 'Product launch'], ['nye-countdown', 'New Year countdown'],
  ['wedding-arch-mask', 'Wedding arch'], ['wedding-magazine-cover', 'Wedding cover'], ['wedding-monogram-drop', 'Wedding monogram'],
];

const PROP_DIR = '/models/props/';
const FRAME_DIR = '/guides/frames/';

/** The files the page's defaults wear that are not in the lists above (a new default shows up here by itself). */
function defaultFiles(category: 'prop' | 'frame'): BuiltinAsset[] {
  const out: BuiltinAsset[] = [];
  for (const l of [...HOME_ASSET_DEFAULTS.heroLooks, ...HOME_ASSET_DEFAULTS.arLooks]) {
    const urls = category === 'prop' ? [l.category === 'prop' ? l.url : undefined, l.with] : [l.category === 'frame' ? l.url : undefined];
    for (const u of urls) {
      if (u === undefined || resolveAssetUrl(u, category === 'prop' ? 'model' : 'image') === undefined) continue;
      const name = l.category === category ? l.name : (u.split('/').pop() ?? u).replace(/\.\w+$/, '').replace(/-/g, ' ');
      const i = u.lastIndexOf('/');
      const thumb = category === 'prop' ? u.replace(/\.glb$/, '.webp') : `${u.slice(0, i)}/thumb/${u.slice(i + 1).replace(/\.png$/, '.webp')}`;
      out.push({ name, category, url: u, thumb });
    }
  }
  return out;
}

function uniqueByUrl(list: BuiltinAsset[]): BuiltinAsset[] {
  const seen = new Set<string>();
  return list.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
}

export const BUILTIN_ASSETS: BuiltinAsset[] = uniqueByUrl([
  ...BUNDLED_PROPS.map(([f, name]) => ({ name, category: 'prop' as const, url: `${PROP_DIR}${f}.glb`, thumb: `${PROP_DIR}${f}.webp` })),
  ...defaultFiles('prop'),
  ...BUNDLED_FRAMES.map(([f, name]) => ({ name, category: 'frame' as const, url: `${FRAME_DIR}${f}.png`, thumb: `${FRAME_DIR}thumb/${f}.webp` })),
  ...defaultFiles('frame'),
]);

const FX_NAMES: Record<string, string> = { sparkles: 'Sparkle burst', snow: 'Snowfall', confetti: 'Confetti', hearts: 'Hearts', notes: 'Music notes', spotlight: 'Stage lights' };

/** The page's built-in filters (its default tints) and every effect it can draw. */
export const BUILTIN_EFFECT_LOOKS: HomeLook[] = [
  ...HOME_ASSET_DEFAULTS.arLooks.filter((l) => l.category === 'filter' && l.url.startsWith('tint:')),
  ...FX_IDS.map((fx): HomeLook => {
    const own = HOME_ASSET_DEFAULTS.arLooks.find((l) => l.category === 'effect' && l.url === `fx:${fx}`);
    return own ?? { id: `ar-${fx}`, name: FX_NAMES[fx] ?? fx, category: 'effect', url: `fx:${fx}` };
  }),
];

/** A bundled file as a homepage look (a prop gets the page's own fit, else a guess). */
export function lookFromBuiltin(a: BuiltinAsset): HomeLook | null {
  const known = HOME_ASSET_DEFAULTS.arLooks.find((l) => l.category === a.category && l.url === a.url);
  return normalizeLook({
    id: `builtin-${a.name}`,
    name: a.name,
    category: a.category,
    url: a.url,
    thumb: a.thumb,
    ...(a.category === 'prop' ? { fit: fitForProp(a.url, a.name) } : {}),
    ...(a.category === 'frame' && known !== undefined ? { opening: known.opening, occasion: known.occasion } : {}),
  });
}

/** The page's bundled lists as editable overrides: what "Customize" starts from. */
export function editableDefaults(): { heroLooks: HomeLook[]; arLooks: HomeLook[] } {
  return {
    heroLooks: normalizeLooks(HOME_ASSET_DEFAULTS.heroLooks, HERO_CATEGORIES, HERO_LOOKS_MAX),
    arLooks: normalizeLooks(HOME_ASSET_DEFAULTS.arLooks, LOOK_CATEGORIES, AR_LOOKS_MAX),
  };
}
