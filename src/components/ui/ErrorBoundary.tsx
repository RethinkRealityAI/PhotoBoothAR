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
import { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  /** Short label for what failed, e.g. "3D view" (shown in the fallback). */
  label: string;
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

  componentDidCatch(error: Error) {
    console.error(`[ErrorBoundary] ${this.props.label} crashed`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
        <AlertTriangle className="w-7 h-7 text-amber-400" />
        <p className="font-label text-[10px] uppercase tracking-widest text-brand-muted">
          The {this.props.label} hit a snag — your work is safe.
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          className="flex items-center gap-1.5 rounded-full liquid-glass px-4 py-2 text-[10px] font-label uppercase tracking-widest text-accent-2 hover:text-brand-fg transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Try again
        </button>
      </div>
    );
  }
}
