// Errors the UI treats specially. Messages say what happened and what to do next.

export class RelayCountError extends Error {
  constructor(
    readonly connected: number,
    readonly required: number,
  ) {
    super(`Connected to ${connected} relay${connected === 1 ? '' : 's'}; a request needs at least ${required}, so one operator can’t hide dealers from you.`);
    this.name = 'InsufficientRelaysError';
  }
}

export type WalletErrorReason = 'not-found' | 'unsupported' | 'rejected' | 'network' | 'disconnected' | 'shape' | 'unavailable';

export class WalletError extends Error {
  constructor(
    message: string,
    readonly reason: WalletErrorReason,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** True for InsufficientRelaysError from the SDK as well as our own RelayCountError. */
export function isRelayCountError(err: unknown): err is { connected: number; required: number; message: string } {
  return err instanceof Error && err.name === 'InsufficientRelaysError';
}
