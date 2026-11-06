import { Component, type ReactNode } from 'react';

// Never a blank screen: if anything throws while rendering, show what happened
// and offer a reload, or a reset of this device's saved data as a last resort.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Liquidated crashed:', error);
  }
  private reset = () => {
    try {
      for (const k of Object.keys(window.localStorage)) if (k.startsWith('apex.')) window.localStorage.removeItem(k);
    } catch {
      /* storage blocked */
    }
    location.reload();
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app">
        <div className="gate" style={{ alignContent: 'center' }}>
          <div className="wordmark">LIQUIDATED</div>
          <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong</h1>
          <p className="muted" style={{ margin: 0 }}>The game hit an error while loading. Reloading usually fixes it.</p>
          <pre className="errbox">{String(this.state.error?.message ?? this.state.error)}</pre>
          <button className="primary" onClick={() => location.reload()}>Reload</button>
          <button className="ghost" onClick={this.reset}>Reset data on this device</button>
          <p className="fine">Reset clears the game saved in this browser (online accounts keep their cloud save).</p>
        </div>
      </div>
    );
  }
}
