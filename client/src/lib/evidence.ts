// Failure evidence: what a taker saves when a settlement failed because the dealer's offer coins were
// already spent. It contains nothing the taker must keep secret: the dealer-signed reveal message
// (ciphertext plus signature), the decrypted terms, the Offer File and the facts of the failure.
// Anyone can check it: the signature under the dealer's on-chain key, and the Offer File's inputs
// against the indexer. Where evidence is published is an open decision; for now it is a file.

import { stringify } from './bigint-json';
import type { RevealMessage } from '@otc/sdk/browser';

export interface FailureEvidence {
  kind: 'pyron-failure-evidence';
  v: 1;
  network: string;
  contract: string;
  quoteId: string;
  dealerCmt: string;
  rfqId: string;
  revealMessage?: RevealMessage;
  dealerEncPk?: string;
  terms?: { pair: string; side: 'buy' | 'sell'; price: string; size: string };
  nonce?: string;
  signature?: string;
  offerFile?: string;
  offerInputs: string[];
  validUntil?: number;
  failure: { reason: string; detail: string; code?: number; spentBy?: string; at: number };
  savedAt: number;
  sampleData: boolean;
}

export function evidenceFileName(e: FailureEvidence): string {
  return `pyron-evidence-${e.quoteId.slice(0, 12)}-${new Date(e.savedAt * 1000).toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
}

export function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([stringify(value, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
