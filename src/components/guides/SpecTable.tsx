/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The spec card: label · value · why.
 *
 * The third column is the reason this is a component rather than a list. "1080
 * × 1920" tells a host nothing; "the shape of a phone held upright" tells them
 * whether they got it right. On phones the three columns stack into one block
 * per row so nothing is squeezed into a 90px column.
 */
export default function SpecTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; why: string }[];
}) {
  return (
    <section data-guide-block="spec" data-reveal="up" className="w-full">
      <h3 className="mb-4 font-serif text-2xl text-brand-fg">{title}</h3>
      <div className="liquid-glass overflow-hidden rounded-2xl">
        <dl className="divide-y divide-white/5">
          {rows.map((r) => (
            <div
              key={r.label}
              className="grid gap-1.5 px-5 py-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,12rem)_1fr] sm:items-baseline sm:gap-5"
            >
              <dt className="font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/80">
                {r.label}
              </dt>
              <dd className="text-sm font-semibold text-brand-fg">{r.value}</dd>
              <dd className="text-sm leading-relaxed text-brand-muted">{r.why}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
