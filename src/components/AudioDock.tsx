import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '../lib/voice';
import type { ReaderSettings } from '../lib/types';
import {
  IconPlay, IconPause, IconBack15, IconFwd15, IconPrev, IconNext, IconGauge, IconMoon, IconWaveform, IconSparkle, IconInfinityTrace,
} from './Icons';
import { useI18n } from '../i18n/useI18n';

/** Audio duration as a reader reads it: seconds are noise, minutes are the unit. */
function minutes(seconds: number): string {
  return seconds < 60 ? `${Math.round(seconds)}s` : `${Math.round(seconds / 60)}m`;
}

/**
 * Every pace the dock could offer — filtered per engine before it is drawn.
 *
 * 🚨 An engine that ignores a value must not be offered it. Chatterbox only ever
 * SLOWS (its pace rides cfg_weight, and anything at or above 1 is the default),
 * XTTS takes no pacing argument at all, Piper has a true tempo. Showing 2× on an
 * engine that cannot go faster is a control that lies — reported as "Chatterbox
 * reste bloqué à 1.5".
 */
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** The system voice takes a real rate (SpeechSynthesisUtterance.rate). */
const BROWSER_SPEED_RANGE = { min: 0.5, max: 2 };
const SLEEPS = [0, 5, 15, 30, 45, 60];

/**
 * The voice menu's whole world, resolved by the Reader.
 *
 * A pick here lasts the SESSION — Settings → Voice stays the only stored source.
 *
 * 🚨 `ready` carries THREE states and they are not interchangeable: `true`
 * installed, `false` known-absent, `undefined` NOT ASKED YET. An engine known
 * to be absent is not offered — a menu should list what you can use, and
 * downloading belongs to Settings. But one that has not been probed is still
 * shown: hiding on ignorance would make the menu empty for a second and look
 * broken, and "I do not know" has never been the same as "there is none".
 */
export interface VoicePanel {
  engines: { id: string; name: string; ready?: boolean }[];
  activeEngine: string;
  /** Where the active engine's Speed control reaches — null: draw none. */
  speedRange: { min: number; max: number } | null;
  /** True while the reader is still following the host's choice. */
  following: boolean;
  options: { id: string; label: string }[];
  activeVoice: string;
  /** Probe what is installed, only when the menu is opened. */
  onOpen: () => void;
  onPickEngine: (id: string | null) => void;
  onPickVoice: (id: string) => void;
}

/**
 * Synthesizing the chapter ahead of playback.
 *
 * `supported` is false on the system voice, which speaks instantly — a button
 * offering to prepare what needs no preparation would be a lie about the cost.
 */
export interface PreparePanel {
  supported: boolean;
  running: boolean;
  done: number;
  total: number;
  secondsReady: number;
  onToggle: () => void;
}

interface DockProps {
  state: PlayerState;
  chapterTitle: string;
  sentenceIndex: number;
  sentenceCount: number;
  pct: number;
  ticks: number[];
  settings: ReaderSettings;
  /** Name of the voice actually speaking ("Chatterbox", "System voice", …). */
  engineLabel: string;
  /** A lead being built right now: seconds ready out of seconds wanted. */
  lead: { ready: number; target: number } | null;
  voice: VoicePanel;
  prepare: PreparePanel;
  sleepRemaining: number | null;
  onToggle: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onSkip: (deltaSentences: number) => void;
  onSeekPct: (pct: number) => void;
  onChange: (patch: Partial<ReaderSettings>) => void;
}

type PopId = 'speed' | 'sleep' | 'voice' | null;

export function AudioDock(props: DockProps) {
  const { t } = useI18n();
  const { state, settings, voice, prepare } = props;
  const [pop, setPop] = useState<PopId>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close popovers on an outside press, or when this cartridge loses focus.
  //
  // 🪤 A press on the HOST plane never reaches this document at all: we run
  // in an iframe, so that event belongs to the host page, not to us. No event
  // type fixes that (pointerdown included) — only this window losing focus
  // crosses the boundary, which is what the host shell does for its own menus.
  useEffect(() => {
    if (!pop) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPop(null);
    };
    const onBlur = () => setPop(null);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('blur', onBlur);
    };
  }, [pop]);

  const seekFromEvent = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    props.onSeekPct(p);
  };

  // What this engine can actually be asked for. Null = no control at all.
  const speedRange = voice.activeEngine === 'browser'
    ? BROWSER_SPEED_RANGE
    : voice.speedRange;
  const speeds = SPEEDS.filter(v => speedRange && v >= speedRange.min && v <= speedRange.max);

  const busy = state === 'buffering';
  const playing = state === 'playing';

  return (
    <div className="dock" ref={rootRef}>
      {/* scrubber */}
      <div className="scrub">
        <span className="scrub-time">{Math.round(props.pct * 100)}%</span>
        <div
          className="track" ref={trackRef}
          onClick={(e) => seekFromEvent(e.clientX)}
        >
          <div className="track-fill" style={{ width: `${props.pct * 100}%` }} />
          <div className="track-ticks">
            {props.ticks.map((t, i) => <span key={i} className="track-tick" style={{ left: `${t * 100}%` }} />)}
          </div>
          <div className="track-thumb" style={{ left: `${props.pct * 100}%` }} />
        </div>
        <span className="scrub-time">{props.sentenceIndex + 1}/{props.sentenceCount}</span>
      </div>

      <div className="dock-row">
        <div className="dock-now">
          <div className="dock-now-ch">{props.chapterTitle || t('dock.ready')}</div>
          <div className="dock-now-sub">
            {playing && <span className="eq" aria-hidden="true"><i /><i /><i /><i /></span>}
            <span>
              {busy
                // A minute of silence with nothing moving is a freeze, whatever the
                // cause. While a lead is being built, the wait shows its own size.
                ? (props.lead
                  ? t('dock.buildingLead', { ready: minutes(props.lead.ready), target: minutes(props.lead.target) })
                  : t('dock.synthesizing'))
                : playing ? t('dock.readingAloud')
                  : state === 'paused' ? t('dock.paused') : t('dock.pressPlay')}
              {/* Which voice is speaking, on screen. The engine was resolved out of
                  sight for a long time, and a wrong one is inaudible as a fact. */}
              {props.engineLabel && ` · ${props.engineLabel}`}
              {props.sleepRemaining != null && ` · 💤 ${props.sleepRemaining}m`}
            </span>
          </div>
        </div>

        <div className="dock-transport">
          <button className="icon-btn" title={t('dock.previousChapter')} onClick={props.onPrevChapter}><IconPrev size={18} /></button>
          <button className="icon-btn" title={t('dock.back')} onClick={() => props.onSkip(-1)}><IconBack15 size={18} /></button>
          {/* While the voice is being synthesized the button BECOMES the ∞ being
              traced. Pressing play on a neural engine can mean a real wait (a
              cold sidecar is ~30 s), and a play triangle sitting there says
              "nothing happened" — the one reading a user makes of a button that
              did not change. */}
          <button
            className={`play-fab ${busy ? 'buffering' : playing ? 'playing' : ''}`}
            title={busy ? t('reader.preparingVoice') : playing ? t('dock.pause') : t('dock.play')}
            onClick={props.onToggle}
          >
            {busy
              ? <IconInfinityTrace size={38} className="on-fab" />
              : playing ? <IconPause size={24} /> : <IconPlay size={24} />}
          </button>
          <button className="icon-btn" title={t('dock.forward')} onClick={() => props.onSkip(1)}><IconFwd15 size={18} /></button>
          <button className="icon-btn" title={t('dock.nextChapter')} onClick={props.onNextChapter}><IconNext size={18} /></button>
        </div>

        <div className="dock-tools">
          {/* Synthesize the chapter ahead. Offered only on a neural engine — the
              system voice speaks instantly, so there would be nothing to wait for. */}
          {prepare.supported && (
            <button
              className={`chip ${prepare.running ? 'on' : ''}`}
              onClick={prepare.onToggle}
              title={prepare.running ? t('dock.prepareStop') : t('dock.prepareTitle')}
            >
              <IconSparkle size={15} />
              {prepare.running
                ? t('dock.prepareProgress', {
                  pct: Math.round((prepare.done / Math.max(1, prepare.total)) * 100),
                  ready: minutes(prepare.secondsReady),
                })
                : t('dock.prepare')}
            </button>
          )}

          {/* Which voice reads, changeable without leaving the book. The engine
              was resolved out of sight for a long time and a wrong one is
              inaudible as a fact — so it is a control, not just a label. */}
          <div className="pop-anchor">
            <button
              className={`chip ${pop === 'voice' ? 'on' : ''}`}
              title={t('dock.voice')}
              onClick={() => { const open = pop !== 'voice'; setPop(open ? 'voice' : null); if (open) voice.onOpen(); }}
            >
              <IconWaveform size={15} /> <span className="chip-label">{props.engineLabel}</span>
            </button>
            {pop === 'voice' && (
              <div className="pop pop-scroll">
                <div className="pop-title">{t('dock.engine')}</div>
                <button
                  className={`pop-opt ${voice.following ? 'sel' : ''}`}
                  onClick={() => { voice.onPickEngine(null); setPop(null); }}
                  title={t('dock.followAppTitle')}
                >
                  {t('dock.followApp')} {voice.following && '✓'}
                </button>
                {voice.engines.filter(e => e.ready !== false).map(e => (
                  <button
                    key={e.id}
                    className={`pop-opt ${!voice.following && voice.activeEngine === e.id ? 'sel' : ''}`}
                    title={e.name}
                    onClick={() => { voice.onPickEngine(e.id); setPop(null); }}
                  >
                    {e.name}
                    {!voice.following && voice.activeEngine === e.id && ' ✓'}
                  </button>
                ))}
                {voice.options.length > 0 && (
                  <>
                    <div className="pop-title" style={{ marginTop: 8 }}>{t('dock.voice')}</div>
                    {voice.options.map(o => (
                      <button
                        key={o.id}
                        className={`pop-opt ${voice.activeVoice === o.id ? 'sel' : ''}`}
                        onClick={() => { voice.onPickVoice(o.id); setPop(null); }}
                      >
                        {o.label} {voice.activeVoice === o.id && '✓'}
                      </button>
                    ))}
                  </>
                )}
                {/* Said where the choice is made: this one is for this session. */}
                <div className="pop-note">{t('dock.sessionNote')}</div>
              </div>
            )}
          </div>

          {speeds.length > 1 && <div className="pop-anchor">
            <button className={`chip ${pop === 'speed' ? 'on' : ''}`} onClick={() => setPop(pop === 'speed' ? null : 'speed')}>
              <IconGauge size={15} /> {settings.rate}×
            </button>
            {pop === 'speed' && (
              <div className="pop">
                <div className="pop-title">{t('dock.speed')}</div>
                {speeds.map(s => (
                  <button key={s} className={`pop-opt ${settings.rate === s ? 'sel' : ''}`} onClick={() => { props.onChange({ rate: s }); setPop(null); }}>
                    {s}× {settings.rate === s && '✓'}
                  </button>
                ))}
              </div>
            )}
          </div>}

          <div className="pop-anchor">
            <button className={`chip ${settings.sleepMinutes > 0 ? 'on' : ''}`} onClick={() => setPop(pop === 'sleep' ? null : 'sleep')}>
              <IconMoon size={15} />
            </button>
            {pop === 'sleep' && (
              <div className="pop">
                <div className="pop-title">{t('dock.sleepTimer')}</div>
                {SLEEPS.map(m => (
                  <button key={m} className={`pop-opt ${settings.sleepMinutes === m ? 'sel' : ''}`} onClick={() => { props.onChange({ sleepMinutes: m }); setPop(null); }}>
                    {m === 0 ? t('dock.sleepOff') : t('dock.sleepMinutes', { n: m })} {settings.sleepMinutes === m && '✓'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
