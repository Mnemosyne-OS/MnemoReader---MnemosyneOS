/**
 * ReaderAgentActions — serves MnemoReader's agent actions (doc 149) while the
 * window is open. A CHILD that renders nothing, never a hook in App: App stays
 * mounted on the person's board, and a hook added to it breaks its hook order
 * under hot reload. The handlers live in lib/agent.ts; this keeps their view of
 * the App fresh (a ref written every render) and subscribes ONCE.
 */
import { useEffect, useRef } from 'react';
import { isFramed, sdk } from '../lib/bridge';
import { readerAgentHandlers, type ReaderAgentContext } from '../lib/agent';
import { readerTransport } from '../lib/readerTransport';
import type { ReaderSettings } from '../lib/types';

type Props = Omit<ReaderAgentContext, 'framed' | 'reader' | 'savedSettings'>;

/** The settings as useLocalStorage wrote them (its key), or null when absent or unreadable. */
function savedSettings(): ReaderSettings | null {
  try {
    const raw = localStorage.getItem('mnemoreader.settings');
    return raw ? (JSON.parse(raw) as ReaderSettings) : null;
  } catch (err) {
    console.warn('[MnemoReader] saved settings unreadable:', err instanceof Error ? err.message : err);
    return null;
  }
}

export function ReaderAgentActions(props: Props) {
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    // Outside the shell nobody calls (a plain tab, the tests).
    if (!isFramed()) return undefined;
    if (typeof sdk.onAgentActions !== 'function') {
      // An iframe served an older SDK build: it must not take the window down.
      console.warn('[MnemoReader] this SDK build has no onAgentActions; reload the cartridge to serve agent actions');
      return undefined;
    }
    const sub = sdk.onAgentActions(readerAgentHandlers(() => ({ ...latest.current, framed: isFramed(), reader: readerTransport(), savedSettings })));
    sub.ready.catch((err: unknown) => console.warn('[MnemoReader] agent actions not served:', err instanceof Error ? err.message : err));
    return () => sub.off();
  }, []);

  return null;
}
