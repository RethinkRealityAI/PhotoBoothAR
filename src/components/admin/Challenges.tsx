/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Challenges admin — full CRUD for gala engagement challenges.
 * Uses db.fetchChallenges / createChallenge / updateChallenge / deleteChallenge.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus, Pencil, Trash2, Check, X, RefreshCw,
  ChevronUp, ChevronDown, ToggleLeft, ToggleRight
} from 'lucide-react';
import EventBackground from '../ui/EventBackground';
import {
  fetchChallenges,
  createChallenge,
  updateChallenge,
  deleteChallenge,
} from '../../lib/db';
import type { Challenge } from '../../types';

/* ------------------------------------------------------------------ */
/* Inline edit form                                                      */
/* ------------------------------------------------------------------ */

interface EditFormProps {
  initial: Partial<Challenge>;
  onSave: (patch: Partial<Challenge>) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function EditForm({ initial, onSave, onCancel, saving }: EditFormProps) {
  const [emoji, setEmoji] = useState(initial.emoji ?? '✨');
  const [title, setTitle] = useState(initial.title ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [points, setPoints] = useState(String(initial.points ?? 10));
  const [active, setActive] = useState(initial.active ?? true);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pts = parseInt(points, 10);
    await onSave({
      emoji: emoji.trim() || '✨',
      title: title.trim(),
      description: description.trim() || null,
      points: isNaN(pts) ? 10 : pts,
      active,
    } as Partial<Challenge>);
  };

  const inputCls = 'w-full bg-white/5 border border-gold-400/20 focus:border-gold-400/60 rounded-xl px-3 py-2 text-sm text-ivory placeholder-white/20 outline-none transition-colors';

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4 glass rounded-2xl border border-gold-400/25 animate-rise-in">
      <div className="flex gap-2">
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          maxLength={4}
          placeholder="✨"
          className="w-16 text-center text-xl bg-white/5 border border-gold-400/20 focus:border-gold-400/60 rounded-xl py-2 outline-none transition-colors"
        />
        <input
          ref={titleRef}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Challenge title"
          className={`flex-1 ${inputCls}`}
        />
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className={`${inputCls} resize-none`}
      />
      <div className="flex gap-3 items-center">
        <div className="flex-1 flex items-center gap-2">
          <label className="font-label uppercase tracking-widest text-[9px] text-champagne/50 shrink-0">Points</label>
          <input
            type="number"
            min={1}
            max={9999}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="w-20 bg-white/5 border border-gold-400/20 focus:border-gold-400/60 rounded-xl px-3 py-1.5 text-sm text-ivory outline-none transition-colors text-center"
          />
        </div>
        <button
          type="button"
          onClick={() => setActive((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-label uppercase tracking-widest transition-colors ${
            active ? 'bg-emerald-500/20 text-emerald-400' : 'glass text-champagne/40'
          }`}
        >
          {active ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
          {active ? 'Active' : 'Inactive'}
        </button>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-foil text-noir-900 font-bold text-[11px] font-label uppercase tracking-widest rounded-xl glow-accent hover:scale-[1.02] transition-transform disabled:opacity-40"
        >
          <Check className="w-3.5 h-3.5" />
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 glass rounded-xl text-champagne/50 hover:text-ivory text-[11px] font-label uppercase tracking-widest transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Challenge row                                                         */
/* ------------------------------------------------------------------ */

interface RowProps {
  challenge: Challenge;
  index: number;
  total: number;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleActive: () => void;
  busy: boolean;
  confirmDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function ChallengeRow({
  challenge, index, total, onEdit, onDelete, onMove,
  onToggleActive, busy, confirmDelete, onConfirmDelete, onCancelDelete,
}: RowProps) {
  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-2xl border transition-all duration-200 ${
        challenge.active
          ? 'glass border-gold-400/20'
          : 'border-white/6 bg-noir-800/25 opacity-60'
      }`}
    >
      {/* Emoji */}
      <span className="text-2xl shrink-0 mt-0.5">{challenge.emoji}</span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-sans text-sm text-ivory font-medium leading-tight">{challenge.title}</p>
          <span className="font-label uppercase tracking-widest text-[8px] px-2 py-0.5 rounded-full bg-gold-400/15 text-gold-300">
            {challenge.points} pts
          </span>
          {!challenge.active && (
            <span className="font-label uppercase tracking-widest text-[8px] px-2 py-0.5 rounded-full bg-noir-700 text-champagne/30">
              Inactive
            </span>
          )}
        </div>
        {challenge.description && (
          <p className="font-sans text-[11px] text-champagne/50 mt-0.5 leading-relaxed line-clamp-2">
            {challenge.description}
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Reorder */}
        <div className="flex flex-col">
          <button
            onClick={() => onMove(-1)}
            disabled={busy || index === 0}
            className="p-1 text-champagne/30 hover:text-gold-300 disabled:opacity-20 transition-colors"
            title="Move up"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={busy || index === total - 1}
            className="p-1 text-champagne/30 hover:text-gold-300 disabled:opacity-20 transition-colors"
            title="Move down"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Active toggle */}
        <button
          onClick={onToggleActive}
          disabled={busy}
          title={challenge.active ? 'Deactivate' : 'Activate'}
          className={`p-1.5 rounded-lg transition-colors ${challenge.active ? 'text-emerald-400 bg-emerald-500/15 hover:bg-emerald-500/25' : 'text-champagne/30 glass hover:text-emerald-400'}`}
        >
          {challenge.active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
        </button>

        {/* Edit */}
        <button
          onClick={onEdit}
          disabled={busy}
          title="Edit"
          className="p-1.5 glass rounded-lg text-champagne/40 hover:text-gold-300 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>

        {/* Delete */}
        {confirmDelete ? (
          <div className="flex gap-0.5">
            <button
              onClick={onDelete}
              disabled={busy}
              className="p-1.5 rounded-lg bg-red-500/25 text-red-400 hover:bg-red-500/40 transition-colors"
              title="Confirm delete"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onCancelDelete}
              className="p-1.5 glass rounded-lg text-champagne/40 hover:text-ivory transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={onConfirmDelete}
            disabled={busy}
            title="Delete"
            className="p-1.5 glass rounded-lg text-champagne/30 hover:text-red-400 transition-colors disabled:opacity-30"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Challenges                                                       */
/* ------------------------------------------------------------------ */

export default function Challenges() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);   // null = none, 'new' = add form
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchChallenges();
    setChallenges(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Save new */
  const handleCreate = async (patch: Partial<Challenge>) => {
    setSavingId('new');
    const next = challenges.length > 0
      ? Math.max(...challenges.map((c) => c.sort_order)) + 1
      : 0;
    const created = await createChallenge({ ...patch, sort_order: next });
    if (created) {
      setChallenges((prev) => [...prev, created]);
      setEditingId(null);
    }
    setSavingId(null);
  };

  /* Save edit */
  const handleUpdate = async (id: string, patch: Partial<Challenge>) => {
    setSavingId(id);
    const ok = await updateChallenge(id, patch);
    if (ok) {
      setChallenges((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      setEditingId(null);
    }
    setSavingId(null);
  };

  /* Delete */
  const handleDelete = async (id: string) => {
    setSavingId(id);
    const ok = await deleteChallenge(id);
    if (ok) {
      setChallenges((prev) => prev.filter((c) => c.id !== id));
      setConfirmDeleteId(null);
    }
    setSavingId(null);
  };

  /* Toggle active */
  const handleToggleActive = async (c: Challenge) => {
    setSavingId(c.id);
    const ok = await updateChallenge(c.id, { active: !c.active });
    if (ok) setChallenges((prev) => prev.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)));
    setSavingId(null);
  };

  /* Reorder via sort_order */
  const handleMove = async (index: number, dir: -1 | 1) => {
    const next = [...challenges];
    const swapIndex = index + dir;
    if (swapIndex < 0 || swapIndex >= next.length) return;
    // Swap sort_order values
    const aOrder = next[index].sort_order;
    const bOrder = next[swapIndex].sort_order;
    const a = { ...next[index], sort_order: bOrder };
    const b = { ...next[swapIndex], sort_order: aOrder };
    next[index] = a;
    next[swapIndex] = b;
    // Sort by sort_order so display matches
    next.sort((x, y) => x.sort_order - y.sort_order || x.created_at.localeCompare(y.created_at));
    setChallenges(next);
    // Persist both
    await Promise.all([
      updateChallenge(a.id, { sort_order: a.sort_order }),
      updateChallenge(b.id, { sort_order: b.sort_order }),
    ]);
  };

  const active = challenges.filter((c) => c.active).length;

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar">
      <EventBackground density={24} />
      <div className="relative z-10 p-6 md:p-8 flex flex-col gap-6 max-w-2xl mx-auto">

        {/* Header */}
        <header className="flex items-center justify-between animate-rise-in">
          <div>
            <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40 mb-1">AR Studio</p>
            <h1 className="font-serif italic text-3xl text-foil-static">Challenges</h1>
            <p className="font-sans text-xs text-champagne/45 mt-1">
              {loading ? 'Loading…' : `${challenges.length} challenges · ${active} active`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="p-2 glass rounded-xl text-champagne/40 hover:text-gold-300 transition-colors disabled:opacity-30"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setEditingId((v) => (v === 'new' ? null : 'new'))}
              disabled={editingId === 'new'}
              className="flex items-center gap-2 px-4 py-2 bg-foil text-noir-900 font-bold text-xs font-label uppercase tracking-widest rounded-xl glow-accent hover:scale-[1.02] transition-transform disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        </header>

        {/* Add form */}
        {editingId === 'new' && (
          <EditForm
            initial={{ emoji: '✨', title: '', points: 10, active: true }}
            onSave={handleCreate}
            onCancel={() => setEditingId(null)}
            saving={savingId === 'new'}
          />
        )}

        {/* List */}
        {loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 glass rounded-2xl border border-gold-400/10 animate-pulse" />
            ))}
          </div>
        ) : challenges.length === 0 ? (
          <div className="glass rounded-2xl border border-gold-400/10 p-16 text-center">
            <p className="font-serif italic text-2xl text-foil-static mb-2">No challenges yet</p>
            <p className="font-sans text-sm text-champagne/40 mb-6">
              Add engagement challenges guests can complete at the booth.
            </p>
            <button
              onClick={() => setEditingId('new')}
              className="px-6 py-3 bg-foil text-noir-900 font-bold text-xs font-label uppercase tracking-widest rounded-xl glow-accent"
            >
              Add First Challenge
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {challenges.map((c, i) =>
              editingId === c.id ? (
                <EditForm
                  key={c.id}
                  initial={c}
                  onSave={(patch) => handleUpdate(c.id, patch)}
                  onCancel={() => setEditingId(null)}
                  saving={savingId === c.id}
                />
              ) : (
                <ChallengeRow
                  key={c.id}
                  challenge={c}
                  index={i}
                  total={challenges.length}
                  onEdit={() => setEditingId(c.id)}
                  onDelete={() => handleDelete(c.id)}
                  onMove={(dir) => handleMove(i, dir)}
                  onToggleActive={() => handleToggleActive(c)}
                  busy={savingId === c.id}
                  confirmDelete={confirmDeleteId === c.id}
                  onConfirmDelete={() => setConfirmDeleteId(c.id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                />
              )
            )}
          </div>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}
