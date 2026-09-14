// Node-only WebSocket factory for `RelayAggregator` (docs/RELAY.md §6, `relay-client.ts`).
// NOT re-exported from browser.ts — apps/web passes the browser's native `WebSocket` global as
// the `socketFactory` instead, so this is the only place `ws` is imported for the relay client.

import { WebSocket } from 'ws';
import type { SocketFactory } from './relay-client.js';

export const nodeSocketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as ReturnType<SocketFactory>;
