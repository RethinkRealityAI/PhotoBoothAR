/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bulk upload entry — a large drag-and-drop area plus a "Choose files" button.
 * Accepts images and videos; rejects (with a gentle note) anything else or
 * files over the per-file size cap. Mirrors the upload pattern in admin/Assets.
 */
import { useCallback, useRef, useState, ChangeEvent, DragEvent } from 'react';
import { UploadCloud, ImagePlus, AlertCircle, Plus } from 'lucide-react';

export const MAX_FILES = 30;
export const MAX_FILE_MB = 50;
const ACCEPT = 'image/*,video/*';

interface Props {
  /** Number of items already added (to enforce MAX_FILES across drops). */
  count: number;
  onAdd: (files: File[]) => void;
  /** Compact variant for the "add more" button on later steps. */
  compact?: boolean;
  /** Tile variant — a full-size "add more" card that fills a grid cell. */
  tile?: boolean;
}

/** Split a FileList into accepted files + human-readable rejection reasons. */
export function triageFiles(
  files: File[],
  alreadyHave: number,
): { accepted: File[]; rejected: string[] } {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const f of files) {
    if (alreadyHave + accepted.length >= MAX_FILES) {
      rejected.push(`${f.name} — over the ${MAX_FILES}-file limit`);
      continue;
    }
    const isMedia = f.type.startsWith('image/') || f.type.startsWith('video/');
    if (!isMedia) {
      rejected.push(`${f.name} — not an image or video`);
      continue;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      rejected.push(`${f.name} — larger than ${MAX_FILE_MB} MB`);
      continue;
    }
    accepted.push(f);
  }
  return { accepted, rejected };
}

export default function UploadDropzone({ count, onAdd, compact = false, tile = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const handle = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      const { accepted, rejected } = triageFiles(Array.from(list), count);
      if (accepted.length) onAdd(accepted);

      const notes: string[] = [];
      if (rejected.length) {
        notes.push(
          `Skipped ${rejected.length} file${rejected.length === 1 ? '' : 's'}: ${rejected
            .slice(0, 3)
            .join('; ')}${rejected.length > 3 ? '…' : ''}`,
        );
      }
      // HEIC (iPhone) decodes in Safari but not most other browsers — warn softly.
      const hasHeic = accepted.some((f) => /heic|heif/i.test(f.type) || /\.heic|\.heif$/i.test(f.name));
      if (hasHeic && !/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
        notes.push('HEIC photos may not preview on this browser — Safari handles them best.');
      }
      setNote(notes.length ? notes.join(' ') : null);
    },
    [count, onAdd],
  );

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    handle(e.target.files);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handle(e.dataTransfer.files);
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      multiple
      className="sr-only"
      onChange={onInput}
    />
  );

  if (tile) {
    return (
      <>
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`w-full h-full flex flex-col items-center justify-center gap-2 rounded-xl transition-colors ${
            dragging ? 'bg-gold-400/10' : 'hover:bg-noir-800/40'
          }`}
        >
          <span className="w-10 h-10 rounded-full bg-foil/90 glow-accent flex items-center justify-center">
            <Plus className="w-5 h-5 text-noir-900" />
          </span>
          <span className="font-label uppercase tracking-luxe text-[8px] text-champagne/55">Add more</span>
        </button>
        {input}
      </>
    );
  }

  if (compact) {
    return (
      <>
        <button
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2.5 glass rounded-xl text-[10px] font-label uppercase tracking-luxe text-champagne/70 hover:text-gold-300 border border-gold-400/15 hover:border-gold-400/35 transition-colors"
        >
          <ImagePlus className="w-4 h-4" /> Add more
        </button>
        {input}
      </>
    );
  }

  return (
    <div className="w-full">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center text-center rounded-3xl border-2 border-dashed transition-all cursor-pointer px-8 py-16 ${
          dragging
            ? 'border-gold-400/70 bg-gold-400/10 scale-[1.01]'
            : 'border-gold-400/25 bg-noir-800/30 hover:border-gold-400/45 hover:bg-noir-800/50'
        }`}
      >
        <div className="w-16 h-16 mb-5 rounded-full bg-foil glow-accent flex items-center justify-center">
          <UploadCloud className="w-7 h-7 text-noir-900" />
        </div>
        <p className="font-serif italic text-2xl text-foil-static">
          Drag &amp; drop your photos here
        </p>
        <p className="mt-2 font-sans text-sm text-champagne/55 max-w-md">
          Or <span className="text-gold-300 underline underline-offset-2">choose files</span> to
          upload. Images &amp; videos welcome — add as many as you like.
        </p>
        <p className="mt-4 font-label uppercase tracking-luxe text-[8px] text-champagne/30">
          Up to {MAX_FILES} files · max {MAX_FILE_MB} MB each
        </p>
        {input}
      </div>

      {note && (
        <div className="mt-3 flex items-start gap-2 text-[11px] text-gold-200/80 bg-gold-400/10 border border-gold-400/20 rounded-xl px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}
