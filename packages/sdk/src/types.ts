// Provider/circuit type aliases, per the midnight-js skill's documented pattern (§4).

import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type {
  Contract as OTCContractClass,
  ProvableCircuits as OTCProvableCircuits,
} from '../../../contracts/managed/otc-protocol/contract/index.js';
import type { OTCPrivateState } from './private-state.js';

export type OTCContract = OTCContractClass<OTCPrivateState>;
// compact-js's ImpureCircuitId helper isn't exported by the installed version (4.0.2-era) —
// derive circuit IDs directly from the generated contract's own ProvableCircuits<PS> type
// instead, matching what deployContract/findDeployedContract actually key against
// (Contract.ProvableCircuitId<C> = keyof C['provableCircuits'] & string).
export type OTCCircuits = keyof OTCProvableCircuits<OTCPrivateState> & string;

export const OTCPrivateStateId = 'otcPrivateState' as const;
export type OTCPrivateStateId = typeof OTCPrivateStateId;

export type OTCProviders = MidnightProviders<OTCCircuits, OTCPrivateStateId, OTCPrivateState>;

export type DeployedOTCContract = DeployedContract<OTCContract> | FoundContract<OTCContract>;
