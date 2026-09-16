import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import { toast } from '../design/primitives';
import type { NoticeAction } from '../state/notifications';
import { useOverlays } from '../state/overlays';
import { isTerminal, useRfq } from '../state/rfq';
import { engineFor } from '../state/trade-runtime';

/** Runs a notification-centre button. Nothing here settles: a quote action opens Compare with that
 *  quote selected, so its cautions are on screen before the user presses Settle. */
export function useNoticeActions() {
  const ports = useData();
  const navigate = useNavigate();
  const show = useOverlays((s) => s.show);
  const showFor = useOverlays((s) => s.showFor);
  const close = useOverlays((s) => s.close);

  return useCallback(
    (action: NoticeAction) => {
      const { state, dispatch } = useRfq.getState();
      const now = Math.floor(ports.clock.nowMs() / 1000);
      const openTrade = () => {
        close();
        navigate('/trade');
      };
      switch (action.type) {
        case 'open-trade':
          if (action.view === 'compare' && state.phase === 'sealed') dispatch({ type: 'to-compare', at: now });
          else if (action.view) dispatch({ type: 'view', view: action.view });
          if (action.quoteId) dispatch({ type: 'select', quoteId: action.quoteId });
          openTrade();
          break;
        case 'retry-quote':
          dispatch({ type: 'retry-with', quoteId: action.quoteId, at: now });
          openTrade();
          break;
        case 'fraud-proof':
          showFor('fraud-proof', { quoteId: action.quoteId });
          break;
        case 'attach-note':
          showFor('disclosure', { quoteId: action.quoteId });
          break;
        case 'open-receipt':
          close();
          navigate(`/trade/${action.quoteId}`);
          break;
        case 'save-evidence':
          if (engineFor(ports)?.saveEvidence()) toast({ tone: 'ok', title: 'Evidence saved', body: 'The file holds the signed reveal and the Offer File. Anyone can check it on Verify.' });
          else openTrade();
          break;
        case 'ask-again': {
          if (isTerminal(state.phase)) dispatch({ type: 'reset', pair: state.rfq?.pair ?? state.form.pair });
          else {
            const engine = engineFor(ports);
            if (engine) engine.cancel();
            else dispatch({ type: 'cancel', at: now });
          }
          openTrade();
          break;
        }
        case 'manage-relays':
          show('relays');
          break;
        case 'connect-wallet':
          show('connect');
          break;
        case 'become-dealer':
          close();
          navigate('/deal');
          break;
      }
    },
    [ports, navigate, show, showFor, close],
  );
}
