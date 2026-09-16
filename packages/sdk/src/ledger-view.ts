// Decodes OTCProtocol contract state from the indexer's hex encoding into the compiled contract's
// typed ledger. Browser-safe (re-exported from browser.ts): the web client reads contract state
// straight from the indexer's GraphQL API and needs only this step, which is WASM (compact-runtime).

import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { ledger } from '../../../contracts/managed/otc-protocol/contract/index.js';
import { hexToBytes } from './aead.js';

export type OtcLedger = ReturnType<typeof ledger>;

/** `stateHex` is `contractAction.state` as the indexer returns it (hex, optional 0x). */
export function decodeOtcLedger(stateHex: string): OtcLedger {
  const hex = stateHex.startsWith('0x') ? stateHex.slice(2) : stateHex;
  return ledger(ContractState.deserialize(hexToBytes(hex)).data);
}

/** ledger-v8's static default parameters. NOT the live chain's (docs/ROADMAP.md S5: the cost-model
 *  constants differ). For sample-data runs only; live checks use `queryLedgerParameters`. */
export function initialLedgerParameters(): LedgerParameters {
  return LedgerParameters.initialParameters();
}
