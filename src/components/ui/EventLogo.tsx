/**
 * @license SPDX-License-Identifier: Apache-2.0
 * Renders the active event's wordmark / nav mark.
 *
 * When an admin has uploaded a logo override (store.logoUrl), it replaces the
 * coded SVG/image lockup everywhere; otherwise the event's coded components
 * render. This lets a new event swap its logo without a code change.
 */
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';

const WORDMARK_HEIGHT: Record<'sm' | 'md' | 'lg' | 'xl', number> = {
  sm: 56,
  md: 88,
  lg: 132,
  xl: 180,
};

export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const { config } = useEvent();
  const logoUrl = useStore((s) => s.logoUrl);
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={useStore.getState().copy.eventName}
        className="object-contain select-none"
        style={{ height: WORDMARK_HEIGHT[size], width: 'auto', maxWidth: '90vw' }}
      />
    );
  }
  const C = config.Wordmark;
  return <C size={size} />;
}

export function Mark() {
  const { config } = useEvent();
  const logoUrl = useStore((s) => s.logoUrl);
  if (logoUrl) {
    return (
      <img src={logoUrl} alt="" className="object-contain select-none" style={{ height: 36, width: 'auto' }} />
    );
  }
  const C = config.Mark;
  return <C />;
}

export function Emblem(props: { size?: number; className?: string }) {
  const { config } = useEvent();
  const logoUrl = useStore((s) => s.logoUrl);
  if (logoUrl) {
    const size = props.size ?? 34;
    return (
      <img
        src={logoUrl}
        alt=""
        className={`object-contain select-none ${props.className ?? ''}`}
        style={{ height: size, width: 'auto' }}
      />
    );
  }
  const C = config.Emblem;
  return <C {...props} />;
}
