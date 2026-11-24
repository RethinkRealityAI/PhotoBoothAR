/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The inside of the brand photo shutter: purple glass core, a soft glowing
 * inner ring with the brand hues woven through it, and a liquid-glass sheen.
 * The look lives in src/styles/brand.css (`.bw-shutter`); each capture UI
 * keeps its own <button> (so it keeps its own press animation, handler and
 * label) and only adds the class and this face:
 *
 *   <motion.button className="bw-shutter" aria-label="Take photo">
 *     <ShutterFace />
 *   </motion.button>
 *
 * Size it with the `--bw-shutter-size` custom property (default 74px).
 */
export function ShutterFace() {
  return (
    <>
      <span aria-hidden className="bw-shutter__glass" />
      <span aria-hidden className="bw-shutter__core" />
      <span aria-hidden className="bw-shutter__halo" />
      <span aria-hidden className="bw-shutter__ring" />
      <span aria-hidden className="bw-shutter__sheen" />
    </>
  );
}

/** `style` for a shutter that is not the default 74px. */
export function shutterSize(px: number): React.CSSProperties {
  return { ['--bw-shutter-size' as string]: `${px}px` } as React.CSSProperties;
}
