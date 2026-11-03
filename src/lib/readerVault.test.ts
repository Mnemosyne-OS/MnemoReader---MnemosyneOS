// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { HOST_CALL_MS, readerVaultTransport } from './readerVault';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('gives up on a host call after 15 s instead of the SDK 300 s', async () => {
  vi.useFakeTimers();
  // The number itself, not HOST_CALL_MS: a test advancing by the constant
  // passed just as well with 300 s (logic review, M07).
  expect(HOST_CALL_MS).toBe(15_000);
  const api = readerVaultTransport(() => new Promise(() => {}));
  let settled = false;
  const pending = api.list('APP-MNEMO-READER').finally(() => { settled = true; });
  const verdict = expect(pending).rejects.toThrow('TIMEOUT: social.query');
  await vi.advanceTimersByTimeAsync(14_999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await verdict;
});

it('refuses a write that returns no id, and leaves malformed rows out of a listing', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const invoke = vi.fn((action: string) =>
    Promise.resolve(action === 'social.ingest' ? {} : { chronicles: [{ id: '7', content: 'kept' }, { id: 'x', content: 'bad' }, { id: 8 }] }));
  const api = readerVaultTransport(invoke);
  await expect(api.write('APP-MNEMO-READER', 'text', 'READER_BOOK', 'ref')).rejects.toThrow('no entry ID');
  expect(await api.list('APP-MNEMO-READER')).toEqual({ rows: [{ id: 7, content: 'kept' }], complete: true });
});

it('reads the forget envelope, which does not reject on a refusal', async () => {
  const api = readerVaultTransport(() => Promise.resolve({ success: false, error: 'FOREIGN_APP_VAULT' }));
  expect(await api.forget([1])).toEqual({ success: false, error: 'FOREIGN_APP_VAULT' });
});
