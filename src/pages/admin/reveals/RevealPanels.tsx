/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The reveal editor's five panels, one per tab: Template · Email · Beamy ·
 * Reveal · Send. Each edits a slice of the ONE RevealDoc (revealModel), so
 * the email, the page and this editor can never disagree.
 */
import { useRef, useState } from 'react';
import {
  Check, Copy, Download, ExternalLink, ImagePlus, Loader2, RotateCcw, Trash2, Upload, X,
} from 'lucide-react';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import {
  CAPS, OCCASION_META, REVEAL_OCCASIONS, REVEAL_THEMES, REVEAL_UNLOCKS, TAPS_MAX, TAPS_MIN, THEME_PALETTES,
  UNLOCK_META, presetDoc, withUnlock, type BeamyLines, type RevealDoc, type RevealOccasion,
} from '../../../lib/reveals/revealModel';
import {
  IMAGE_ACCEPT, NAME_MAX, STATUS_META, imageUploadError, imageUrlError, isUntouched, linkError, slugError,
  typedSlug, type RevealStatus,
} from '../../../lib/reveals/revealEditor';
import { Group, TextField, ThemeSwatch } from './fields';

export type SetDoc = (fn: (d: RevealDoc) => RevealDoc) => void;

/* ── Template ─────────────────────────────────────────────────────── */

export function TemplatePanel({ doc, setDoc }: { doc: RevealDoc; setDoc: SetDoc }) {
  const [confirm, setConfirm] = useState<RevealOccasion | null>(null);
  const pick = (o: RevealOccasion) => {
    if (o === doc.occasion && isUntouched(doc)) return;
    if (isUntouched(doc)) setDoc(() => presetDoc(o));
    else setConfirm(o);
  };
  return (
    <>
      <Group title="Occasion" hint="Each one starts with its own words, colour and unlock. You can change everything after.">
        <div className="grid sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="Occasion">
          {REVEAL_OCCASIONS.map((id) => {
            const o = OCCASION_META[id];
            const on = doc.occasion === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={on} className="wz-choice !items-start !py-3" onClick={() => pick(id)}>
                <ThemeSwatch palette={THEME_PALETTES[o.theme]} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold text-white">{o.label}</span>
                  <span className="block mt-0.5 text-[12.5px] leading-snug text-white/70">{o.blurb}</span>
                  <span className="block mt-1.5 text-[12px] text-white/55">{UNLOCK_META[o.unlock].label}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Group>
      <Group title="Colour" hint="The night sky behind Beamy, in the email and on the page.">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5" role="radiogroup" aria-label="Colour">
          {REVEAL_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={doc.theme === t}
              className="wz-tile"
              onClick={() => setDoc((d) => ({ ...d, theme: t }))}
            >
              <ThemeSwatch palette={THEME_PALETTES[t]} />
              <span className="wz-tile-name">{THEME_PALETTES[t].label}</span>
            </button>
          ))}
        </div>
      </Group>
      {confirm !== null && (
        <ConfirmModal
          title={`Start from ${OCCASION_META[confirm].label}?`}
          body="This replaces your words, colour, unlock and Beamy’s lines with that template’s. The name and link stay."
          confirmLabel="Use this template"
          onConfirm={() => { setDoc(() => presetDoc(confirm)); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

/* ── Email ────────────────────────────────────────────────────────── */

export function EmailPanel({ doc, setDoc }: { doc: RevealDoc; setDoc: SetDoc }) {
  const preset = OCCASION_META[doc.occasion].email;
  const set = (k: keyof RevealDoc['email']) => (v: string) => setDoc((d) => ({ ...d, email: { ...d.email, [k]: v } }));
  const e = doc.email;
  return (
    <>
      <Group title="In the inbox">
        <TextField id="em-subject" label="Subject" value={e.subject} cap={CAPS.subject} onChange={set('subject')} placeholder={preset.subject} />
        <TextField id="em-pre" label="Preview text" value={e.preheader} cap={CAPS.preheader} onChange={set('preheader')} placeholder={preset.preheader} hint="Shown after the subject in most inboxes, hidden in the email itself." />
      </Group>
      <Group title="The email">
        <TextField id="em-kicker" label="Kicker" value={e.kicker} cap={CAPS.kicker} onChange={set('kicker')} placeholder={preset.kicker} />
        <TextField id="em-head" label="Headline" value={e.headline} cap={CAPS.headline} onChange={set('headline')} placeholder={preset.headline} />
        <TextField id="em-body" label="Message" value={e.body} cap={CAPS.body} onChange={set('body')} multiline rows={4} placeholder={preset.body} />
        <TextField id="em-cta" label="Button" value={e.ctaLabel} cap={CAPS.ctaLabel} onChange={set('ctaLabel')} placeholder={preset.ctaLabel} hint="The big glowing button. It opens the reveal page." />
        <TextField id="em-foot" label="Small print under the button" value={e.footnote} cap={CAPS.footnote} onChange={set('footnote')} placeholder={preset.footnote} />
      </Group>
    </>
  );
}

/* ── Beamy ────────────────────────────────────────────────────────── */

const LINE_FIELDS: { key: keyof BeamyLines; label: string; hint: string }[] = [
  { key: 'greeting', label: 'When the page opens', hint: 'Beamy’s first words.' },
  { key: 'hint', label: 'The instruction', hint: 'Also the hint under him. Say what to do.' },
  { key: 'cheer', label: 'Part-way there', hint: 'Said while the reader is unlocking.' },
  { key: 'unlocked', label: 'The moment it opens', hint: 'The pay-off line.' },
];

export function BeamyPanel({ doc, setDoc }: { doc: RevealDoc; setDoc: SetDoc }) {
  const defaults = UNLOCK_META[doc.unlock].lines;
  const custom = LINE_FIELDS.some((f) => doc.beamy[f.key] !== defaults[f.key]);
  return (
    <>
      <Group title="How it unlocks" hint="What the reader does to open the news.">
        <div className="grid sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="Unlock">
          {REVEAL_UNLOCKS.map((id) => {
            const u = UNLOCK_META[id];
            return (
              <button key={id} type="button" role="radio" aria-checked={doc.unlock === id} className="wz-choice !items-start !py-3" onClick={() => setDoc((d) => withUnlock(d, id))}>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[14.5px] font-semibold text-white">{u.label}</span>
                    <span className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[12px] text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]">{u.gesture}</span>
                  </span>
                  <span className="block mt-1 text-[12.5px] leading-snug text-white/70">{u.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        {doc.unlock === 'tap' && (
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="bm-taps" className="wz-label !mb-1.5">Taps to unlock</label>
              <span className="text-[14px] font-semibold tabular-nums">{doc.taps}</span>
            </div>
            <input
              id="bm-taps"
              type="range"
              min={TAPS_MIN}
              max={TAPS_MAX}
              step={1}
              value={doc.taps}
              className="w-full min-h-11 accent-white"
              onChange={(e) => setDoc((d) => ({ ...d, taps: Number(e.target.value) }))}
            />
          </div>
        )}
      </Group>
      <Group
        title="Beamy’s lines"
        hint={custom ? 'You have written your own lines. They stay when you switch the unlock.' : 'These follow the unlock you pick until you change them.'}
      >
        {LINE_FIELDS.map((f) => (
          <TextField
            key={f.key}
            id={`bm-${f.key}`}
            label={f.label}
            value={doc.beamy[f.key]}
            cap={CAPS.line}
            placeholder={defaults[f.key]}
            onChange={(v) => setDoc((d) => ({ ...d, beamy: { ...d.beamy, [f.key]: v } }))}
            hint={f.key === 'cheer' && doc.unlock === 'tap' ? <>Write <code className="text-white">{'{left}'}</code> where the taps still to go should appear, e.g. “{'{left}'} more!”.</> : f.hint}
          />
        ))}
        {custom && (
          <button
            type="button"
            className="pressable self-start inline-flex items-center gap-1.5 min-h-11 rounded-full px-1 text-[13.5px] font-medium text-white underline underline-offset-4"
            onClick={() => setDoc((d) => ({ ...d, beamy: { ...UNLOCK_META[d.unlock].lines } }))}
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> Reset to Beamy’s lines
          </button>
        )}
      </Group>
    </>
  );
}

/* ── Reveal ───────────────────────────────────────────────────────── */

export function RevealPanel({ doc, setDoc, onUpload }: {
  doc: RevealDoc;
  setDoc: SetDoc;
  /** Uploads to the public assets bucket; resolves to its https URL, or null. */
  onUpload: (file: File) => Promise<string | null>;
}) {
  const preset = OCCASION_META[doc.occasion];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const setT = (k: keyof RevealDoc['teaser']) => (v: string) => setDoc((d) => ({ ...d, teaser: { ...d.teaser, [k]: v } }));
  const setR = (k: keyof RevealDoc['reveal']) => (v: string) => setDoc((d) => ({ ...d, reveal: { ...d.reveal, [k]: v } }));
  const r = doc.reveal;
  const imgErr = imageUrlError(r.imageUrl);
  const lnkErr = linkError(r.ctaUrl);
  const halfButton = (r.ctaLabel.trim() === '') !== (r.ctaUrl.trim() === '');

  const upload = async (file: File) => {
    const why = imageUploadError(file);
    if (why) { setUploadError(why); return; }
    setUploading(true);
    setUploadError(null);
    const url = await onUpload(file);
    setUploading(false);
    if (url === null) { setUploadError('That image didn’t upload. Check your connection and try again.'); return; }
    setR('imageUrl')(url);
  };

  return (
    <>
      <Group title="Before it opens" hint="On the sealed page, above Beamy.">
        <TextField id="rv-tkicker" label="Kicker" value={doc.teaser.kicker} cap={CAPS.kicker} onChange={setT('kicker')} placeholder={preset.teaser.kicker} />
        <TextField id="rv-thead" label="Headline" value={doc.teaser.headline} cap={CAPS.headline} onChange={setT('headline')} placeholder={preset.teaser.headline} />
      </Group>
      <Group title="The news" hint="What the reader sees once it unlocks.">
        <TextField id="rv-eyebrow" label="Eyebrow" value={r.eyebrow} cap={CAPS.eyebrow} onChange={setR('eyebrow')} placeholder={preset.reveal.eyebrow} />
        <TextField id="rv-title" label="Title" value={r.title} cap={CAPS.title} onChange={setR('title')} placeholder={preset.reveal.title} />
        <TextField id="rv-body" label="Message" value={r.body} cap={CAPS.revealBody} onChange={setR('body')} multiline rows={5} placeholder={preset.reveal.body} />
      </Group>
      <Group title="Image" hint="Optional. Shown in the reveal card. JPG, PNG, WebP or GIF up to 5 MB.">
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }}
        />
        <div className="flex items-center gap-3">
          {r.imageUrl !== '' && imgErr === null ? (
            <img src={r.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-[12px] object-cover shadow-[0_0_0_1px_rgba(255,255,255,0.25)]" />
          ) : (
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[12px] bg-white/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]">
              <ImagePlus className="h-6 w-6 text-white/60" aria-hidden />
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="pressable liquid-glass-raised inline-flex items-center gap-2 rounded-full px-4 min-h-11 text-[14px] font-medium disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
              {uploading ? 'Uploading…' : r.imageUrl ? 'Replace image' : 'Upload image'}
            </button>
            {r.imageUrl !== '' && (
              <button type="button" onClick={() => setR('imageUrl')('')} className="pressable inline-flex items-center gap-1.5 rounded-full px-3 min-h-11 text-[14px] text-white/85 hover:text-white">
                <X className="h-4 w-4" aria-hidden /> Remove
              </button>
            )}
          </div>
        </div>
        {uploadError && <p role="alert" className="text-[13px] text-[#FFD2DA]">{uploadError}</p>}
        <TextField id="rv-img" label="Or paste an image link" value={r.imageUrl} cap={CAPS.url} onChange={setR('imageUrl')} inputMode="url" placeholder="https://" error={imgErr} />
      </Group>
      <Group title="Button" hint="Optional. Leave both empty for no button.">
        <TextField id="rv-cta" label="Button label" value={r.ctaLabel} cap={CAPS.ctaLabel} onChange={setR('ctaLabel')} placeholder={preset.reveal.ctaLabel || 'Try it now'} />
        <TextField
          id="rv-url"
          label="Button link"
          value={r.ctaUrl}
          cap={CAPS.url}
          onChange={setR('ctaUrl')}
          inputMode="url"
          placeholder="https://… or /pricing"
          error={lnkErr}
          hint={lnkErr === null && halfButton ? 'The button shows only with both a label and a link.' : 'A full https:// link, or a page on this site starting with /.'}
        />
      </Group>
    </>
  );
}

/* ── Send ─────────────────────────────────────────────────────────── */

export interface SendPanelProps {
  name: string;
  onName: (v: string) => void;
  slug: string;
  onSlug: (v: string) => void;
  /** A slug the database refused as taken. */
  takenSlug: string | null;
  /** The slug the public link uses now (the last one saved). */
  savedSlug: string;
  publicUrl: string;
  status: RevealStatus;
  publishedAt: string | null;
  busy: 'publish' | 'unpublish' | 'delete' | null;
  actionError: string | null;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  subject: string;
  preheader: string;
  onCopyHtml: () => Promise<boolean>;
  onDownloadHtml: () => void;
}

function useFlash(): [string | null, (k: string) => void] {
  const [k, setK] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  return [k, (next: string) => {
    setK(next);
    if (t.current !== null) clearTimeout(t.current);
    t.current = setTimeout(() => setK(null), 2000);
  }];
}

const STATUS_TONE: Record<RevealStatus, string> = {
  live: 'bg-[#5FD9A8] text-[#0B3B2C]',
  changes: 'bg-[#FFE3A8] text-[#3B2A06]',
  draft: 'bg-white/15 text-white',
};

export function StatusChip({ status }: { status: RevealStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap ${STATUS_TONE[status]}`}>
      {STATUS_META[status].label}
    </span>
  );
}

const btn = 'pressable liquid-glass-raised inline-flex items-center justify-center gap-2 rounded-full px-4 min-h-11 text-[14px] font-medium disabled:opacity-55';

export function SendPanel(p: SendPanelProps) {
  const [flash, setFlash] = useFlash();
  const [confirm, setConfirm] = useState<'unpublish' | 'delete' | null>(null);
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  const sErr = slugError(p.slug, p.takenSlug);
  const slugPending = p.slug.trim() !== p.savedSlug && sErr === null;

  const copy = async (what: 'link' | 'html') => {
    setCopyFailed(null);
    let ok = false;
    if (what === 'html') ok = await p.onCopyHtml();
    else {
      try { await navigator.clipboard.writeText(p.publicUrl); ok = true; } catch { ok = false; }
    }
    if (ok) setFlash(what);
    else setCopyFailed(what === 'html' ? 'Couldn’t copy. Use Download .html instead.' : 'Couldn’t copy. Select the link and copy it by hand.');
  };

  return (
    <>
      <Group title="Name and link">
        <TextField id="sd-name" label="Name (only you see this)" value={p.name} cap={NAME_MAX} onChange={p.onName} placeholder="Untitled reveal" error={p.name.trim() === '' ? 'Give it a name.' : null} />
        <TextField
          id="sd-slug"
          label="Link"
          prefix="/reveal/"
          value={p.slug}
          cap={60}
          onChange={(v) => p.onSlug(typedSlug(v))}
          error={sErr}
          hint={sErr === null ? (slugPending ? 'Saving the new link…' : 'Changing it after the email goes out breaks the old link.') : undefined}
        />
        <div>
          <p className="wz-label !mb-1.5">Public link</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 basis-[220px] truncate rounded-[14px] bg-[rgba(15,13,51,0.3)] px-3 py-2.5 text-[13px] text-white/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]">{p.publicUrl}</code>
            <button type="button" className={btn} onClick={() => void copy('link')}>
              {flash === 'link' ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              {flash === 'link' ? 'Copied' : 'Copy'}
            </button>
            <a className={btn} href={p.publicUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden /> Open
            </a>
          </div>
          {p.status === 'draft' && <p className="mt-1.5 text-[12.5px] text-white/60">Not live yet: this link shows nothing until you publish.</p>}
        </div>
      </Group>

      <Group title="Go live">
        <div className="rounded-[18px] bg-white/[0.06] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
          <div className="flex items-center gap-2.5">
            <StatusChip status={p.status} />
            {p.publishedAt && p.status !== 'draft' && (
              <span className="text-[12.5px] text-white/60">Published {new Date(p.publishedAt).toLocaleString()}</span>
            )}
          </div>
          <p className="mt-2 text-[13.5px] text-white/80">{STATUS_META[p.status].blurb}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {p.status !== 'live' && (
              <button type="button" disabled={p.busy !== null} onClick={p.onPublish} className="pressable bg-foil inline-flex items-center gap-2 rounded-full px-5 min-h-11 text-[14px] font-semibold disabled:opacity-55">
                {p.busy === 'publish' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
                {p.status === 'draft' ? 'Publish' : 'Update live'}
              </button>
            )}
            {p.status !== 'draft' && (
              <button type="button" disabled={p.busy !== null} onClick={() => setConfirm('unpublish')} className={btn}>
                {p.busy === 'unpublish' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
                Unpublish
              </button>
            )}
          </div>
          {p.actionError && <p role="alert" className="mt-2 text-[13px] text-[#FFD2DA]">{p.actionError}</p>}
        </div>
      </Group>

      <Group title="The email" hint="Sending to a list happens in Resend: paste or upload this HTML into a broadcast. Nothing is sent from here.">
        <div className="rounded-[18px] bg-white p-3.5 text-[#1A1740] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.6)]" aria-label="How it looks in an inbox">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#2A2A8C] text-[13px] font-bold text-white" aria-hidden>B</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">Beamwall</p>
              <p className="truncate text-[13.5px]"><span className="font-semibold">{p.subject}</span>{p.preheader && <span className="text-[#5A5880]"> · {p.preheader}</span>}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => void copy('html')}>
            {flash === 'html' ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {flash === 'html' ? 'Copied' : 'Copy email HTML'}
          </button>
          <button type="button" className={btn} onClick={p.onDownloadHtml}>
            <Download className="h-4 w-4" aria-hidden /> Download .html
          </button>
        </div>
        {copyFailed && <p role="alert" className="text-[13px] text-[#FFD2DA]">{copyFailed}</p>}
        {slugPending || p.status === 'draft' ? (
          <p className="text-[12.5px] text-white/60">The email’s button points at the public link above{p.status === 'draft' ? ': publish before you send it.' : '.'}</p>
        ) : null}
      </Group>

      <Group title="Delete">
        <button type="button" disabled={p.busy !== null} onClick={() => setConfirm('delete')} className="pressable self-start inline-flex items-center gap-2 rounded-full px-4 min-h-11 text-[14px] font-medium text-[#FFD2DA] bg-[rgba(255,120,140,0.12)] hover:bg-[rgba(255,120,140,0.22)] disabled:opacity-55">
          {p.busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
          Delete reveal
        </button>
      </Group>

      {confirm === 'unpublish' && (
        <ConfirmModal
          title="Unpublish this reveal?"
          body="Anyone who opens the link, including from an email already sent, will see nothing. Your draft stays, and you can publish again."
          confirmLabel="Unpublish"
          onConfirm={() => { setConfirm(null); p.onUnpublish(); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmModal
          tone="danger"
          title="Delete this reveal?"
          body="The draft and the live page are removed for good, and the link stops working, including in emails already sent."
          confirmLabel="Delete"
          onConfirm={() => { setConfirm(null); p.onDelete(); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
