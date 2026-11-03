import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RETRY_FIRST_MS, RETRY_MAX_MS, serialized, syncLoop } from './syncLoop';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const HOUR = 3_600_000;

it('runs once per change and never polls after a success', async () => {
  const pass = vi.fn(() => Promise.resolve(null));
  const loop = syncLoop(pass, 1200);
  loop.kick();
  loop.kick();
  await vi.advanceTimersByTimeAsync(1200);
  expect(pass).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(HOUR);
  expect(pass).toHaveBeenCalledTimes(1);
  loop.stop();
});

it('backs off on the same failure, doubling up to 10 minutes', async () => {
  const pass = vi.fn(() => Promise.resolve('PROMPT_INJECTION_DETECTED'));
  const loop = syncLoop(pass, 0);
  loop.kick();
  await vi.advanceTimersByTimeAsync(0);
  const times: number[] = [];
  let last = Date.now();
  for (let i = 0; i < 6; i++) {
    const before = pass.mock.calls.length;
    while (pass.mock.calls.length === before) await vi.advanceTimersByTimeAsync(1000);
    times.push(Date.now() - last);
    last = Date.now();
  }
  expect(times).toEqual([RETRY_FIRST_MS, 2 * RETRY_FIRST_MS, 4 * RETRY_FIRST_MS, 8 * RETRY_FIRST_MS, RETRY_MAX_MS, RETRY_MAX_MS]);
  loop.stop();
});

it('starts again at one minute on a different failure, and at once on a kick', async () => {
  const answers = ['A', 'A', 'B'];
  const pass = vi.fn(() => Promise.resolve(answers.shift() ?? 'B'));
  const loop = syncLoop(pass, 0);
  loop.kick();
  await vi.advanceTimersByTimeAsync(0); // A
  await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS); // A again
  await vi.advanceTimersByTimeAsync(2 * RETRY_FIRST_MS); // B: different
  expect(pass).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
  expect(pass).toHaveBeenCalledTimes(4);
  loop.kick();
  await vi.advanceTimersByTimeAsync(0);
  expect(pass).toHaveBeenCalledTimes(5);
  // The kick forgot the backoff: the same failure is retried after 1 minute again.
  await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
  expect(pass).toHaveBeenCalledTimes(6);
  loop.stop();
});

it('stop during a failing pass leaves no retry behind', async () => {
  let release: () => void = () => {};
  const pass = vi.fn(async () => {
    await new Promise<void>((r) => (release = r));
    return 'offline';
  });
  const loop = syncLoop(pass, 0);
  loop.kick();
  await vi.advanceTimersByTimeAsync(0);
  loop.stop();
  release();
  await vi.advanceTimersByTimeAsync(HOUR);
  expect(pass).toHaveBeenCalledTimes(1);
});

it('never overlaps passes: a kick during a pass runs one more after it', async () => {
  let release: () => void = () => {};
  let active = 0;
  let overlap = false;
  const pass = vi.fn(async () => {
    active++;
    if (active > 1) overlap = true;
    await new Promise<void>((r) => (release = r));
    active--;
    return null;
  });
  const loop = syncLoop(pass, 0);
  loop.kick();
  await vi.advanceTimersByTimeAsync(0);
  loop.kick();
  loop.kick();
  await vi.advanceTimersByTimeAsync(0);
  expect(pass).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(pass).toHaveBeenCalledTimes(2);
  release();
  await vi.advanceTimersByTimeAsync(HOUR);
  expect(pass).toHaveBeenCalledTimes(2);
  expect(overlap).toBe(false);
  loop.stop();
});

it('a thrown pass counts as a failure, and stop cancels the retry', async () => {
  const pass = vi.fn(() => Promise.reject(new Error('TIMEOUT: social.query')));
  const loop = syncLoop(pass, 0);
  loop.kick();
  await vi.advanceTimersByTimeAsync(0);
  loop.stop();
  await vi.advanceTimersByTimeAsync(HOUR);
  expect(pass).toHaveBeenCalledTimes(1);
});

it('serialized runs calls one after the other, even after a failure', async () => {
  vi.useRealTimers();
  const order: string[] = [];
  let active = 0;
  let overlap = false;
  const work = serialized(async (name: string, fail: boolean) => {
    active++;
    if (active > 1) overlap = true;
    order.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, 5));
    order.push(`end ${name}`);
    active--;
    if (fail) throw new Error(name);
  });
  const a = work('a', true);
  const b = work('b', false);
  await expect(a).rejects.toThrow('a');
  await b;
  expect(overlap).toBe(false);
  expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
});
