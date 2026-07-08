/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A2UI v0.9.1 renderer — maps the protocol's *basic catalog* onto Beamwall's
 * design system (platform surfaces: glass cards, foil buttons, brand tokens).
 * The tree is reconstructed from the surface's flat component map starting at
 * id "root"; unknown component types render nothing (agents can only invoke
 * the trusted catalog — that's the A2UI security model).
 *
 * Supported subset: Card, Column, Row, List (static + templated), Text, Image,
 * Icon, Divider, Button, TextField, DateTimeInput, CheckBox, ChoicePicker.
 * Two-way input bindings write through `onDataChange`; Button `action.event`
 * fires `onAction` with its context resolved against the data model at
 * trigger time, per the spec.
 */
import { memo } from 'react';
import { CalendarDays, Check, Heart, PartyPopper, Sparkles, Star } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  resolveBindingPath, resolveContext, resolveDynamic,
  type A2uiActionEvent, type A2uiComponent, type SurfaceState,
} from '../../lib/a2ui';
import { EVENT_TEMPLATES, templateById } from '../../lib/eventTemplates';
import TemplatePreview from '../ui/TemplatePreview';

interface Props {
  surface: SurfaceState;
  onAction: (event: A2uiActionEvent) => void;
  onDataChange: (surfaceId: string, path: string, value: unknown) => void;
  /** Disables actions while the agent is thinking. */
  busy?: boolean;
}

const ICONS: Record<string, typeof Sparkles> = {
  sparkles: Sparkles,
  calendar: CalendarDays,
  check: Check,
  star: Star,
  heart: Heart,
  party: PartyPopper,
};

const TEXT_VARIANTS: Record<string, string> = {
  h1: 'font-serif text-2xl text-foil-static',
  h2: 'font-serif text-xl text-foil-static',
  h3: 'font-serif text-lg text-foil-static',
  h4: 'font-serif text-base text-foil-static',
  h5: 'font-serif text-sm text-foil-static',
  caption: 'font-sans text-[11px] text-brand-muted/60',
  body: 'font-sans text-[13px] leading-relaxed text-brand-fg/90',
};

const JUSTIFY: Record<string, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  spaceBetween: 'justify-between',
  spaceAround: 'justify-around',
};

const ALIGN: Record<string, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 text-[13px] text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60';

const labelClass = 'font-label uppercase tracking-luxe text-[9px] text-brand-muted/70';

const warned = new Set<string>();

function A2uiSurface({ surface, onAction, onDataChange, busy = false }: Props) {
  const { components, dataModel, surfaceId } = surface;

  /** Absolute data-model path behind a `{ path }` binding, or null. */
  const bindingPath = (value: unknown, scope: string): string | null => {
    if (value !== null && typeof value === 'object' && typeof (value as { path?: unknown }).path === 'string') {
      return resolveBindingPath((value as { path: string }).path, scope);
    }
    return null;
  };

  const str = (value: unknown, scope: string): string => {
    const v = resolveDynamic(value, dataModel, scope);
    return v === null || v === undefined ? '' : String(v);
  };

  const fireAction = (c: A2uiComponent, scope: string) => {
    const action = c.action as
      | { event?: { name?: string; context?: Record<string, unknown> }; functionCall?: { call?: string; args?: Record<string, unknown> } }
      | undefined;
    if (!action || busy) return;
    if (action.functionCall?.call === 'openUrl') {
      const url = str(action.functionCall.args?.url, scope);
      if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action.functionCall?.call === 'copyToClipboard') {
      const value = str(action.functionCall.args?.value, scope);
      if (value) navigator.clipboard?.writeText(value).catch(() => { /* permission denied — ignore */ });
      return;
    }
    if (action.event?.name) {
      onAction({
        name: action.event.name,
        surfaceId,
        sourceComponentId: c.id,
        context: resolveContext(action.event.context, dataModel, scope),
        timestamp: new Date().toISOString(),
      });
    }
  };

  const renderChildren = (c: A2uiComponent, scope: string) => {
    const children = c.children as unknown;
    if (Array.isArray(children)) {
      return children.map((id) => (typeof id === 'string' ? render(id, scope) : null));
    }
    // Templated ChildList: { path, componentId } — one template instance per
    // array item, each scoped to its item for relative-path bindings.
    if (children !== null && typeof children === 'object') {
      const t = children as { path?: string; componentId?: string };
      if (typeof t.path === 'string' && typeof t.componentId === 'string') {
        const base = resolveBindingPath(t.path, scope);
        const items = resolveDynamic({ path: base }, dataModel);
        if (Array.isArray(items)) {
          return items.map((_item, i) => (
            <span key={`${t.componentId}-${i}`}>{render(t.componentId!, `${base}/${i}`)}</span>
          ));
        }
      }
    }
    return null;
  };

  const render = (id: string, scope: string): React.ReactNode => {
    const c = components[id];
    if (!c) return null;
    const key = `${surfaceId}:${id}:${scope}`;

    switch (c.component) {
      case 'Card':
        return (
          <div key={key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            {typeof c.child === 'string' && render(c.child, scope)}
          </div>
        );

      case 'Column':
      case 'List':
        return (
          <div
            key={key}
            className={`flex flex-col gap-2.5 ${JUSTIFY[c.justify as string] ?? ''} ${ALIGN[c.align as string] ?? ''}`}
          >
            {renderChildren(c, scope)}
          </div>
        );

      case 'Row':
        return (
          <div
            key={key}
            className={`flex flex-row flex-wrap gap-2.5 ${JUSTIFY[c.justify as string] ?? ''} ${ALIGN[c.align as string] ?? 'items-center'}`}
          >
            {renderChildren(c, scope)}
          </div>
        );

      case 'Text':
        return (
          <p key={key} className={TEXT_VARIANTS[c.variant as string] ?? TEXT_VARIANTS.body}>
            {str(c.text, scope)}
          </p>
        );

      case 'Image': {
        const url = str(c.url, scope);
        return url ? <img key={key} src={url} alt="" className="rounded-xl max-w-full" /> : null;
      }

      case 'Icon': {
        const IconCmp = ICONS[str(c.name, scope).toLowerCase()];
        return IconCmp ? <IconCmp key={key} className="w-4 h-4 text-[color:var(--color-accent)]" /> : null;
      }

      case 'Divider':
        return c.axis === 'vertical'
          ? <div key={key} className="w-px self-stretch bg-white/10" />
          : <div key={key} className="h-px w-full bg-white/10" />;

      case 'Button': {
        const primary = c.variant !== 'borderless';
        return (
          <button
            key={key}
            onClick={() => fireAction(c, scope)}
            disabled={busy}
            className={
              primary
                ? 'rounded-full bg-foil px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.97] disabled:opacity-40'
                : 'font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 hover:text-brand-fg transition-colors disabled:opacity-40'
            }
          >
            {typeof c.child === 'string' ? render(c.child, scope) : null}
          </button>
        );
      }

      case 'TextField': {
        const path = bindingPath(c.value, scope);
        return (
          <label key={key} className="flex flex-col gap-1">
            {c.label !== undefined && <span className={labelClass}>{str(c.label, scope)}</span>}
            <input
              value={str(c.value, scope)}
              readOnly={path === null}
              onChange={(e) => path !== null && onDataChange(surfaceId, path, e.target.value)}
              className={inputClass}
            />
          </label>
        );
      }

      case 'DateTimeInput': {
        const path = bindingPath(c.value, scope);
        return (
          <label key={key} className="flex flex-col gap-1">
            {c.label !== undefined && <span className={labelClass}>{str(c.label, scope)}</span>}
            <input
              type="date"
              value={str(c.value, scope)}
              readOnly={path === null}
              onChange={(e) => path !== null && onDataChange(surfaceId, path, e.target.value)}
              className={inputClass}
            />
          </label>
        );
      }

      case 'CheckBox': {
        const path = bindingPath(c.value, scope);
        const checked = resolveDynamic(c.value, dataModel, scope) === true;
        return (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              disabled={path === null}
              onChange={(e) => path !== null && onDataChange(surfaceId, path, e.target.checked)}
              className="accent-[color:var(--color-accent)]"
            />
            <span className="font-sans text-[12px] text-brand-fg/85">{str(c.label, scope)}</span>
          </label>
        );
      }

      case 'ChoicePicker': {
        const path = bindingPath(c.value, scope);
        const current = resolveDynamic(c.value, dataModel, scope);
        const options = Array.isArray(c.options) ? (c.options as { label?: unknown; value?: unknown }[]) : [];
        return (
          <div key={key} className="flex flex-col gap-1">
            {c.label !== undefined && <span className={labelClass}>{str(c.label, scope)}</span>}
            <div className="flex flex-wrap gap-1.5">
              {options.map((o, i) => {
                const value = str(o.value, scope);
                const selected = current === value;
                return (
                  <button
                    key={`${key}-opt-${i}`}
                    onClick={() => path !== null && onDataChange(surfaceId, path, value)}
                    aria-pressed={selected}
                    className={`rounded-full border px-3 py-1.5 font-sans text-[11px] transition-colors ${
                      selected
                        ? 'border-[color:var(--color-accent)]/70 bg-[color:var(--color-accent)]/15 text-brand-fg'
                        : 'border-white/10 bg-white/[0.03] text-brand-muted/80 hover:text-brand-fg hover:bg-white/[0.06]'
                    }`}
                  >
                    {str(o.label, scope)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }

      /* ── Beamwall custom catalog (BEAMWALL_CATALOG_ID) ─────────────── */

      case 'TemplatePreview': {
        // Live look preview — updates as bindings (style chips, name field)
        // change, so the agent always SHOWS what it is about to apply.
        const tpl = templateById(str(c.templateId, scope)) ?? EVENT_TEMPLATES[0];
        const eventName = str(c.eventName, scope) || tpl.label;
        const accent = str(c.accent, scope) || null;
        return (
          <div key={key} className="w-full max-w-[168px] mx-auto">
            <TemplatePreview template={tpl} eventName={eventName} accent={accent} />
          </div>
        );
      }

      case 'ColorChoice': {
        // Beamwall custom widget: circular swatches bound like ChoicePicker.
        // Clicking the selected swatch clears the choice (back to template).
        const path = bindingPath(c.value, scope);
        const current = resolveDynamic(c.value, dataModel, scope);
        const options = Array.isArray(c.options) ? (c.options as unknown[]).filter((o): o is string => typeof o === 'string') : [];
        return (
          <div key={key} className="flex flex-col gap-1">
            {c.label !== undefined && <span className={labelClass}>{str(c.label, scope)}</span>}
            <div className="flex flex-wrap items-center gap-2">
              {options.map((hex) => {
                const selected = current === hex;
                return (
                  <button
                    key={`${key}-sw-${hex}`}
                    onClick={() => path !== null && onDataChange(surfaceId, path, selected ? null : hex)}
                    aria-pressed={selected}
                    title={hex}
                    className={`w-7 h-7 rounded-full border-2 transition-transform active:scale-90 ${
                      selected ? 'border-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.35)]' : 'border-white/20'
                    }`}
                    style={{ background: hex }}
                  />
                );
              })}
              <span className="font-sans text-[10px] text-brand-muted/50">{current ? '' : 'template default'}</span>
            </div>
          </div>
        );
      }

      case 'EventStat': {
        // Beamwall custom widget: one stat tile (copilot get_stats rows).
        return (
          <div key={key} className="flex flex-col items-center gap-0.5 px-3 py-2">
            <span className="font-serif text-lg text-foil-static leading-none">{str(c.value, scope)}</span>
            <span className="font-label uppercase tracking-luxe text-[8px] text-brand-muted/60">{str(c.label, scope)}</span>
          </div>
        );
      }

      case 'QrCode': {
        const value = str(c.value, scope);
        if (!value) return null;
        return (
          <div key={key} className="flex flex-col items-center gap-1.5">
            <div className="rounded-xl p-2 bg-brand-fg/95">
              <QRCodeSVG value={value} size={104} bgColor="#faf6ef" fgColor="#1a1108" level="M" />
            </div>
            {c.caption !== undefined && (
              <p className="font-sans text-[10px] text-brand-muted/60">{str(c.caption, scope)}</p>
            )}
          </div>
        );
      }

      default:
        if (!warned.has(c.component)) {
          warned.add(c.component);
          console.warn(`[a2ui] unsupported component type "${c.component}" — skipped`);
        }
        return null;
    }
  };

  if (!components.root) return null;
  return <div className="w-full">{render('root', '')}</div>;
}

/** Memoized: the surfaces map preserves object identity for untouched
 *  surfaces, so typing in one card (or the chat input) no longer re-renders
 *  every other card in the transcript. */
export default memo(A2uiSurface);
