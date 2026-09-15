import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Button, ErrorState } from '../design/primitives';
import { NotFound } from './NotFound';

// No remote reporting, by design: error details stay on this device unless the user copies them.

function details(error: unknown, componentStack?: string): string {
  const e = error instanceof Error ? error : new Error(String(error));
  return [
    `Pyron client error — ${new Date().toISOString()}`,
    `Page: ${typeof location === 'undefined' ? '' : location.pathname}`,
    `Build: ${import.meta.env.MODE}`,
    `Browser: ${typeof navigator === 'undefined' ? '' : navigator.userAgent}`,
    '',
    `${e.name}: ${e.message}`,
    e.stack ?? '',
    componentStack ? `\nComponent stack:${componentStack}` : '',
  ].join('\n');
}

export function ErrorScreen({ error, componentStack }: { error: unknown; componentStack?: string }) {
  const [copied, setCopied] = useState(false);
  const message = error instanceof Error ? error.message : String(error);
  return (
    <ErrorState
      title="This page stopped working"
      actions={
        <>
          <Button variant="primary" onClick={() => location.reload()}>
            Reload
          </Button>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(details(error, componentStack));
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy error details'}
          </Button>
        </>
      }
    >
      <p>
        <span className="font-mono text-12.5 break-all">{message}</span>
      </p>
      <p className="mt-2">Reload to try again. A trade in progress is kept in this tab and comes back after reloading.</p>
    </ErrorState>
  );
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: unknown; stack?: string }> {
  state: { error: unknown; stack?: string } = { error: undefined };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? undefined });
  }

  render() {
    if (this.state.error !== undefined) return <ErrorScreen error={this.state.error} componentStack={this.state.stack} />;
    return this.props.children;
  }
}

export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  return (
    <div className="max-w-content mx-auto px-4 md:px-gutter py-8">
      <ErrorScreen error={error} />
    </div>
  );
}
