import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';
__compactRuntime.checkRuntimeVersion('0.15.0');

const _descriptor_0 = new __compactRuntime.CompactTypeBytes(32);

const _descriptor_1 = new __compactRuntime.CompactTypeUnsignedInteger(65535n, 2);

class _NoteRef_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment()));
  }
  fromValue(value_0) {
    return {
      ciphertextHash: _descriptor_0.fromValue(value_0),
      policyTag: _descriptor_1.fromValue(value_0),
      recipientHint: _descriptor_0.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.ciphertextHash).concat(_descriptor_1.toValue(value_0.policyTag).concat(_descriptor_0.toValue(value_0.recipientHint)));
  }
}

const _descriptor_2 = new _NoteRef_0();

const _descriptor_3 = __compactRuntime.CompactTypeBoolean;

const _descriptor_4 = new __compactRuntime.CompactTypeUnsignedInteger(340282366920938463463374607431768211455n, 16);

const _descriptor_5 = new __compactRuntime.CompactTypeUnsignedInteger(18446744073709551615n, 8);

class _Challenge_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_0.alignment().concat(_descriptor_4.alignment().concat(_descriptor_5.alignment().concat(_descriptor_3.alignment()))));
  }
  fromValue(value_0) {
    return {
      quoteId: _descriptor_0.fromValue(value_0),
      takerAddr: _descriptor_0.fromValue(value_0),
      bondAmount: _descriptor_4.fromValue(value_0),
      respondBy: _descriptor_5.fromValue(value_0),
      resolved: _descriptor_3.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.quoteId).concat(_descriptor_0.toValue(value_0.takerAddr).concat(_descriptor_4.toValue(value_0.bondAmount).concat(_descriptor_5.toValue(value_0.respondBy).concat(_descriptor_3.toValue(value_0.resolved)))));
  }
}

const _descriptor_6 = new _Challenge_0();

class _Quote_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_0.alignment().concat(_descriptor_5.alignment().concat(_descriptor_0.alignment().concat(_descriptor_3.alignment()))));
  }
  fromValue(value_0) {
    return {
      dealerCmt: _descriptor_0.fromValue(value_0),
      commitment: _descriptor_0.fromValue(value_0),
      validUntil: _descriptor_5.fromValue(value_0),
      rfqId: _descriptor_0.fromValue(value_0),
      resolved: _descriptor_3.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.dealerCmt).concat(_descriptor_0.toValue(value_0.commitment).concat(_descriptor_5.toValue(value_0.validUntil).concat(_descriptor_0.toValue(value_0.rfqId).concat(_descriptor_3.toValue(value_0.resolved)))));
  }
}

const _descriptor_7 = new _Quote_0();

const _descriptor_8 = __compactRuntime.CompactTypeJubjubPoint;

const _descriptor_9 = new __compactRuntime.CompactTypeUnsignedInteger(4294967295n, 4);

class _Bond_0 {
  alignment() {
    return _descriptor_4.alignment().concat(_descriptor_8.alignment().concat(_descriptor_5.alignment().concat(_descriptor_9.alignment().concat(_descriptor_9.alignment().concat(_descriptor_3.alignment())))));
  }
  fromValue(value_0) {
    return {
      amount: _descriptor_4.fromValue(value_0),
      quotePk: _descriptor_8.fromValue(value_0),
      withdrawRequested: _descriptor_5.fromValue(value_0),
      liveQuotes: _descriptor_9.fromValue(value_0),
      openChallenges: _descriptor_9.fromValue(value_0),
      active: _descriptor_3.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_4.toValue(value_0.amount).concat(_descriptor_8.toValue(value_0.quotePk).concat(_descriptor_5.toValue(value_0.withdrawRequested).concat(_descriptor_9.toValue(value_0.liveQuotes).concat(_descriptor_9.toValue(value_0.openChallenges).concat(_descriptor_3.toValue(value_0.active))))));
  }
}

const _descriptor_10 = new _Bond_0();

class _Maybe_0 {
  alignment() {
    return _descriptor_3.alignment().concat(_descriptor_0.alignment());
  }
  fromValue(value_0) {
    return {
      is_some: _descriptor_3.fromValue(value_0),
      value: _descriptor_0.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_3.toValue(value_0.is_some).concat(_descriptor_0.toValue(value_0.value));
  }
}

const _descriptor_11 = new _Maybe_0();

const _descriptor_12 = __compactRuntime.CompactTypeField;

const _descriptor_13 = new __compactRuntime.CompactTypeVector(4, _descriptor_12);

class _SchnorrSignature_0 {
  alignment() {
    return _descriptor_8.alignment().concat(_descriptor_12.alignment());
  }
  fromValue(value_0) {
    return {
      announcement: _descriptor_8.fromValue(value_0),
      response: _descriptor_12.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_8.toValue(value_0.announcement).concat(_descriptor_12.toValue(value_0.response));
  }
}

const _descriptor_14 = new _SchnorrSignature_0();

class _tuple_0 {
  alignment() {
    return _descriptor_4.alignment().concat(_descriptor_4.alignment());
  }
  fromValue(value_0) {
    return [
      _descriptor_4.fromValue(value_0),
      _descriptor_4.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_4.toValue(value_0[0]).concat(_descriptor_4.toValue(value_0[1]));
  }
}

const _descriptor_15 = new _tuple_0();

const _descriptor_16 = new __compactRuntime.CompactTypeUnsignedInteger(8n, 1);

const _descriptor_17 = new __compactRuntime.CompactTypeUnsignedInteger(14n, 1);

const _descriptor_18 = new __compactRuntime.CompactTypeUnsignedInteger(452312848583266388373324160190187140051835877600158453279131187530910662655n, 31);

class _tuple_1 {
  alignment() {
    return _descriptor_16.alignment().concat(_descriptor_17.alignment().concat(_descriptor_18.alignment()));
  }
  fromValue(value_0) {
    return [
      _descriptor_16.fromValue(value_0),
      _descriptor_17.fromValue(value_0),
      _descriptor_18.fromValue(value_0)
    ]
  }
  toValue(value_0) {
    return _descriptor_16.toValue(value_0[0]).concat(_descriptor_17.toValue(value_0[1]).concat(_descriptor_18.toValue(value_0[2])));
  }
}

const _descriptor_19 = new _tuple_1();

const _descriptor_20 = new __compactRuntime.CompactTypeVector(2, _descriptor_0);

const _descriptor_21 = new __compactRuntime.CompactTypeVector(4, _descriptor_0);

const _descriptor_22 = new __compactRuntime.CompactTypeVector(3, _descriptor_0);

const _descriptor_23 = new __compactRuntime.CompactTypeVector(5, _descriptor_12);

class _Either_0 {
  alignment() {
    return _descriptor_3.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_3.fromValue(value_0),
      left: _descriptor_0.fromValue(value_0),
      right: _descriptor_0.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_3.toValue(value_0.is_left).concat(_descriptor_0.toValue(value_0.left).concat(_descriptor_0.toValue(value_0.right)));
  }
}

const _descriptor_24 = new _Either_0();

class _ContractAddress_0 {
  alignment() {
    return _descriptor_0.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_0.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.bytes);
  }
}

const _descriptor_25 = new _ContractAddress_0();

class _UserAddress_0 {
  alignment() {
    return _descriptor_0.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_0.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.bytes);
  }
}

const _descriptor_26 = new _UserAddress_0();

class _Either_1 {
  alignment() {
    return _descriptor_3.alignment().concat(_descriptor_25.alignment().concat(_descriptor_26.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_3.fromValue(value_0),
      left: _descriptor_25.fromValue(value_0),
      right: _descriptor_26.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_3.toValue(value_0.is_left).concat(_descriptor_25.toValue(value_0.left).concat(_descriptor_26.toValue(value_0.right)));
  }
}

const _descriptor_27 = new _Either_1();

const _descriptor_28 = new __compactRuntime.CompactTypeUnsignedInteger(255n, 1);

export class Contract {
  witnesses;
  constructor(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract constructor: expected 1 argument, received ${args_0.length}`);
    }
    const witnesses_0 = args_0[0];
    if (typeof(witnesses_0) !== 'object') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor is not an object');
    }
    if (typeof(witnesses_0.getChallengeReduction) !== 'function') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor does not contain a function-valued field named getChallengeReduction');
    }
    if (typeof(witnesses_0.dealerSecretKey) !== 'function') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor does not contain a function-valued field named dealerSecretKey');
    }
    if (typeof(witnesses_0.takerAddress) !== 'function') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor does not contain a function-valued field named takerAddress');
    }
    if (typeof(witnesses_0.computeSlashShares) !== 'function') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor does not contain a function-valued field named computeSlashShares');
    }
    this.witnesses = witnesses_0;
    this.circuits = {
      postBond: (...args_1) => {
        if (args_1.length !== 3) {
          throw new __compactRuntime.CompactError(`postBond: expected 3 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const amount_0 = args_1[1];
        const quotePk_0 = args_1[2];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('postBond',
                                     'argument 1 (as invoked from Typescript)',
                                     'OTCProtocol.compact line 125 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('postBond',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'OTCProtocol.compact line 125 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_4.toValue(amount_0).concat(_descriptor_8.toValue(quotePk_0)),
            alignment: _descriptor_4.alignment().concat(_descriptor_8.alignment())
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._postBond_0(context,
                                          partialProofData,
                                          amount_0,
                                          quotePk_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      },
      topUpBond: (...args_1) => {
        if (args_1.length !== 2) {
          throw new __compactRuntime.CompactError(`topUpBond: expected 2 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const amount_0 = args_1[1];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('topUpBond',
                                     'argument 1 (as invoked from Typescript)',
                                     'OTCProtocol.compact line 142 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('topUpBond',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'OTCProtocol.compact line 142 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_4.toValue(amount_0),
            alignment: _descriptor_4.alignment()
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._topUpBond_0(context, partialProofData, amount_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      },
      requestBondWithdrawal: (...args_1) => {
        if (args_1.length !== 2) {
          throw new __compactRuntime.CompactError(`requestBondWithdrawal: expected 2 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const now_0 = args_1[1];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('requestBondWithdrawal',
                                     'argument 1 (as invoked from Typescript)',
                                     'OTCProtocol.compact line 157 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(now_0) === 'bigint' && now_0 >= 0n && now_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('requestBondWithdrawal',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'OTCProtocol.compact line 157 char 1',
                                     'Uint<0..18446744073709551616>',
                                     now_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_5.toValue(now_0),
            alignment: _descriptor_5.alignment()
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._requestBondWithdrawal_0(context,
                                                       partialProofData,
                                                       now_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      },
      withdrawBond: (...args_1) => {
        if (args_1.length !== 2) {
          throw new __compactRuntime.CompactError(`withdrawBond: expected 2 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const recipient_0 = args_1[1];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdrawBond',
                                     'argument 1 (as invoked from Typescript)',
                                     'OTCProtocol.compact line 168 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(recipient_0.buffer instanceof ArrayBuffer && recipient_0.BYTES_PER_ELEMENT === 1 && recipient_0.length === 32)) {
          __compactRuntime.typeError('withdrawBond',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'OTCProtocol.compact line 168 char 1',
                                     'Bytes<32>',
                                     recipient_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_0.toValue(recipient_0),
            alignment: _descriptor_0.alignment()
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._withdrawBond_0(context,
                                              partialProofData,
                                              recipient_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      },
      commitQuote: (...args_1) => {
        if (args_1.length !== 4) {
          throw new __compactRuntime.CompactError(`commitQuote: expected 4 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const rfqId_0 = args_1[1];
        const commitment_0 = args_1[2];
        const validUntil_0 = args_1[3];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('commitQuote',
                                     'argument 1 (as invoked from Typescript)',
                                     'OTCProtocol.compact line 185 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(rfqId_0.buffer instanceof ArrayBuffer && rfqId_0.BYTES_PER_ELEMENT === 1 && rfqId_0.length === 32)) {
          __compactRuntime.typeError('commitQuote',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'OTCProtocol.compact line 185 char 1',
                                     'Bytes<32>',
                                     rfqId_0)
        }
        if (!(commitment_0.buffer instanceof ArrayBuffer && commitment_0.BYTES_PER_ELEMENT === 1 && commitment_0.length === 32)) {
          __compactRuntime.typeError('commitQuote',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'OTCProtocol.compact line 185 char 1',
                                     'Bytes<32>',
                                     commitment_0)
        }
        if (!(typeof(validUntil_0) === 'bigint' && validUntil_0 >= 0n && validUntil_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('commitQuote',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'OTCProtocol.compact line 185 char 1',
                                     'Uint<0..18446744073709551616>',
                                     validUntil_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_0.toValue(rfqId_0).concat(_descriptor_0.toValue(commitment_0).concat(_descriptor_5.toValue(validUntil_0))),
            alignment: _descriptor_0.alignment().concat(_descriptor_0.alignment().concat(_descriptor_5.alignment()))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._commitQuote_0(context,
                                             partialProofData,
                                             rfqId_0,
                                             commitment_0,
                                             validUntil_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      },
      openSettlementChallenge: (...args_1) => {
        if (args_1.length !== 4) {
          throw new __compactRuntime.CompactError(`openSettlementChallenge: expected 4 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const quoteId_0 = args_1[1];
        const bondAmount_0 = args_1[2];
        const now_0 = args_1[3];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('openSettlementChallenge',
                                     'argument 1 (as invoked from Typescript)',
                                     'OTCProtocol.compact line 221 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(quoteId_0.buffer instanceof ArrayBuffer && quoteId_0.BYTES_PER_ELEMENT === 1 && quoteId_0.length === 32)) {
          __compactRuntime.typeError('openSettlementChallenge',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'OTCProtocol.compact line 221 char 1',
                                     'Bytes<32>',
                                     quoteId_0)
        }
        if (!(typeof(bondAmount_0) === 'bigint' && bondAmount_0 >= 0n && bondAmount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('openSettlementChallenge',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'OTCProtocol.compact line 221 char 1',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     bondAmount_0)
        }
        if (!(typeof(now_0) === 'bigint' && now_0 >= 0n && now_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('openSettlementChallenge',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'OTCProtocol.compact line 221 char 1',
                                     'Uint<0..18446744073709551616>',
                                     now_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_0.toValue(quoteId_0).concat(_descriptor_4.toValue(bondAmount_0).concat(_descriptor_5.toValue(now_0))),
            alignment: _descriptor_0.alignment().concat(_descriptor_4.alignment().concat(_descriptor_5.alignment()))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._openSettlementChallenge_0(context,
                                                         partialProofData,
                                                         quoteId_0,
                                                         bondAmount_0,
                                                         now_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      },
      recordSettlement: (...args_1) => {
        if (args_1.length !== 3) {
          throw new __compactRuntime.CompactError(`recordSettlement: expected 3 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const quoteId_0 = args_1[1];
        const challengeId_0 = args_1[2];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('recordSettlement',
                                     'argument 1 (as invoked from Typescript)',
                                     'OTCProtocol.compact line 252 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(quoteId_0.buffer instanceof ArrayBuffer && quoteId_0.BYTES_PER_ELEMENT === 1 && quoteId_0.length === 32)) {
          __compactRuntime.typeError('recordSettlement',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'OTCProtocol.compact line 252 char 1',
                                     'Bytes<32>',
                                     quoteId_0)
        }
        if (!(typeof(challengeId_0) === 'object' && typeof(challengeId_0.is_some) === 'boolean' && challengeId_0.value.buffer instanceof ArrayBuffer && challengeId_0.value.BYTES_PER_ELEMENT === 1 && challengeId_0.value.length === 32)) {
          __compactRuntime.typeError('recordSettlement',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'OTCProtocol.compact line 252 char 1',
                                     'struct Maybe<is_some: Boolean, value: Bytes<32>>',
                                     challengeId_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_0.toValue(quoteId_0).concat(_descriptor_11.toValue(challengeId_0)),
            alignment: _descriptor_0.alignment().concat(_descriptor_11.alignment())
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._recordSettlement_0(context,
                                                  partialProofData,
                                                  quoteId_0,
                                                  challengeId_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      },
      submitFraudProofMismatch: (...args_1) => {
        if (args_1.length !== 6) {
          throw new __compactRuntime.CompactError(`submitFraudProofMismatch: expected 6 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const quoteId_0 = args_1[1];
        const revealedTerms_0 = args_1[2];
        const revealedNonce_0 = args_1[3];
        const signature_0 = args_1[4];
        const beneficiary_0 = args_1[5];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('submitFraudProofMismatch',
                                     'argument 1 (as invoked from Typescript)',
                                     'OTCProtocol.compact line 291 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(quoteId_0.buffer instanceof ArrayBuffer && quoteId_0.BYTES_PER_ELEMENT === 1 && quoteId_0.length === 32)) {
          __compactRuntime.typeError('submitFraudProofMismatch',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'OTCProtocol.compact line 291 char 1',
                                     'Bytes<32>',
                                     quoteId_0)
        }
        if (!(Array.isArray(revealedTerms_0) && revealedTerms_0.length === 4 && revealedTerms_0.every((t) => typeof(t) === 'bigint' && t >= 0 && t <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('submitFraudProofMismatch',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'OTCProtocol.compact line 291 char 1',
                                     'Vector<4, Field>',
                                     revealedTerms_0)
        }
        if (!(revealedNonce_0.buffer instanceof ArrayBuffer && revealedNonce_0.BYTES_PER_ELEMENT === 1 && revealedNonce_0.length === 32)) {
          __compactRuntime.typeError('submitFraudProofMismatch',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'OTCProtocol.compact line 291 char 1',
                                     'Bytes<32>',
                                     revealedNonce_0)
        }
        if (!(typeof(signature_0) === 'object' && true && typeof(signature_0.response) === 'bigint' && signature_0.response >= 0 && signature_0.response <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('submitFraudProofMismatch',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'OTCProtocol.compact line 291 char 1',
                                     'struct SchnorrSignature<announcement: Opaque<"JubjubPoint">, response: Field>',
                                     signature_0)
        }
        if (!(beneficiary_0.buffer instanceof ArrayBuffer && beneficiary_0.BYTES_PER_ELEMENT === 1 && beneficiary_0.length === 32)) {
          __compactRuntime.typeError('submitFraudProofMismatch',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'OTCProtocol.compact line 291 char 1',
                                     'Bytes<32>',
                                     beneficiary_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_0.toValue(quoteId_0).concat(_descriptor_13.toValue(revealedTerms_0).concat(_descriptor_0.toValue(revealedNonce_0).concat(_descriptor_14.toValue(signature_0).concat(_descriptor_0.toValue(beneficiary_0))))),
            alignment: _descriptor_0.alignment().concat(_descriptor_13.alignment().concat(_descriptor_0.alignment().concat(_descriptor_14.alignment().concat(_descriptor_0.alignment()))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._submitFraudProofMismatch_0(context,
                                                          partialProofData,
                                                          quoteId_0,
                                                          revealedTerms_0,
                                                          revealedNonce_0,
                                                          signature_0,
                                                          beneficiary_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      },
      submitFraudProofTimeout: (...args_1) => {
        if (args_1.length !== 2) {
          throw new __compactRuntime.CompactError(`submitFraudProofTimeout: expected 2 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const challengeId_0 = args_1[1];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('submitFraudProofTimeout',
                                     'argument 1 (as invoked from Typescript)',
                                     'OTCProtocol.compact line 317 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(challengeId_0.buffer instanceof ArrayBuffer && challengeId_0.BYTES_PER_ELEMENT === 1 && challengeId_0.length === 32)) {
          __compactRuntime.typeError('submitFraudProofTimeout',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'OTCProtocol.compact line 317 char 1',
                                     'Bytes<32>',
                                     challengeId_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_0.toValue(challengeId_0),
            alignment: _descriptor_0.alignment()
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._submitFraudProofTimeout_0(context,
                                                         partialProofData,
                                                         challengeId_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      },
      attachDisclosureNote: (...args_1) => {
        if (args_1.length !== 5) {
          throw new __compactRuntime.CompactError(`attachDisclosureNote: expected 5 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const tradeId_0 = args_1[1];
        const ciphertextHash_0 = args_1[2];
        const policyTag_0 = args_1[3];
        const recipientHint_0 = args_1[4];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('attachDisclosureNote',
                                     'argument 1 (as invoked from Typescript)',
                                     'OTCProtocol.compact line 364 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(tradeId_0.buffer instanceof ArrayBuffer && tradeId_0.BYTES_PER_ELEMENT === 1 && tradeId_0.length === 32)) {
          __compactRuntime.typeError('attachDisclosureNote',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'OTCProtocol.compact line 364 char 1',
                                     'Bytes<32>',
                                     tradeId_0)
        }
        if (!(ciphertextHash_0.buffer instanceof ArrayBuffer && ciphertextHash_0.BYTES_PER_ELEMENT === 1 && ciphertextHash_0.length === 32)) {
          __compactRuntime.typeError('attachDisclosureNote',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'OTCProtocol.compact line 364 char 1',
                                     'Bytes<32>',
                                     ciphertextHash_0)
        }
        if (!(typeof(policyTag_0) === 'bigint' && policyTag_0 >= 0n && policyTag_0 <= 65535n)) {
          __compactRuntime.typeError('attachDisclosureNote',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'OTCProtocol.compact line 364 char 1',
                                     'Uint<0..65536>',
                                     policyTag_0)
        }
        if (!(recipientHint_0.buffer instanceof ArrayBuffer && recipientHint_0.BYTES_PER_ELEMENT === 1 && recipientHint_0.length === 32)) {
          __compactRuntime.typeError('attachDisclosureNote',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'OTCProtocol.compact line 364 char 1',
                                     'Bytes<32>',
                                     recipientHint_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_0.toValue(tradeId_0).concat(_descriptor_0.toValue(ciphertextHash_0).concat(_descriptor_1.toValue(policyTag_0).concat(_descriptor_0.toValue(recipientHint_0)))),
            alignment: _descriptor_0.alignment().concat(_descriptor_0.alignment().concat(_descriptor_1.alignment().concat(_descriptor_0.alignment())))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._attachDisclosureNote_0(context,
                                                      partialProofData,
                                                      tradeId_0,
                                                      ciphertextHash_0,
                                                      policyTag_0,
                                                      recipientHint_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      }
    };
    this.impureCircuits = {
      postBond: this.circuits.postBond,
      topUpBond: this.circuits.topUpBond,
      requestBondWithdrawal: this.circuits.requestBondWithdrawal,
      withdrawBond: this.circuits.withdrawBond,
      commitQuote: this.circuits.commitQuote,
      openSettlementChallenge: this.circuits.openSettlementChallenge,
      recordSettlement: this.circuits.recordSettlement,
      submitFraudProofMismatch: this.circuits.submitFraudProofMismatch,
      submitFraudProofTimeout: this.circuits.submitFraudProofTimeout,
      attachDisclosureNote: this.circuits.attachDisclosureNote
    };
    this.provableCircuits = {
      postBond: this.circuits.postBond,
      topUpBond: this.circuits.topUpBond,
      requestBondWithdrawal: this.circuits.requestBondWithdrawal,
      withdrawBond: this.circuits.withdrawBond,
      commitQuote: this.circuits.commitQuote,
      openSettlementChallenge: this.circuits.openSettlementChallenge,
      recordSettlement: this.circuits.recordSettlement,
      submitFraudProofMismatch: this.circuits.submitFraudProofMismatch,
      submitFraudProofTimeout: this.circuits.submitFraudProofTimeout,
      attachDisclosureNote: this.circuits.attachDisclosureNote
    };
  }
  initialState(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const constructorContext_0 = args_0[0];
    if (typeof(constructorContext_0) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'constructorContext' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!('initialPrivateState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialPrivateState' in argument 1 (as invoked from Typescript)`);
    }
    if (!('initialZswapLocalState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript)`);
    }
    if (typeof(constructorContext_0.initialZswapLocalState) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript) to be an object`);
    }
    const state_0 = new __compactRuntime.ContractState();
    let stateValue_0 = __compactRuntime.StateValue.newArray();
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    state_0.data = new __compactRuntime.ChargedState(stateValue_0);
    state_0.setOperation('postBond', new __compactRuntime.ContractOperation());
    state_0.setOperation('topUpBond', new __compactRuntime.ContractOperation());
    state_0.setOperation('requestBondWithdrawal', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdrawBond', new __compactRuntime.ContractOperation());
    state_0.setOperation('commitQuote', new __compactRuntime.ContractOperation());
    state_0.setOperation('openSettlementChallenge', new __compactRuntime.ContractOperation());
    state_0.setOperation('recordSettlement', new __compactRuntime.ContractOperation());
    state_0.setOperation('submitFraudProofMismatch', new __compactRuntime.ContractOperation());
    state_0.setOperation('submitFraudProofTimeout', new __compactRuntime.ContractOperation());
    state_0.setOperation('attachDisclosureNote', new __compactRuntime.ContractOperation());
    const context = __compactRuntime.createCircuitContext(__compactRuntime.dummyContractAddress(), constructorContext_0.initialZswapLocalState.coinPublicKey, state_0.data, constructorContext_0.initialPrivateState);
    const partialProofData = {
      input: { value: [], alignment: [] },
      output: undefined,
      publicTranscript: [],
      privateTranscriptOutputs: []
    };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_28.toValue(0n),
                                                                                              alignment: _descriptor_28.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_28.toValue(1n),
                                                                                              alignment: _descriptor_28.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_28.toValue(2n),
                                                                                              alignment: _descriptor_28.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_28.toValue(3n),
                                                                                              alignment: _descriptor_28.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_28.toValue(4n),
                                                                                              alignment: _descriptor_28.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_28.toValue(5n),
                                                                                              alignment: _descriptor_28.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_28.toValue(6n),
                                                                                              alignment: _descriptor_28.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(0n),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    state_0.data = new __compactRuntime.ChargedState(context.currentQueryContext.state.state);
    return {
      currentContractState: state_0,
      currentPrivateState: context.currentPrivateState,
      currentZswapLocalState: context.currentZswapLocalState
    }
  }
  _left_0(value_0) {
    return { is_left: true, left: value_0, right: new Uint8Array(32) };
  }
  _right_0(value_0) {
    return { is_left: false, left: { bytes: new Uint8Array(32) }, right: value_0 };
  }
  _blockTimeLt_0(context, partialProofData, time_0) {
    return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                     partialProofData,
                                                                     [
                                                                      { dup: { n: 2 } },
                                                                      { idx: { cached: true,
                                                                               pushPath: false,
                                                                               path: [
                                                                                      { tag: 'value',
                                                                                        value: { value: _descriptor_28.toValue(2n),
                                                                                                 alignment: _descriptor_28.alignment() } }] } },
                                                                      { push: { storage: false,
                                                                                value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(time_0),
                                                                                                                             alignment: _descriptor_5.alignment() }).encode() } },
                                                                      'lt',
                                                                      { popeq: { cached: true,
                                                                                 result: undefined } }]).value);
  }
  _blockTimeGte_0(context, partialProofData, time_0) {
    return !this._blockTimeLt_0(context, partialProofData, time_0);
  }
  _sendUnshielded_0(context, partialProofData, color_0, amount_0, recipient_0) {
    const tmp_0 = this._left_0(color_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(7n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_24.toValue(tmp_0),
                                                                                              alignment: _descriptor_24.alignment() }).encode() } },
                                       { dup: { n: 1 } },
                                       { dup: { n: 1 } },
                                       'member',
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(amount_0),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { swap: { n: 0 } },
                                       'neg',
                                       { branch: { skip: 4 } },
                                       { dup: { n: 2 } },
                                       { dup: { n: 2 } },
                                       { idx: { cached: true,
                                                pushPath: false,
                                                path: [ { tag: 'stack' }] } },
                                       'add',
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    const tmp_1 = this._left_0(color_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(8n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell(__compactRuntime.alignedConcat(
                                                                                              { value: _descriptor_24.toValue(tmp_1),
                                                                                                alignment: _descriptor_24.alignment() },
                                                                                              { value: _descriptor_27.toValue(recipient_0),
                                                                                                alignment: _descriptor_27.alignment() }
                                                                                            )).encode() } },
                                       { dup: { n: 1 } },
                                       { dup: { n: 1 } },
                                       'member',
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(amount_0),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { swap: { n: 0 } },
                                       'neg',
                                       { branch: { skip: 4 } },
                                       { dup: { n: 2 } },
                                       { dup: { n: 2 } },
                                       { idx: { cached: true,
                                                pushPath: false,
                                                path: [ { tag: 'stack' }] } },
                                       'add',
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    if (recipient_0.is_left
        &&
        this._equal_0(recipient_0.left.bytes,
                      _descriptor_25.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                 partialProofData,
                                                                                 [
                                                                                  { dup: { n: 2 } },
                                                                                  { idx: { cached: true,
                                                                                           pushPath: false,
                                                                                           path: [
                                                                                                  { tag: 'value',
                                                                                                    value: { value: _descriptor_28.toValue(0n),
                                                                                                             alignment: _descriptor_28.alignment() } }] } },
                                                                                  { popeq: { cached: true,
                                                                                             result: undefined } }]).value).bytes))
    {
      const tmp_2 = this._left_0(color_0);
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { swap: { n: 0 } },
                                         { idx: { cached: true,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_28.toValue(6n),
                                                                    alignment: _descriptor_28.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_24.toValue(tmp_2),
                                                                                                alignment: _descriptor_24.alignment() }).encode() } },
                                         { dup: { n: 1 } },
                                         { dup: { n: 1 } },
                                         'member',
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(amount_0),
                                                                                                alignment: _descriptor_4.alignment() }).encode() } },
                                         { swap: { n: 0 } },
                                         'neg',
                                         { branch: { skip: 4 } },
                                         { dup: { n: 2 } },
                                         { dup: { n: 2 } },
                                         { idx: { cached: true,
                                                  pushPath: false,
                                                  path: [ { tag: 'stack' }] } },
                                         'add',
                                         { ins: { cached: true, n: 2 } },
                                         { swap: { n: 0 } }]);
    }
    return [];
  }
  _receiveUnshielded_0(context, partialProofData, color_0, amount_0) {
    const tmp_0 = this._left_0(color_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(6n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_24.toValue(tmp_0),
                                                                                              alignment: _descriptor_24.alignment() }).encode() } },
                                       { dup: { n: 1 } },
                                       { dup: { n: 1 } },
                                       'member',
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(amount_0),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { swap: { n: 0 } },
                                       'neg',
                                       { branch: { skip: 4 } },
                                       { dup: { n: 2 } },
                                       { dup: { n: 2 } },
                                       { idx: { cached: true,
                                                pushPath: false,
                                                path: [ { tag: 'stack' }] } },
                                       'add',
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    return [];
  }
  _transientHash_0(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_13, value_0);
    return result_0;
  }
  _transientHash_1(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_23, value_0);
    return result_0;
  }
  _persistentHash_0(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_21, value_0);
    return result_0;
  }
  _persistentHash_1(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_22, value_0);
    return result_0;
  }
  _persistentHash_2(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_20, value_0);
    return result_0;
  }
  _persistentCommit_0(value_0, rand_0) {
    const result_0 = __compactRuntime.persistentCommit(_descriptor_13,
                                                       value_0,
                                                       rand_0);
    return result_0;
  }
  _jubjubPointX_0(np_0) {
    const result_0 = __compactRuntime.jubjubPointX(np_0);
    return result_0;
  }
  _jubjubPointY_0(np_0) {
    const result_0 = __compactRuntime.jubjubPointY(np_0);
    return result_0;
  }
  _ecAdd_0(a_0, b_0) {
    const result_0 = __compactRuntime.ecAdd(a_0, b_0);
    return result_0;
  }
  _ecMul_0(a_0, b_0) {
    const result_0 = __compactRuntime.ecMul(a_0, b_0);
    return result_0;
  }
  _ecMulGenerator_0(b_0) {
    const result_0 = __compactRuntime.ecMulGenerator(b_0);
    return result_0;
  }
  _getChallengeReduction_0(context, partialProofData, challenge_0) {
    const witnessContext_0 = __compactRuntime.createWitnessContext(ledger(context.currentQueryContext.state), context.currentPrivateState, context.currentQueryContext.address);
    const [nextPrivateState_0, result_0] = this.witnesses.getChallengeReduction(witnessContext_0,
                                                                                challenge_0);
    context.currentPrivateState = nextPrivateState_0;
    if (!(Array.isArray(result_0) && result_0.length === 3  && typeof(result_0[0]) === 'bigint' && result_0[0] >= 0n && result_0[0] <= 8n && typeof(result_0[1]) === 'bigint' && result_0[1] >= 0n && result_0[1] <= 14n && typeof(result_0[2]) === 'bigint' && result_0[2] >= 0n && result_0[2] <= 452312848583266388373324160190187140051835877600158453279131187530910662655n)) {
      __compactRuntime.typeError('getChallengeReduction',
                                 'return value',
                                 'schnorr.compact line 31 char 3',
                                 '[Uint<0..9>, Uint<0..15>, Uint<0..452312848583266388373324160190187140051835877600158453279131187530910662656>]',
                                 result_0)
    }
    partialProofData.privateTranscriptOutputs.push({
      value: _descriptor_19.toValue(result_0),
      alignment: _descriptor_19.alignment()
    });
    return result_0;
  }
  _schnorrChallenge_0(announcement_0, pk_0, msg_0) {
    const msgHash_0 = this._transientHash_0(msg_0);
    return this._transientHash_1([this._jubjubPointX_0(announcement_0),
                                  this._jubjubPointY_0(announcement_0),
                                  this._jubjubPointX_0(pk_0),
                                  this._jubjubPointY_0(pk_0),
                                  msgHash_0]);
  }
  _reduceToScalar_0(context, partialProofData, challenge_0) {
    const reduction_0 = this._getChallengeReduction_0(context,
                                                      partialProofData,
                                                      challenge_0);
    const q_0 = reduction_0[0];
    const remHi_0 = reduction_0[1];
    const remLo_0 = reduction_0[2];
    __compactRuntime.assert(remHi_0 < 14n
                            ||
                            remLo_0
                            <
                            222104516725044372704429320860625768980218979470098935457522536959433977015n,
                            'schnorr: challenge remainder not canonical (>= R)');
    const rem_0 = __compactRuntime.addField(__compactRuntime.mulField(remHi_0,
                                                                      452312848583266388373324160190187140051835877600158453279131187530910662656n),
                                            remLo_0);
    __compactRuntime.assert(__compactRuntime.addField(__compactRuntime.mulField(q_0,
                                                                                6554484396890773809930967563523245729705921265872317281365359162392183254199n),
                                                      rem_0)
                            ===
                            challenge_0,
                            'schnorr: bad challenge reduction');
    return rem_0;
  }
  _schnorrVerify_0(context, partialProofData, msg_0, signature_0, pk_0) {
    const c_0 = this._schnorrChallenge_0(signature_0.announcement, pk_0, msg_0);
    const cReduced_0 = this._reduceToScalar_0(context, partialProofData, c_0);
    const lhs_0 = this._ecMulGenerator_0(signature_0.response);
    const rhs_0 = this._ecAdd_0(signature_0.announcement,
                                this._ecMul_0(pk_0, cReduced_0));
    __compactRuntime.assert(this._jubjubPointX_0(lhs_0)
                            ===
                            this._jubjubPointX_0(rhs_0),
                            'schnorr: x mismatch');
    __compactRuntime.assert(this._jubjubPointY_0(lhs_0)
                            ===
                            this._jubjubPointY_0(rhs_0),
                            'schnorr: y mismatch');
    return [];
  }
  _SLASH_TAKER_BPS_0() { return 6000n; }
  _SLASH_PROVER_BPS_0() { return 1000n; }
  _BPS_DENOMINATOR_0() { return 10000n; }
  _MAX_QUOTE_VALIDITY_0() { return 900n; }
  _CHALLENGE_WINDOW_0() { return 600n; }
  _BOND_WITHDRAW_DELAY_0() { return 86400n; }
  _TIME_SLACK_0() { return 300n; }
  _PLACEHOLDER_MIN_BOND_0() { return 1n; }
  _PLACEHOLDER_MIN_CHALLENGE_BOND_0() { return 1n; }
  _dealerSecretKey_0(context, partialProofData) {
    const witnessContext_0 = __compactRuntime.createWitnessContext(ledger(context.currentQueryContext.state), context.currentPrivateState, context.currentQueryContext.address);
    const [nextPrivateState_0, result_0] = this.witnesses.dealerSecretKey(witnessContext_0);
    context.currentPrivateState = nextPrivateState_0;
    if (!(result_0.buffer instanceof ArrayBuffer && result_0.BYTES_PER_ELEMENT === 1 && result_0.length === 32)) {
      __compactRuntime.typeError('dealerSecretKey',
                                 'return value',
                                 'OTCProtocol.compact line 93 char 1',
                                 'Bytes<32>',
                                 result_0)
    }
    partialProofData.privateTranscriptOutputs.push({
      value: _descriptor_0.toValue(result_0),
      alignment: _descriptor_0.alignment()
    });
    return result_0;
  }
  _takerAddress_0(context, partialProofData) {
    const witnessContext_0 = __compactRuntime.createWitnessContext(ledger(context.currentQueryContext.state), context.currentPrivateState, context.currentQueryContext.address);
    const [nextPrivateState_0, result_0] = this.witnesses.takerAddress(witnessContext_0);
    context.currentPrivateState = nextPrivateState_0;
    if (!(result_0.buffer instanceof ArrayBuffer && result_0.BYTES_PER_ELEMENT === 1 && result_0.length === 32)) {
      __compactRuntime.typeError('takerAddress',
                                 'return value',
                                 'OTCProtocol.compact line 94 char 1',
                                 'Bytes<32>',
                                 result_0)
    }
    partialProofData.privateTranscriptOutputs.push({
      value: _descriptor_0.toValue(result_0),
      alignment: _descriptor_0.alignment()
    });
    return result_0;
  }
  _computeSlashShares_0(context, partialProofData, amount_0) {
    const witnessContext_0 = __compactRuntime.createWitnessContext(ledger(context.currentQueryContext.state), context.currentPrivateState, context.currentQueryContext.address);
    const [nextPrivateState_0, result_0] = this.witnesses.computeSlashShares(witnessContext_0,
                                                                             amount_0);
    context.currentPrivateState = nextPrivateState_0;
    if (!(Array.isArray(result_0) && result_0.length === 2  && typeof(result_0[0]) === 'bigint' && result_0[0] >= 0n && result_0[0] <= 340282366920938463463374607431768211455n && typeof(result_0[1]) === 'bigint' && result_0[1] >= 0n && result_0[1] <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('computeSlashShares',
                                 'return value',
                                 'OTCProtocol.compact line 103 char 1',
                                 '[Uint<0..340282366920938463463374607431768211456>, Uint<0..340282366920938463463374607431768211456>]',
                                 result_0)
    }
    partialProofData.privateTranscriptOutputs.push({
      value: _descriptor_15.toValue(result_0),
      alignment: _descriptor_15.alignment()
    });
    return result_0;
  }
  _dealerCommitment_0(sk_0) {
    return this._persistentHash_2([new Uint8Array([111, 116, 99, 58, 100, 101, 97, 108, 101, 114, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   sk_0]);
  }
  _deriveQuoteId_0(dealerCmt_0, rfqId_0, c_0) {
    return this._persistentHash_0([new Uint8Array([111, 116, 99, 58, 113, 117, 111, 116, 101, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   dealerCmt_0,
                                   rfqId_0,
                                   c_0]);
  }
  _deriveChallengeId_0(quoteId_0, taker_0) {
    return this._persistentHash_1([new Uint8Array([111, 116, 99, 58, 99, 104, 97, 108, 108, 101, 110, 103, 101, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   quoteId_0,
                                   taker_0]);
  }
  _postBond_0(context, partialProofData, amount_0, quotePk_0) {
    const cmt_0 = this._dealerCommitment_0(this._dealerSecretKey_0(context,
                                                                   partialProofData));
    __compactRuntime.assert(!_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_28.toValue(0n),
                                                                                                                   alignment: _descriptor_28.alignment() } }] } },
                                                                                        { push: { storage: false,
                                                                                                  value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                                                                               alignment: _descriptor_0.alignment() }).encode() } },
                                                                                        'member',
                                                                                        { popeq: { cached: true,
                                                                                                   result: undefined } }]).value),
                            'Dealer already bonded; use topUpBond');
    let t_0;
    __compactRuntime.assert((t_0 = amount_0,
                             t_0 >= this._PLACEHOLDER_MIN_BOND_0()),
                            'Bond below minimum');
    this._receiveUnshielded_0(context,
                              partialProofData,
                              new Uint8Array(32),
                              amount_0);
    const tmp_0 = { amount: amount_0,
                    quotePk: quotePk_0,
                    withdrawRequested: 0n,
                    liveQuotes: 0n,
                    openChallenges: 0n,
                    active: true };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(0n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(tmp_0),
                                                                                              alignment: _descriptor_10.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(1n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(0n),
                                                                                              alignment: _descriptor_5.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(2n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(0n),
                                                                                              alignment: _descriptor_5.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  _topUpBond_0(context, partialProofData, amount_0) {
    const cmt_0 = this._dealerCommitment_0(this._dealerSecretKey_0(context,
                                                                   partialProofData));
    __compactRuntime.assert(_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_28.toValue(0n),
                                                                                                                  alignment: _descriptor_28.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'Not a dealer');
    const b_0 = _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_28.toValue(0n),
                                                                                                       alignment: _descriptor_28.alignment() } }] } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_0.toValue(cmt_0),
                                                                                                       alignment: _descriptor_0.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    this._receiveUnshielded_0(context,
                              partialProofData,
                              new Uint8Array(32),
                              amount_0);
    const tmp_0 = { amount:
                      ((t1) => {
                        if (t1 > 340282366920938463463374607431768211455n) {
                          throw new __compactRuntime.CompactError('OTCProtocol.compact line 147 char 42: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 340282366920938463463374607431768211455');
                        }
                        return t1;
                      })(b_0.amount + amount_0),
                    quotePk: b_0.quotePk,
                    withdrawRequested: b_0.withdrawRequested,
                    liveQuotes: b_0.liveQuotes,
                    openChallenges: b_0.openChallenges,
                    active: b_0.active };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(0n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(tmp_0),
                                                                                              alignment: _descriptor_10.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  _requestBondWithdrawal_0(context, partialProofData, now_0) {
    const cmt_0 = this._dealerCommitment_0(this._dealerSecretKey_0(context,
                                                                   partialProofData));
    __compactRuntime.assert(_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_28.toValue(0n),
                                                                                                                  alignment: _descriptor_28.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'Not a dealer');
    const b_0 = _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_28.toValue(0n),
                                                                                                       alignment: _descriptor_28.alignment() } }] } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_0.toValue(cmt_0),
                                                                                                       alignment: _descriptor_0.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    const claimedNow_0 = now_0;
    __compactRuntime.assert(this._blockTimeGte_0(context,
                                                 partialProofData,
                                                 claimedNow_0),
                            'claimed time is in the future');
    __compactRuntime.assert(!this._blockTimeGte_0(context,
                                                  partialProofData,
                                                  ((t1) => {
                                                    if (t1 > 18446744073709551615n) {
                                                      throw new __compactRuntime.CompactError('OTCProtocol.compact line 163 char 24: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                                    }
                                                    return t1;
                                                  })(claimedNow_0
                                                     +
                                                     this._TIME_SLACK_0())),
                            'claimed time too far in the past');
    const tmp_0 = { amount: b_0.amount,
                    quotePk: b_0.quotePk,
                    withdrawRequested: claimedNow_0,
                    liveQuotes: b_0.liveQuotes,
                    openChallenges: b_0.openChallenges,
                    active: false };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(0n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(tmp_0),
                                                                                              alignment: _descriptor_10.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  _withdrawBond_0(context, partialProofData, recipient_0) {
    const cmt_0 = this._dealerCommitment_0(this._dealerSecretKey_0(context,
                                                                   partialProofData));
    __compactRuntime.assert(_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_28.toValue(0n),
                                                                                                                  alignment: _descriptor_28.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'Not a dealer');
    const b_0 = _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_28.toValue(0n),
                                                                                                       alignment: _descriptor_28.alignment() } }] } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_0.toValue(cmt_0),
                                                                                                       alignment: _descriptor_0.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    let t_0;
    __compactRuntime.assert((t_0 = b_0.withdrawRequested, t_0 > 0n),
                            'No withdrawal requested');
    __compactRuntime.assert(this._blockTimeGte_0(context,
                                                 partialProofData,
                                                 ((t1) => {
                                                   if (t1 > 18446744073709551615n) {
                                                     throw new __compactRuntime.CompactError('OTCProtocol.compact line 173 char 23: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                                   }
                                                   return t1;
                                                 })(b_0.withdrawRequested
                                                    +
                                                    this._BOND_WITHDRAW_DELAY_0())),
                            'Timelock not elapsed');
    __compactRuntime.assert(this._equal_1(b_0.openChallenges, 0n),
                            'Unresolved challenges outstanding');
    __compactRuntime.assert(this._equal_2(b_0.liveQuotes, 0n),
                            'Live quote commitments outstanding');
    this._sendUnshielded_0(context,
                           partialProofData,
                           new Uint8Array(32),
                           b_0.amount,
                           this._right_0({ bytes: recipient_0 }));
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(0n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { rem: { cached: false } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  _commitQuote_0(context, partialProofData, rfqId_0, commitment_0, validUntil_0)
  {
    const cmt_0 = this._dealerCommitment_0(this._dealerSecretKey_0(context,
                                                                   partialProofData));
    __compactRuntime.assert(_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_28.toValue(0n),
                                                                                                                  alignment: _descriptor_28.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'Not a dealer');
    const b_0 = _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_28.toValue(0n),
                                                                                                       alignment: _descriptor_28.alignment() } }] } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_0.toValue(cmt_0),
                                                                                                       alignment: _descriptor_0.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    __compactRuntime.assert(b_0.active,
                            'Dealer not active (withdrawing or unbonded)');
    let t_0;
    __compactRuntime.assert((t_0 = b_0.amount,
                             t_0 >= this._PLACEHOLDER_MIN_BOND_0()),
                            'Bond fell below minimum after slashing');
    const validUntilPub_0 = validUntil_0;
    __compactRuntime.assert(!this._blockTimeGte_0(context,
                                                  partialProofData,
                                                  validUntilPub_0),
                            'validUntil already past');
    __compactRuntime.assert(validUntilPub_0 >= this._MAX_QUOTE_VALIDITY_0(),
                            'validUntil implausibly small');
    let t_1;
    __compactRuntime.assert(this._blockTimeGte_0(context,
                                                 partialProofData,
                                                 (t_1 = this._MAX_QUOTE_VALIDITY_0(),
                                                  (__compactRuntime.assert(validUntilPub_0
                                                                           >=
                                                                           t_1,
                                                                           'result of subtraction would be negative'),
                                                   validUntilPub_0 - t_1))),
                            'Validity window too long');
    const qid_0 = this._deriveQuoteId_0(cmt_0, rfqId_0, commitment_0);
    __compactRuntime.assert(!_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_28.toValue(3n),
                                                                                                                   alignment: _descriptor_28.alignment() } }] } },
                                                                                        { push: { storage: false,
                                                                                                  value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(qid_0),
                                                                                                                                               alignment: _descriptor_0.alignment() }).encode() } },
                                                                                        'member',
                                                                                        { popeq: { cached: true,
                                                                                                   result: undefined } }]).value),
                            'Duplicate quote');
    const tmp_0 = { dealerCmt: cmt_0,
                    commitment: commitment_0,
                    validUntil: validUntil_0,
                    rfqId: rfqId_0,
                    resolved: false };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(3n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(qid_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_7.toValue(tmp_0),
                                                                                              alignment: _descriptor_7.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    const tmp_1 = { amount: b_0.amount,
                    quotePk: b_0.quotePk,
                    withdrawRequested: b_0.withdrawRequested,
                    liveQuotes:
                      ((t1) => {
                        if (t1 > 4294967295n) {
                          throw new __compactRuntime.CompactError('OTCProtocol.compact line 216 char 46: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 4294967295');
                        }
                        return t1;
                      })(b_0.liveQuotes + 1n),
                    openChallenges: b_0.openChallenges,
                    active: b_0.active };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(0n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(tmp_1),
                                                                                              alignment: _descriptor_10.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  _openSettlementChallenge_0(context,
                             partialProofData,
                             quoteId_0,
                             bondAmount_0,
                             now_0)
  {
    const qidPub_0 = quoteId_0;
    __compactRuntime.assert(_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_28.toValue(3n),
                                                                                                                  alignment: _descriptor_28.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(qidPub_0),
                                                                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'Unknown quote');
    const q_0 = _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                          partialProofData,
                                                                          [
                                                                           { dup: { n: 0 } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_28.toValue(3n),
                                                                                                      alignment: _descriptor_28.alignment() } }] } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_0.toValue(qidPub_0),
                                                                                                      alignment: _descriptor_0.alignment() } }] } },
                                                                           { popeq: { cached: false,
                                                                                      result: undefined } }]).value);
    __compactRuntime.assert(!q_0.resolved, 'Quote already resolved');
    __compactRuntime.assert(!this._blockTimeGte_0(context,
                                                  partialProofData,
                                                  q_0.validUntil),
                            'Quote expired — nothing to honor');
    let t_0;
    __compactRuntime.assert((t_0 = bondAmount_0,
                             t_0 >= this._PLACEHOLDER_MIN_CHALLENGE_BOND_0()),
                            'Challenge bond too small');
    this._receiveUnshielded_0(context,
                              partialProofData,
                              new Uint8Array(32),
                              bondAmount_0);
    const claimedNow_0 = now_0;
    __compactRuntime.assert(this._blockTimeGte_0(context,
                                                 partialProofData,
                                                 claimedNow_0),
                            'claimed time is in the future');
    __compactRuntime.assert(!this._blockTimeGte_0(context,
                                                  partialProofData,
                                                  ((t1) => {
                                                    if (t1 > 18446744073709551615n) {
                                                      throw new __compactRuntime.CompactError('OTCProtocol.compact line 231 char 24: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                                    }
                                                    return t1;
                                                  })(claimedNow_0
                                                     +
                                                     this._TIME_SLACK_0())),
                            'claimed time too far in the past');
    const taker_0 = this._takerAddress_0(context, partialProofData);
    const cid_0 = this._deriveChallengeId_0(qidPub_0, taker_0);
    __compactRuntime.assert(!_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_28.toValue(4n),
                                                                                                                   alignment: _descriptor_28.alignment() } }] } },
                                                                                        { push: { storage: false,
                                                                                                  value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cid_0),
                                                                                                                                               alignment: _descriptor_0.alignment() }).encode() } },
                                                                                        'member',
                                                                                        { popeq: { cached: true,
                                                                                                   result: undefined } }]).value),
                            'Challenge already open for this taker');
    const tmp_0 = { quoteId: qidPub_0,
                    takerAddr: taker_0,
                    bondAmount: bondAmount_0,
                    respondBy:
                      ((t1) => {
                        if (t1 > 18446744073709551615n) {
                          throw new __compactRuntime.CompactError('OTCProtocol.compact line 239 char 16: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                        }
                        return t1;
                      })(claimedNow_0 + this._CHALLENGE_WINDOW_0()),
                    resolved: false };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(4n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cid_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_6.toValue(tmp_0),
                                                                                              alignment: _descriptor_6.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    let tmp_1;
    const dealerBond_0 = (tmp_1 = q_0.dealerCmt,
                          _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                     partialProofData,
                                                                                     [
                                                                                      { dup: { n: 0 } },
                                                                                      { idx: { cached: false,
                                                                                               pushPath: false,
                                                                                               path: [
                                                                                                      { tag: 'value',
                                                                                                        value: { value: _descriptor_28.toValue(0n),
                                                                                                                 alignment: _descriptor_28.alignment() } }] } },
                                                                                      { idx: { cached: false,
                                                                                               pushPath: false,
                                                                                               path: [
                                                                                                      { tag: 'value',
                                                                                                        value: { value: _descriptor_0.toValue(tmp_1),
                                                                                                                 alignment: _descriptor_0.alignment() } }] } },
                                                                                      { popeq: { cached: false,
                                                                                                 result: undefined } }]).value));
    const tmp_2 = q_0.dealerCmt;
    const tmp_3 = { amount: dealerBond_0.amount,
                    quotePk: dealerBond_0.quotePk,
                    withdrawRequested: dealerBond_0.withdrawRequested,
                    liveQuotes: dealerBond_0.liveQuotes,
                    openChallenges:
                      ((t1) => {
                        if (t1 > 4294967295n) {
                          throw new __compactRuntime.CompactError('OTCProtocol.compact line 243 char 67: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 4294967295');
                        }
                        return t1;
                      })(dealerBond_0.openChallenges + 1n),
                    active: dealerBond_0.active };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(0n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_2),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(tmp_3),
                                                                                              alignment: _descriptor_10.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  _recordSettlement_0(context, partialProofData, quoteId_0, challengeId_0) {
    const cmt_0 = this._dealerCommitment_0(this._dealerSecretKey_0(context,
                                                                   partialProofData));
    const qidPub_0 = quoteId_0;
    __compactRuntime.assert(_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_28.toValue(3n),
                                                                                                                  alignment: _descriptor_28.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(qidPub_0),
                                                                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'Unknown quote');
    const q_0 = _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                          partialProofData,
                                                                          [
                                                                           { dup: { n: 0 } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_28.toValue(3n),
                                                                                                      alignment: _descriptor_28.alignment() } }] } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_0.toValue(qidPub_0),
                                                                                                      alignment: _descriptor_0.alignment() } }] } },
                                                                           { popeq: { cached: false,
                                                                                      result: undefined } }]).value);
    __compactRuntime.assert(this._equal_3(q_0.dealerCmt, cmt_0),
                            'Not your quote');
    __compactRuntime.assert(!q_0.resolved, 'Already resolved');
    const tmp_0 = { dealerCmt: q_0.dealerCmt,
                    commitment: q_0.commitment,
                    validUntil: q_0.validUntil,
                    rfqId: q_0.rfqId,
                    resolved: true };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(3n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(qidPub_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_7.toValue(tmp_0),
                                                                                              alignment: _descriptor_7.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    const b_0 = _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_28.toValue(0n),
                                                                                                       alignment: _descriptor_28.alignment() } }] } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_0.toValue(cmt_0),
                                                                                                       alignment: _descriptor_0.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    let t_0;
    const newLiveQuotes_0 = (t_0 = b_0.liveQuotes,
                             (__compactRuntime.assert(t_0 >= 1n,
                                                      'result of subtraction would be negative'),
                              t_0 - 1n));
    if (challengeId_0.is_some) {
      const cid_0 = challengeId_0.value;
      __compactRuntime.assert(_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                        partialProofData,
                                                                                        [
                                                                                         { dup: { n: 0 } },
                                                                                         { idx: { cached: false,
                                                                                                  pushPath: false,
                                                                                                  path: [
                                                                                                         { tag: 'value',
                                                                                                           value: { value: _descriptor_28.toValue(4n),
                                                                                                                    alignment: _descriptor_28.alignment() } }] } },
                                                                                         { push: { storage: false,
                                                                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cid_0),
                                                                                                                                                alignment: _descriptor_0.alignment() }).encode() } },
                                                                                         'member',
                                                                                         { popeq: { cached: true,
                                                                                                    result: undefined } }]).value),
                              'Unknown challenge');
      const c_0 = _descriptor_6.fromValue(__compactRuntime.queryLedgerState(context,
                                                                            partialProofData,
                                                                            [
                                                                             { dup: { n: 0 } },
                                                                             { idx: { cached: false,
                                                                                      pushPath: false,
                                                                                      path: [
                                                                                             { tag: 'value',
                                                                                               value: { value: _descriptor_28.toValue(4n),
                                                                                                        alignment: _descriptor_28.alignment() } }] } },
                                                                             { idx: { cached: false,
                                                                                      pushPath: false,
                                                                                      path: [
                                                                                             { tag: 'value',
                                                                                               value: { value: _descriptor_0.toValue(cid_0),
                                                                                                        alignment: _descriptor_0.alignment() } }] } },
                                                                             { popeq: { cached: false,
                                                                                        result: undefined } }]).value);
      __compactRuntime.assert(this._equal_4(c_0.quoteId, qidPub_0),
                              'Challenge does not match this quote');
      __compactRuntime.assert(!c_0.resolved, 'Challenge already resolved');
      const tmp_1 = { quoteId: c_0.quoteId,
                      takerAddr: c_0.takerAddr,
                      bondAmount: c_0.bondAmount,
                      respondBy: c_0.respondBy,
                      resolved: true };
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { idx: { cached: false,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_28.toValue(4n),
                                                                    alignment: _descriptor_28.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cid_0),
                                                                                                alignment: _descriptor_0.alignment() }).encode() } },
                                         { push: { storage: true,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_6.toValue(tmp_1),
                                                                                                alignment: _descriptor_6.alignment() }).encode() } },
                                         { ins: { cached: false, n: 1 } },
                                         { ins: { cached: true, n: 1 } }]);
      this._sendUnshielded_0(context,
                             partialProofData,
                             new Uint8Array(32),
                             c_0.bondAmount,
                             this._right_0({ bytes: cmt_0 }));
      let t_1;
      const tmp_2 = { amount: b_0.amount,
                      quotePk: b_0.quotePk,
                      withdrawRequested: b_0.withdrawRequested,
                      liveQuotes: newLiveQuotes_0,
                      openChallenges:
                        (t_1 = b_0.openChallenges,
                         (__compactRuntime.assert(t_1 >= 1n,
                                                  'result of subtraction would be negative'),
                          t_1 - 1n)),
                      active: b_0.active };
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { idx: { cached: false,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_28.toValue(0n),
                                                                    alignment: _descriptor_28.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                                alignment: _descriptor_0.alignment() }).encode() } },
                                         { push: { storage: true,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(tmp_2),
                                                                                                alignment: _descriptor_10.alignment() }).encode() } },
                                         { ins: { cached: false, n: 1 } },
                                         { ins: { cached: true, n: 1 } }]);
    } else {
      const tmp_3 = { amount: b_0.amount,
                      quotePk: b_0.quotePk,
                      withdrawRequested: b_0.withdrawRequested,
                      liveQuotes: newLiveQuotes_0,
                      openChallenges: b_0.openChallenges,
                      active: b_0.active };
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { idx: { cached: false,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_28.toValue(0n),
                                                                    alignment: _descriptor_28.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cmt_0),
                                                                                                alignment: _descriptor_0.alignment() }).encode() } },
                                         { push: { storage: true,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(tmp_3),
                                                                                                alignment: _descriptor_10.alignment() }).encode() } },
                                         { ins: { cached: false, n: 1 } },
                                         { ins: { cached: true, n: 1 } }]);
    }
    const tmp_4 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(1n),
                                                                  alignment: _descriptor_28.alignment() } },
                                                       { tag: 'value',
                                                         value: { value: _descriptor_0.toValue(cmt_0),
                                                                  alignment: _descriptor_0.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_1.toValue(tmp_4),
                                                                alignment: _descriptor_1.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 2 } }]);
    return [];
  }
  _submitFraudProofMismatch_0(context,
                              partialProofData,
                              quoteId_0,
                              revealedTerms_0,
                              revealedNonce_0,
                              signature_0,
                              beneficiary_0)
  {
    const qidPub_0 = quoteId_0;
    __compactRuntime.assert(_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_28.toValue(3n),
                                                                                                                  alignment: _descriptor_28.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(qidPub_0),
                                                                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'Unknown quote');
    const q_0 = _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                          partialProofData,
                                                                          [
                                                                           { dup: { n: 0 } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_28.toValue(3n),
                                                                                                      alignment: _descriptor_28.alignment() } }] } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_0.toValue(qidPub_0),
                                                                                                      alignment: _descriptor_0.alignment() } }] } },
                                                                           { popeq: { cached: false,
                                                                                      result: undefined } }]).value);
    __compactRuntime.assert(!q_0.resolved, 'Quote already resolved');
    let tmp_0;
    const b_0 = (tmp_0 = q_0.dealerCmt,
                 _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                            partialProofData,
                                                                            [
                                                                             { dup: { n: 0 } },
                                                                             { idx: { cached: false,
                                                                                      pushPath: false,
                                                                                      path: [
                                                                                             { tag: 'value',
                                                                                               value: { value: _descriptor_28.toValue(0n),
                                                                                                        alignment: _descriptor_28.alignment() } }] } },
                                                                             { idx: { cached: false,
                                                                                      pushPath: false,
                                                                                      path: [
                                                                                             { tag: 'value',
                                                                                               value: { value: _descriptor_0.toValue(tmp_0),
                                                                                                        alignment: _descriptor_0.alignment() } }] } },
                                                                             { popeq: { cached: false,
                                                                                        result: undefined } }]).value));
    this._schnorrVerify_0(context,
                          partialProofData,
                          revealedTerms_0,
                          signature_0,
                          b_0.quotePk);
    const recomputed_0 = this._persistentCommit_0(revealedTerms_0,
                                                  revealedNonce_0);
    __compactRuntime.assert(!this._equal_5(recomputed_0, q_0.commitment),
                            'Reveal matches commitment — no fraud');
    const tmp_1 = { dealerCmt: q_0.dealerCmt,
                    commitment: q_0.commitment,
                    validUntil: q_0.validUntil,
                    rfqId: q_0.rfqId,
                    resolved: true };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(3n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(qidPub_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_7.toValue(tmp_1),
                                                                                              alignment: _descriptor_7.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    this._slashBond_0(context, partialProofData, q_0.dealerCmt, beneficiary_0);
    return [];
  }
  _submitFraudProofTimeout_0(context, partialProofData, challengeId_0) {
    const cidPub_0 = challengeId_0;
    __compactRuntime.assert(_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_28.toValue(4n),
                                                                                                                  alignment: _descriptor_28.alignment() } }] } },
                                                                                       { push: { storage: false,
                                                                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cidPub_0),
                                                                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                                                                       'member',
                                                                                       { popeq: { cached: true,
                                                                                                  result: undefined } }]).value),
                            'Unknown challenge');
    const c_0 = _descriptor_6.fromValue(__compactRuntime.queryLedgerState(context,
                                                                          partialProofData,
                                                                          [
                                                                           { dup: { n: 0 } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_28.toValue(4n),
                                                                                                      alignment: _descriptor_28.alignment() } }] } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_0.toValue(cidPub_0),
                                                                                                      alignment: _descriptor_0.alignment() } }] } },
                                                                           { popeq: { cached: false,
                                                                                      result: undefined } }]).value);
    __compactRuntime.assert(!c_0.resolved, 'Challenge already resolved');
    __compactRuntime.assert(this._blockTimeGte_0(context,
                                                 partialProofData,
                                                 c_0.respondBy),
                            'Response window still open');
    let tmp_0;
    __compactRuntime.assert((tmp_0 = c_0.quoteId,
                             _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_28.toValue(3n),
                                                                                                                   alignment: _descriptor_28.alignment() } }] } },
                                                                                        { push: { storage: false,
                                                                                                  value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_0),
                                                                                                                                               alignment: _descriptor_0.alignment() }).encode() } },
                                                                                        'member',
                                                                                        { popeq: { cached: true,
                                                                                                   result: undefined } }]).value)),
                            'Unknown quote');
    let tmp_1;
    const q_0 = (tmp_1 = c_0.quoteId,
                 _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_28.toValue(3n),
                                                                                                       alignment: _descriptor_28.alignment() } }] } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_0.toValue(tmp_1),
                                                                                                       alignment: _descriptor_0.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value));
    const dealerCmt_0 = q_0.dealerCmt;
    this._sendUnshielded_0(context,
                           partialProofData,
                           new Uint8Array(32),
                           c_0.bondAmount,
                           this._right_0({ bytes: c_0.takerAddr }));
    const tmp_2 = { quoteId: c_0.quoteId,
                    takerAddr: c_0.takerAddr,
                    bondAmount: c_0.bondAmount,
                    respondBy: c_0.respondBy,
                    resolved: true };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(4n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(cidPub_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_6.toValue(tmp_2),
                                                                                              alignment: _descriptor_6.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    const tmp_3 = c_0.quoteId;
    const tmp_4 = { dealerCmt: q_0.dealerCmt,
                    commitment: q_0.commitment,
                    validUntil: q_0.validUntil,
                    rfqId: q_0.rfqId,
                    resolved: true };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(3n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_3),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_7.toValue(tmp_4),
                                                                                              alignment: _descriptor_7.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    this._slashBond_0(context, partialProofData, dealerCmt_0, c_0.takerAddr);
    return [];
  }
  _slashBond_0(context, partialProofData, dealerCmt_0, beneficiary_0) {
    const b_0 = _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_28.toValue(0n),
                                                                                                       alignment: _descriptor_28.alignment() } }] } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_0.toValue(dealerCmt_0),
                                                                                                       alignment: _descriptor_0.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    const shares_0 = this._computeSlashShares_0(context,
                                                partialProofData,
                                                b_0.amount);
    const takerCut_0 = shares_0[0];
    const proverCut_0 = shares_0[1];
    let t_0;
    __compactRuntime.assert((t_0 = takerCut_0 * this._BPS_DENOMINATOR_0(),
                             t_0 <= b_0.amount * this._SLASH_TAKER_BPS_0()),
                            'taker cut too high');
    let t_1;
    __compactRuntime.assert((t_1 = (takerCut_0 + 1n) * this._BPS_DENOMINATOR_0(),
                             t_1 > b_0.amount * this._SLASH_TAKER_BPS_0()),
                            'taker cut not maximal');
    let t_2;
    __compactRuntime.assert((t_2 = proverCut_0 * this._BPS_DENOMINATOR_0(),
                             t_2 <= b_0.amount * this._SLASH_PROVER_BPS_0()),
                            'prover cut too high');
    let t_3;
    __compactRuntime.assert((t_3 = (proverCut_0 + 1n)
                                   *
                                   this._BPS_DENOMINATOR_0(),
                             t_3 > b_0.amount * this._SLASH_PROVER_BPS_0()),
                            'prover cut not maximal');
    let t_4, t_5;
    const burnCut_0 = (t_4 = (t_5 = b_0.amount,
                              (__compactRuntime.assert(t_5 >= takerCut_0,
                                                       'result of subtraction would be negative'),
                               t_5 - takerCut_0)),
                       (__compactRuntime.assert(t_4 >= proverCut_0,
                                                'result of subtraction would be negative'),
                        t_4 - proverCut_0));
    this._sendUnshielded_0(context,
                           partialProofData,
                           new Uint8Array(32),
                           takerCut_0,
                           this._right_0({ bytes: beneficiary_0 }));
    const prover_0 = this._takerAddress_0(context, partialProofData);
    this._sendUnshielded_0(context,
                           partialProofData,
                           new Uint8Array(32),
                           proverCut_0,
                           this._right_0({ bytes: prover_0 }));
    const tmp_0 = ((t1) => {
                    if (t1 > 340282366920938463463374607431768211455n) {
                      throw new __compactRuntime.CompactError('OTCProtocol.compact line 354 char 17: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 340282366920938463463374607431768211455');
                    }
                    return t1;
                  })(_descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                               partialProofData,
                                                                               [
                                                                                { dup: { n: 0 } },
                                                                                { idx: { cached: false,
                                                                                         pushPath: false,
                                                                                         path: [
                                                                                                { tag: 'value',
                                                                                                  value: { value: _descriptor_28.toValue(6n),
                                                                                                           alignment: _descriptor_28.alignment() } }] } },
                                                                                { popeq: { cached: false,
                                                                                           result: undefined } }]).value)
                     +
                     burnCut_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_28.toValue(6n),
                                                                                              alignment: _descriptor_28.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(tmp_0),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = { amount: 0n,
                    quotePk: b_0.quotePk,
                    withdrawRequested: b_0.withdrawRequested,
                    liveQuotes: b_0.liveQuotes,
                    openChallenges: b_0.openChallenges,
                    active: false };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(0n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(dealerCmt_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(tmp_1),
                                                                                              alignment: _descriptor_10.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    const tmp_2 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(2n),
                                                                  alignment: _descriptor_28.alignment() } },
                                                       { tag: 'value',
                                                         value: { value: _descriptor_0.toValue(dealerCmt_0),
                                                                  alignment: _descriptor_0.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_1.toValue(tmp_2),
                                                                alignment: _descriptor_1.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 2 } }]);
    return [];
  }
  _attachDisclosureNote_0(context,
                          partialProofData,
                          tradeId_0,
                          ciphertextHash_0,
                          policyTag_0,
                          recipientHint_0)
  {
    __compactRuntime.assert(!_descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_28.toValue(5n),
                                                                                                                   alignment: _descriptor_28.alignment() } }] } },
                                                                                        { push: { storage: false,
                                                                                                  value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tradeId_0),
                                                                                                                                               alignment: _descriptor_0.alignment() }).encode() } },
                                                                                        'member',
                                                                                        { popeq: { cached: true,
                                                                                                   result: undefined } }]).value),
                            'Note already attached');
    const tmp_0 = { ciphertextHash: ciphertextHash_0,
                    policyTag: policyTag_0,
                    recipientHint: recipientHint_0 };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_28.toValue(5n),
                                                                  alignment: _descriptor_28.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tradeId_0),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_2.toValue(tmp_0),
                                                                                              alignment: _descriptor_2.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  _equal_0(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_1(x0, y0) {
    if (x0 !== y0) { return false; }
    return true;
  }
  _equal_2(x0, y0) {
    if (x0 !== y0) { return false; }
    return true;
  }
  _equal_3(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_4(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_5(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
}
export function ledger(stateOrChargedState) {
  const state = stateOrChargedState instanceof __compactRuntime.StateValue ? stateOrChargedState : stateOrChargedState.state;
  const chargedState = stateOrChargedState instanceof __compactRuntime.StateValue ? new __compactRuntime.ChargedState(stateOrChargedState) : stateOrChargedState;
  const context = {
    currentQueryContext: new __compactRuntime.QueryContext(chargedState, __compactRuntime.dummyContractAddress()),
    costModel: __compactRuntime.CostModel.initialCostModel()
  };
  const partialProofData = {
    input: { value: [], alignment: [] },
    output: undefined,
    publicTranscript: [],
    privateTranscriptOutputs: []
  };
  return {
    bonds: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(0n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(0n),
                                                                                                                                 alignment: _descriptor_5.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(0n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'OTCProtocol.compact line 81 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(0n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(key_0),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'OTCProtocol.compact line 81 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_10.fromValue(__compactRuntime.queryLedgerState(context,
                                                                          partialProofData,
                                                                          [
                                                                           { dup: { n: 0 } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_28.toValue(0n),
                                                                                                      alignment: _descriptor_28.alignment() } }] } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_0.toValue(key_0),
                                                                                                      alignment: _descriptor_0.alignment() } }] } },
                                                                           { popeq: { cached: false,
                                                                                      result: undefined } }]).value);
      },
      [Symbol.iterator](...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`iter: expected 0 arguments, received ${args_0.length}`);
        }
        const self_0 = state.asArray()[0];
        return self_0.asMap().keys().map(  (key) => {    const value = self_0.asMap().get(key).asCell();    return [      _descriptor_0.fromValue(key.value),      _descriptor_10.fromValue(value.value)    ];  })[Symbol.iterator]();
      }
    },
    settled: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(1n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(0n),
                                                                                                                                 alignment: _descriptor_5.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(1n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'OTCProtocol.compact line 82 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(1n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(key_0),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'OTCProtocol.compact line 82 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        if (state.asArray()[1].asMap().get({ value: _descriptor_0.toValue(key_0),
                                             alignment: _descriptor_0.alignment() }) === undefined) {
          throw new __compactRuntime.CompactError(`Map value undefined for ${key_0}`);
        }
        return {
          read(...args_1) {
            if (args_1.length !== 0) {
              throw new __compactRuntime.CompactError(`read: expected 0 arguments, received ${args_1.length}`);
            }
            return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                             partialProofData,
                                                                             [
                                                                              { dup: { n: 0 } },
                                                                              { idx: { cached: false,
                                                                                       pushPath: false,
                                                                                       path: [
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_28.toValue(1n),
                                                                                                         alignment: _descriptor_28.alignment() } },
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_0.toValue(key_0),
                                                                                                         alignment: _descriptor_0.alignment() } }] } },
                                                                              { popeq: { cached: true,
                                                                                         result: undefined } }]).value);
          }
        }
      }
    },
    slashed: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(2n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(0n),
                                                                                                                                 alignment: _descriptor_5.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(2n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'OTCProtocol.compact line 83 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(2n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(key_0),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'OTCProtocol.compact line 83 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        if (state.asArray()[2].asMap().get({ value: _descriptor_0.toValue(key_0),
                                             alignment: _descriptor_0.alignment() }) === undefined) {
          throw new __compactRuntime.CompactError(`Map value undefined for ${key_0}`);
        }
        return {
          read(...args_1) {
            if (args_1.length !== 0) {
              throw new __compactRuntime.CompactError(`read: expected 0 arguments, received ${args_1.length}`);
            }
            return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                             partialProofData,
                                                                             [
                                                                              { dup: { n: 0 } },
                                                                              { idx: { cached: false,
                                                                                       pushPath: false,
                                                                                       path: [
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_28.toValue(2n),
                                                                                                         alignment: _descriptor_28.alignment() } },
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_0.toValue(key_0),
                                                                                                         alignment: _descriptor_0.alignment() } }] } },
                                                                              { popeq: { cached: true,
                                                                                         result: undefined } }]).value);
          }
        }
      }
    },
    quotes: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(3n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(0n),
                                                                                                                                 alignment: _descriptor_5.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(3n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'OTCProtocol.compact line 84 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(3n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(key_0),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'OTCProtocol.compact line 84 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(3n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_0.toValue(key_0),
                                                                                                     alignment: _descriptor_0.alignment() } }] } },
                                                                          { popeq: { cached: false,
                                                                                     result: undefined } }]).value);
      },
      [Symbol.iterator](...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`iter: expected 0 arguments, received ${args_0.length}`);
        }
        const self_0 = state.asArray()[3];
        return self_0.asMap().keys().map(  (key) => {    const value = self_0.asMap().get(key).asCell();    return [      _descriptor_0.fromValue(key.value),      _descriptor_7.fromValue(value.value)    ];  })[Symbol.iterator]();
      }
    },
    challenges: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(4n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(0n),
                                                                                                                                 alignment: _descriptor_5.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(4n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'OTCProtocol.compact line 85 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(4n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(key_0),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'OTCProtocol.compact line 85 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_6.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(4n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_0.toValue(key_0),
                                                                                                     alignment: _descriptor_0.alignment() } }] } },
                                                                          { popeq: { cached: false,
                                                                                     result: undefined } }]).value);
      },
      [Symbol.iterator](...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`iter: expected 0 arguments, received ${args_0.length}`);
        }
        const self_0 = state.asArray()[4];
        return self_0.asMap().keys().map(  (key) => {    const value = self_0.asMap().get(key).asCell();    return [      _descriptor_0.fromValue(key.value),      _descriptor_6.fromValue(value.value)    ];  })[Symbol.iterator]();
      }
    },
    notes: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(5n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(0n),
                                                                                                                                 alignment: _descriptor_5.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(5n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'OTCProtocol.compact line 86 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(5n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(key_0),
                                                                                                                                 alignment: _descriptor_0.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'OTCProtocol.compact line 86 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        return _descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_28.toValue(5n),
                                                                                                     alignment: _descriptor_28.alignment() } }] } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_0.toValue(key_0),
                                                                                                     alignment: _descriptor_0.alignment() } }] } },
                                                                          { popeq: { cached: false,
                                                                                     result: undefined } }]).value);
      },
      [Symbol.iterator](...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`iter: expected 0 arguments, received ${args_0.length}`);
        }
        const self_0 = state.asArray()[5];
        return self_0.asMap().keys().map(  (key) => {    const value = self_0.asMap().get(key).asCell();    return [      _descriptor_0.fromValue(key.value),      _descriptor_2.fromValue(value.value)    ];  })[Symbol.iterator]();
      }
    },
    get burnedTotal() {
      return _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_28.toValue(6n),
                                                                                                   alignment: _descriptor_28.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    }
  };
}
const _emptyContext = {
  currentQueryContext: new __compactRuntime.QueryContext(new __compactRuntime.ContractState().data, __compactRuntime.dummyContractAddress())
};
const _dummyContract = new Contract({
  getChallengeReduction: (...args) => undefined,
  dealerSecretKey: (...args) => undefined,
  takerAddress: (...args) => undefined,
  computeSlashShares: (...args) => undefined
});
export const pureCircuits = {};
export const contractReferenceLocations =
  { tag: 'publicLedgerArray', indices: { } };
//# sourceMappingURL=index.js.map
