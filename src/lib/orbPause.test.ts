import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetOrbPauseForTests, handleOrbState } from './orbPause';
import { publishReaderTransport, withdrawReaderTransport } from './readerTransport';
import type { ReaderPlayer } from './voice';

/** The slice of ReaderPlayer this module touches. */
function fakePlayer(state: 'idle' | 'playing' | 'paused' | 'buffering' = 'playing') {
  const p = {
    state,
    currentIndex: 4,
    pause: vi.fn(() => { p.state = 'paused'; }),
    resume: vi.fn(() => { p.state = 'playing'; }),
  };
  publishReaderTransport({
    bookId: 'b', player: p as unknown as ReaderPlayer, sentences: [],
    voice: () => ({ engineLabel: 'x', speedRange: null, sleepRemaining: null }),
  });
  return p;
}

let last: { player: unknown } | null = null;
afterEach(() => {
  __resetOrbPauseForTests();
  if (last) withdrawReaderTransport(last.player as ReaderPlayer);
  last = null;
});
const track = <T extends object>(p: T): T => { last = { player: p }; return p; };

describe('the reading under the orb', () => {
  it('pauses a reading while the orb is active and resumes it after', () => {
    const p = track(fakePlayer('playing'));
    handleOrbState(true);
    expect(p.pause).toHaveBeenCalledTimes(1);
    handleOrbState(false);
    expect(p.resume).toHaveBeenCalledTimes(1);
  });

  it('pauses a reading that is buffering too', () => {
    const p = track(fakePlayer('buffering'));
    handleOrbState(true);
    expect(p.pause).toHaveBeenCalledTimes(1);
  });

  it('never resumes a book the person had paused', () => {
    const p = track(fakePlayer('paused'));
    handleOrbState(true);
    handleOrbState(false);
    expect(p.pause).not.toHaveBeenCalled();
    expect(p.resume).not.toHaveBeenCalled();
  });

  it('a repeated state does nothing twice', () => {
    const p = track(fakePlayer('playing'));
    handleOrbState(true);
    handleOrbState(true);
    handleOrbState(false);
    handleOrbState(false);
    expect(p.pause).toHaveBeenCalledTimes(1);
    expect(p.resume).toHaveBeenCalledTimes(1);
  });

  it('the person moved the reading during the pause: their gesture wins', () => {
    const p = track(fakePlayer('playing'));
    handleOrbState(true);
    p.currentIndex = 9; // they jumped to another sentence
    handleOrbState(false);
    expect(p.resume).not.toHaveBeenCalled();
  });

  it('the person pressed play during the pause: nothing is resumed on top', () => {
    const p = track(fakePlayer('playing'));
    handleOrbState(true);
    p.state = 'playing';
    handleOrbState(false);
    expect(p.resume).not.toHaveBeenCalled();
  });

  it('the reader closed during the pause: nothing is resumed', () => {
    const p = track(fakePlayer('playing'));
    handleOrbState(true);
    withdrawReaderTransport(p as unknown as ReaderPlayer);
    handleOrbState(false);
    expect(p.resume).not.toHaveBeenCalled();
  });

  it('no reader on screen: nothing happens', () => {
    expect(() => { handleOrbState(true); handleOrbState(false); }).not.toThrow();
  });
});
