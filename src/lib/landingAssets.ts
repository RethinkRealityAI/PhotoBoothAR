/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Landing-page imagery — Higgsfield-generated art for the marketing page.
 *
 * NOTE: these point at Higgsfield's generation CDN rather than repo-local
 * assets — this sandbox's egress policy blocks downloading the bytes in
 * (d8j0ntlcm91z4.cloudfront.net is denied by the proxy). Swap each constant
 * for an `import ... from '../assets/landing/*.png'` once the files can be
 * pulled into the repo. Every consumer has an onError fallback, so a dead
 * URL degrades gracefully instead of showing a broken image.
 */

const CDN = 'https://d8j0ntlcm91z4.cloudfront.net/user_33Txeg6YsaHeKOwmprAOf8Wr55B';

/** Editorial portrait — person with AR glasses in beam lighting (has bg). */
export const HERO_BOOTH_PORTRAIT = `${CDN}/hf_20260707_041724_7bedd98a-8eb8-4bc2-bf02-7fea18093449.png`;

/** Beam-wall venue scene — glowing frames in a dark hall (has bg). */
export const WALL_SCENE = `${CDN}/hf_20260707_041725_a17613f5-4843-4613-a2a9-e8cdb0c2f74e.png`;

/** Woman taking an AR selfie, sparkles around her phone (transparent bg). */
export const BOOTH_CUTOUT = `${CDN}/hf_20260707_200737_943986c8-dd10-470e-aaa6-111d201c44b8.png`;

/** Glowing glass trophy (transparent bg). */
export const TROPHY_CUTOUT = `${CDN}/hf_20260707_200738_85934f0a-016b-4485-8a6e-ad7e46c05f16.png`;

/** Elegant glowing greeting card (transparent bg). */
export const CARD_CUTOUT = `${CDN}/hf_20260707_200740_8776f1f4-bf55-491d-81da-68ead729e647.png`;

/** Floating cluster of multi-color glass frames (transparent bg). */
export const FRAME_CLUSTER_CUTOUT = `${CDN}/hf_20260707_200741_752e6d84-455f-4237-a676-27983748494a.png`;
