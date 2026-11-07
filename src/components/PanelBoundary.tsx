import React from 'react';

/**
 * Crash guard. Before this, one panel throwing while it drew (the #54 "missing figures" note, for
 * example) blanked the whole app to a white screen. Now the panel that failed shows a short note
 * with the error and a Try again button, and everything else keeps working.
 *
 * `name` says which panel it is. `resetKey` clears the error when it changes (another country,
 * another desk), so the panel gets a fresh try.
 */
interface Props {
  name: string;
  resetKey?: string | number;
  /** The whole app: a full-page note with Reload instead of an inline card. */
  page?: boolean;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  resetKey?: string | number;
}

export class PanelBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[panel-error] ${this.props.name}: ${error?.message || error}`, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const message = String(error?.message || error).slice(0, 300);
    if (this.props.page) {
      return (
        <div role="alert" data-panel-error={this.props.name} className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950 p-6">
          <div className="ui-panel max-w-lg p-5 space-y-3">
            <h1 className="text-lg text-slate-900 dark:text-white">Something went wrong drawing the app</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Your saved data is safe. Reload to try again. If it keeps happening, the error below helps find the cause.
            </p>
            <pre className="text-xs whitespace-pre-wrap bg-slate-50 dark:bg-slate-900 p-2 border border-slate-200 dark:border-slate-700 text-rose-700 dark:text-rose-300">{message}</pre>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return (
      <div role="alert" data-panel-error={this.props.name} className="ui-panel p-4 border-rose-200 dark:border-rose-900 space-y-2">
        <p className="text-sm text-slate-900 dark:text-white">
          {this.props.name} could not be drawn. The rest of the app still works.
        </p>
        <p className="text-xs text-rose-700 dark:text-rose-300 break-words">{message}</p>
        <button type="button" className="ui-btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
