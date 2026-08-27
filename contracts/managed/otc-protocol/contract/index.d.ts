import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Bond = { amount: bigint;
                     quotePk: __compactRuntime.JubjubPoint;
                     withdrawRequested: bigint;
                     liveQuotes: bigint;
                     openChallenges: bigint;
                     active: boolean
                   };

export type Quote = { dealerCmt: Uint8Array;
                      commitment: Uint8Array;
                      validUntil: bigint;
                      rfqId: Uint8Array;
                      resolved: boolean
                    };

export type Challenge = { quoteId: Uint8Array;
                          takerAddr: Uint8Array;
                          bondAmount: bigint;
                          respondBy: bigint;
                          resolved: boolean
                        };

export type NoteRef = { ciphertextHash: Uint8Array;
                        policyTag: bigint;
                        recipientHint: Uint8Array
                      };

export type Witnesses<PS> = {
  getChallengeReduction(context: __compactRuntime.WitnessContext<Ledger, PS>,
                        challenge_0: bigint): [PS, [bigint, bigint, bigint]];
  dealerSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  takerAddress(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  computeSlashShares(context: __compactRuntime.WitnessContext<Ledger, PS>,
                     amount_0: bigint): [PS, [bigint, bigint]];
}

export type ImpureCircuits<PS> = {
  postBond(context: __compactRuntime.CircuitContext<PS>,
           amount_0: bigint,
           quotePk_0: __compactRuntime.JubjubPoint): __compactRuntime.CircuitResults<PS, []>;
  topUpBond(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  requestBondWithdrawal(context: __compactRuntime.CircuitContext<PS>,
                        now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdrawBond(context: __compactRuntime.CircuitContext<PS>,
               recipient_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  commitQuote(context: __compactRuntime.CircuitContext<PS>,
              rfqId_0: Uint8Array,
              commitment_0: Uint8Array,
              validUntil_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  openSettlementChallenge(context: __compactRuntime.CircuitContext<PS>,
                          quoteId_0: Uint8Array,
                          bondAmount_0: bigint,
                          now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  recordSettlement(context: __compactRuntime.CircuitContext<PS>,
                   quoteId_0: Uint8Array,
                   challengeId_0: { is_some: boolean, value: Uint8Array },
                   recipient_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  releaseExpiredQuote(context: __compactRuntime.CircuitContext<PS>,
                      quoteId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  submitFraudProofMismatch(context: __compactRuntime.CircuitContext<PS>,
                           quoteId_0: Uint8Array,
                           revealedTerms_0: bigint[],
                           revealedNonce_0: Uint8Array,
                           signature_0: { announcement: __compactRuntime.JubjubPoint,
                                          response: bigint
                                        },
                           beneficiary_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  submitFraudProofTimeout(context: __compactRuntime.CircuitContext<PS>,
                          challengeId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  attachDisclosureNote(context: __compactRuntime.CircuitContext<PS>,
                       tradeId_0: Uint8Array,
                       ciphertextHash_0: Uint8Array,
                       policyTag_0: bigint,
                       recipientHint_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  postBond(context: __compactRuntime.CircuitContext<PS>,
           amount_0: bigint,
           quotePk_0: __compactRuntime.JubjubPoint): __compactRuntime.CircuitResults<PS, []>;
  topUpBond(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  requestBondWithdrawal(context: __compactRuntime.CircuitContext<PS>,
                        now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdrawBond(context: __compactRuntime.CircuitContext<PS>,
               recipient_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  commitQuote(context: __compactRuntime.CircuitContext<PS>,
              rfqId_0: Uint8Array,
              commitment_0: Uint8Array,
              validUntil_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  openSettlementChallenge(context: __compactRuntime.CircuitContext<PS>,
                          quoteId_0: Uint8Array,
                          bondAmount_0: bigint,
                          now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  recordSettlement(context: __compactRuntime.CircuitContext<PS>,
                   quoteId_0: Uint8Array,
                   challengeId_0: { is_some: boolean, value: Uint8Array },
                   recipient_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  releaseExpiredQuote(context: __compactRuntime.CircuitContext<PS>,
                      quoteId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  submitFraudProofMismatch(context: __compactRuntime.CircuitContext<PS>,
                           quoteId_0: Uint8Array,
                           revealedTerms_0: bigint[],
                           revealedNonce_0: Uint8Array,
                           signature_0: { announcement: __compactRuntime.JubjubPoint,
                                          response: bigint
                                        },
                           beneficiary_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  submitFraudProofTimeout(context: __compactRuntime.CircuitContext<PS>,
                          challengeId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  attachDisclosureNote(context: __compactRuntime.CircuitContext<PS>,
                       tradeId_0: Uint8Array,
                       ciphertextHash_0: Uint8Array,
                       policyTag_0: bigint,
                       recipientHint_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  postBond(context: __compactRuntime.CircuitContext<PS>,
           amount_0: bigint,
           quotePk_0: __compactRuntime.JubjubPoint): __compactRuntime.CircuitResults<PS, []>;
  topUpBond(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  requestBondWithdrawal(context: __compactRuntime.CircuitContext<PS>,
                        now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdrawBond(context: __compactRuntime.CircuitContext<PS>,
               recipient_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  commitQuote(context: __compactRuntime.CircuitContext<PS>,
              rfqId_0: Uint8Array,
              commitment_0: Uint8Array,
              validUntil_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  openSettlementChallenge(context: __compactRuntime.CircuitContext<PS>,
                          quoteId_0: Uint8Array,
                          bondAmount_0: bigint,
                          now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  recordSettlement(context: __compactRuntime.CircuitContext<PS>,
                   quoteId_0: Uint8Array,
                   challengeId_0: { is_some: boolean, value: Uint8Array },
                   recipient_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  releaseExpiredQuote(context: __compactRuntime.CircuitContext<PS>,
                      quoteId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  submitFraudProofMismatch(context: __compactRuntime.CircuitContext<PS>,
                           quoteId_0: Uint8Array,
                           revealedTerms_0: bigint[],
                           revealedNonce_0: Uint8Array,
                           signature_0: { announcement: __compactRuntime.JubjubPoint,
                                          response: bigint
                                        },
                           beneficiary_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  submitFraudProofTimeout(context: __compactRuntime.CircuitContext<PS>,
                          challengeId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  attachDisclosureNote(context: __compactRuntime.CircuitContext<PS>,
                       tradeId_0: Uint8Array,
                       ciphertextHash_0: Uint8Array,
                       policyTag_0: bigint,
                       recipientHint_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  bonds: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Bond;
    [Symbol.iterator](): Iterator<[Uint8Array, Bond]>
  };
  settled: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { read(): bigint }
  };
  slashed: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { read(): bigint }
  };
  quotes: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Quote;
    [Symbol.iterator](): Iterator<[Uint8Array, Quote]>
  };
  challenges: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Challenge;
    [Symbol.iterator](): Iterator<[Uint8Array, Challenge]>
  };
  notes: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): NoteRef;
    [Symbol.iterator](): Iterator<[Uint8Array, NoteRef]>
  };
  readonly burnedTotal: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
