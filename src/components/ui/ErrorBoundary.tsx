/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ErrorBoundary — the app's first error boundary. Wrap it around subtrees whose
 * failure must degrade locally instead of blanking the whole app (React unmounts
 * everything up to the nearest boundary on an uncaught render error — e.g. a 3D
 * view whose CDN-hosted asset/font fetch throws inside the R3F tree).
 * Renders a liquid-glass fallback with a Try-again that remounts the children.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Mail, RotateCcw } from 'lucide-react';
import { reportError, SUPPORT_EMAIL } from '../../lib/errorReport';

/** "Something broke — tell us" mailto with the error message prefilled. */
function supportMailto(label: string, error: Error): string {
  const subject = `Beamwall problem report — ${label}`;
  const body =
    `Hi — something broke in the ${label}.\n\n` +
    `Error: ${String(error.message || error).slice(0, 500)}\n` +
    `Page: ${window.location.href.slice(0, 300)}\n\n` +
    `What I was doing:\n`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

interface Props {
  /** Short label for what failed, e.g. "3D view" (shown in the fallback). */
  label: string;
  /** Full-screen variant for the app-root boundary: centered on its own dark
   *  backdrop, and offers a hard page reload in addition to a remount (a
   *  whole-app crash usually can't be recovered by remounting alone). */
  fullScreen?: boolean;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary] ${this.props.label} crashed`, error);
    reportError(error, {
      source: 'error-boundary',
      boundary: this.props.label,
      componentStack: info.componentStack?.slice(0, 2_000) ?? null,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { label, fullScreen } = this.props;
    if (fullScreen) {
      return (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-brand-bg px-8 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <p className="max-w-xs font-serif text-xl text-brand-fg">Something went wrong.</p>
          <p className="max-w-xs text-sm leading-relaxed text-brand-muted/70">
            The {label} hit an unexpected error. Reloading usually fixes it — nothing you saved is lost.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-1.5 rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reload
            </button>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.08]"
            >
              Try again
            </button>
          </div>
          <a
            href={supportMailto(label, this.state.error)}
            className="mt-1 flex items-center gap-1.5 text-[11px] text-brand-muted/70 underline-offset-4 transition-colors hover:text-brand-fg hover:underline"
          >
            <Mail className="h-3 w-3" />
            Something broke — tell us
          </a>
        </div>
      );
    }
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
        <AlertTriangle className="w-7 h-7 text-amber-400" />
        <p className="font-label text-[10px] uppercase tracking-widest text-brand-muted">
          The {label} hit a snag — your work is safe.
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          className="flex items-center gap-1.5 rounded-full liquid-glass px-4 py-2 text-[10px] font-label uppercase tracking-widest text-accent-2 hover:text-brand-fg transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Try again
        </button>
        <a
          href={supportMailto(label, this.state.error)}
          className="text-[10px] text-brand-muted/60 underline-offset-4 transition-colors hover:text-brand-fg hover:underline"
        >
          Something broke — tell us
        </a>
      </div>
    );
  }
}
