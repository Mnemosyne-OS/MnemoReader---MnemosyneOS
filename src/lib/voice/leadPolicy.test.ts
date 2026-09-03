/**
 * @vitest-environment jsdom
 *
 * The lead arithmetic, pinned — because these numbers are QUOTED to the user
 * ("1.3× — about a minute of waiting for two and a half minutes of reading"),
 * and a promise made in a toast has to be one the code keeps.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  leadTargetSec, speakTimeoutMs, readStoredFactor, writeStoredFactor,
  LEAD_MIN_SEC, LEAD_MAX_WAIT_SEC, REFILL_MIN_FACTOR, FACTOR_KEY,
} from './leadPolicy';

describe('leadTargetSec', () => {
  it('asks for nothing from an engine that outruns speech', () => {
    // 🚨 The rule that protects Piper and XTTS: they never drain, so making them
    // wait would be inventing a problem in order to solve it.
    expect(leadTargetSec(0.8)).toBe(0);
    expect(leadTargetSec(1)).toBe(0);
    expect(leadTargetSec(REFILL_MIN_FACTOR)).toBe(0);
  });

  it('asks for nothing when the engine has never been measured', () => {
    // An unknown factor is UNKNOWN, not slow: the first play starts immediately
    // and measures. Guessing "probably slow" would tax every new engine.
    expect(leadTargetSec(null)).toBe(0);
  });

  it('buys the wait it promised at the factor we measured', () => {
    // The number in the toast: at 1.3x the lead is capped by the wait, not by
    // the horizon — ~46 s of audio for ~60 s of waiting.
    const lead = leadTargetSec(1.3);
    expect(lead).toBeCloseTo(LEAD_MAX_WAIT_SEC / 1.3, 5);
    expect(lead * 1.3).toBeLessThanOrEqual(LEAD_MAX_WAIT_SEC + 0.001);
    // …and that lead covers (lead / (f - 1)) of reading: over two minutes.
    expect(lead / 0.3).toBeGreaterThan(120);
  });

  it('never makes the wait itself longer than the cap, whatever the factor', () => {
    for (const f of [1.06, 1.2, 1.5, 2, 3, 6]) {
      expect(leadTargetSec(f) * f).toBeLessThanOrEqual(LEAD_MAX_WAIT_SEC + 0.001);
    }
  });

  it('lets the horizon decide when the engine is only just too slow', () => {
    // At 1.06x, five minutes of reading needs only 18 s of lead — well under the
    // cap, so the horizon is the binding constraint and the wait stays short.
    expect(leadTargetSec(1.06)).toBeCloseTo(0.06 * 300, 5);
  });

  it('keeps a floor, so a hopeless engine still gets a usable lead', () => {
    // Past ~7.5x the affordable lead falls under a few seconds, which would
    // rebuild constantly. The floor trades a longer wait for a real stretch.
    expect(leadTargetSec(20)).toBe(LEAD_MIN_SEC);
  });
});

describe('speakTimeoutMs', () => {
  it('keeps Piper on a short leash — it is a per-sentence process', () => {
    expect(speakTimeoutMs('piper', 280)).toBe(15_000);
    expect(speakTimeoutMs('piper', 5)).toBe(15_000);
  });

  it('gives a cloning engine the time its chunk actually needs', () => {
    // 🚨 The bug this replaced: a flat 15 s, below the HEALTHY runtime of a
    // 280-char chunk (~19 s of audio at 1.65x ≈ 31 s of work). Three aborts and
    // the reader declared the engine unavailable.
    expect(speakTimeoutMs('chatterbox', 280)).toBeGreaterThan(31_000);
  });

  it('is generous with a short chunk and bounded on a long one', () => {
    expect(speakTimeoutMs('chatterbox', 10)).toBe(30_000);
    expect(speakTimeoutMs('chatterbox', 100_000)).toBe(120_000);
  });
});

describe('the remembered factor', () => {
  beforeEach(() => localStorage.clear());

  it('remembers per engine, not per app', () => {
    writeStoredFactor('chatterbox', 1.317);
    writeStoredFactor('xtts', 0.82);
    expect(readStoredFactor('chatterbox')).toBeCloseTo(1.317, 3);
    expect(readStoredFactor('xtts')).toBeCloseTo(0.82, 3);
  });

  it('answers null for an engine it has never seen', () => {
    // 🚨 null, never 0: an unmeasured engine is UNKNOWN, and 0 would read as
    // "infinitely fast" — the app would decide it needs no lead at all.
    expect(readStoredFactor('an-engine-from-the-future')).toBeNull();
  });

  it('treats corrupted storage as no memory rather than as a measurement', () => {
    localStorage.setItem(FACTOR_KEY, 'not json at all');
    expect(readStoredFactor('chatterbox')).toBeNull();
    localStorage.setItem(FACTOR_KEY, JSON.stringify({ chatterbox: 'vite' }));
    expect(readStoredFactor('chatterbox')).toBeNull();
    localStorage.setItem(FACTOR_KEY, JSON.stringify({ chatterbox: 0 }));
    expect(readStoredFactor('chatterbox')).toBeNull();
  });

  it('keeps the other engines when one is written', () => {
    writeStoredFactor('piper', 0.4);
    writeStoredFactor('chatterbox', 1.3);
    expect(readStoredFactor('piper')).toBeCloseTo(0.4, 3);
  });
});
