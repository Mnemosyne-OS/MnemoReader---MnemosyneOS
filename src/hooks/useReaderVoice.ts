import { useEffect, useMemo, useRef, useState } from 'react';
import { bridge, isFramed } from '../lib/bridge';
import { useI18n } from '../i18n/useI18n';
import { detectLang, pickVoiceForLang, languageOfVoice, type Lang } from '../lib/lang';
import { warmBrowserVoices, type BrowserVoiceInfo } from '../lib/voice';
import {
  BROWSER_ENGINE, isNeuralEngine,
  type LocalEngineInfo, type ReaderSettings, type VoiceEngineId,
} from '../lib/types';

/** Everything the reader knows about who is speaking, and how to change it. */
export interface ReaderVoice {
  /** What is speaking right now: the dock's session pick, else the host's choice. */
  activeEngine: VoiceEngineId;
  /** The active engine's own descriptor (null for the system voice / unknown id). */
  engineInfo: LocalEngineInfo | null;
  /** The engine's name, as shown in the dock and used in every voice message. */
  engineLabel: string;
  /** The voice id to synthesize with, language-matched unless the user picked one. */
  effectiveVoice: string;
  /** The voices the ACTIVE engine can actually be given, for the dock's menu. */
  voiceOptions: { id: string; label: string }[];
  /** Every engine the host has, with what is installed (undefined = not probed). */
  engineChoices: { id: string; name: string; ready?: boolean }[];
  /** True while the reader is still following the host's stored choice. */
  following: boolean;
  /** Probe what is installed — only when the voice menu opens. */
  probeEngines: () => void;
  /** A dock pick lasts the session; null means "follow the host again". */
  pickEngine: (id: string | null) => void;
  pickVoice: (id: string) => void;
  /** Drop to the system voice for THIS session (a failure must not be persisted). */
  fallBackToSystem: () => void;
}

interface Options {
  settings: ReaderSettings;
  /** The book's own language — the voice follows the text, not the machine. */
  text: string;
  onChange: (patch: Partial<ReaderSettings>) => void;
  notify: (kind: 'info' | 'ok' | 'err', text: string) => void;
}

/**
 * Resolving who reads the book — the whole seam between MnemoReader and the
 * host's voice settings, in one place.
 *
 * 🚨 The rule the shape encodes: Settings → Voice is the only STORED source. A
 * pick made here lasts the session and is never written back, because the flag
 * that used to persist one could only ever get stuck true — and a reader frozen
 * on an engine the user no longer has is exactly the bug this cartridge spent a
 * day on. Same for a failure: falling back to the system voice is for now, not
 * for ever.
 */
export function useReaderVoice({ settings, text, onChange, notify }: Options): ReaderVoice {
  // Subscribes the reader to the shell's language too: the engine LABEL is UI.
  const { t } = useI18n();
  const [browserVoices, setBrowserVoices] = useState<BrowserVoiceInfo[]>([]);
  // What the host actually has: its engine catalogue (names, voices, chunk
  // budgets) and the Piper voice FILES that were downloaded. The cartridge keeps
  // no list of engines of its own — that is how "chatterbox" became "piper".
  const [engines, setEngines] = useState<LocalEngineInfo[]>([]);
  const [piperVoices, setPiperVoices] = useState<string[]>([]);
  const [engineReady, setEngineReady] = useState<Record<string, boolean>>({});
  const [sessionEngine, setSessionEngine] = useState<string | null>(null);
  const [manualVoice, setManualVoice] = useState<string | null>(null);

  const bookLang: Lang = useMemo(() => detectLang(text), [text]);
  const activeEngine = sessionEngine ?? settings.engine;
  const engineInfo = useMemo(
    () => engines.find(e => e.id === activeEngine) ?? null,
    [engines, activeEngine],
  );

  const effectiveVoice = useMemo(
    () => manualVoice
      ?? pickVoiceForLang(activeEngine, bookLang, { browser: browserVoices, piperVoices, info: engineInfo })
      ?? (activeEngine === settings.engine ? settings.voice : ''),
    [manualVoice, activeEngine, settings.engine, settings.voice, bookLang, browserVoices, piperVoices, engineInfo],
  );

  const voiceOptions = useMemo(() => {
    if (activeEngine === BROWSER_ENGINE) {
      return browserVoices.map(v => ({ id: v.id, label: `${v.name} · ${v.lang}` }));
    }
    // A cloning engine's voice IS a language; Piper's is a downloaded FILE, so
    // only the installed ones may be offered — naming one that was never
    // downloaded fails the synthesis and drops the reader to the system voice.
    if (engineInfo?.voiceIsLanguage) return engineInfo.voices.map(v => ({ id: v.id, label: v.label }));
    return piperVoices.map(id => ({ id, label: engineInfo?.voices.find(v => v.id === id)?.label ?? id }));
  }, [activeEngine, browserVoices, engineInfo, piperVoices]);

  // 🚨 Translated, unlike the neural engines: 'Chatterbox' is a product name and
  // stays itself in every language, but 'System voice' is a description.
  const engineLabel = activeEngine === BROWSER_ENGINE
    ? t('dock.systemVoice')
    : engineInfo?.name ?? activeEngine;

  /**
   * Say it when NOTHING can speak the book's language.
   *
   * 🚨 The last silent absence in this cartridge. When no voice matches, the
   * chain falls back to the configured one and the book is read in the wrong
   * accent — correct as a fallback, and indistinguishable from a choice. An
   * English novel read by a French voice is not a bug the listener can even
   * name, because nothing on screen admits it happened.
   *
   * ⚠️ Judged only once the inventory is LOADED: before that, "no voice matches"
   * means "not asked yet", and warning on ignorance is the same fabrication as
   * hiding a real absence. Keyed by (engine, language) so switching either in the
   * dock asks the question again — and answered once, not on every render.
   */
  const warnedFor = useRef('');
  useEffect(() => {
    const key = `${activeEngine}:${bookLang}`;
    if (warnedFor.current === key) return;
    const inventoryKnown = activeEngine === BROWSER_ENGINE ? browserVoices.length > 0 : !!engineInfo;
    if (!inventoryKnown) return;
    if (pickVoiceForLang(activeEngine, bookLang, { browser: browserVoices, piperVoices, info: engineInfo })) return;

    warnedFor.current = key;
    // What WILL speak instead, when its id says so — unnamed rather than guessed.
    const named = languageOfVoice(activeEngine, effectiveVoice, browserVoices);
    notify('info', named
      ? t('toast.noVoiceForLanguage', { language: t(`language.${bookLang}`), fallback: t(`language.${named}`) })
      : t('toast.noVoiceForLanguageUnknown', { language: t(`language.${bookLang}`) }));
  }, [activeEngine, bookLang, browserVoices, piperVoices, engineInfo, effectiveVoice, notify, t]);

  // ── adopt the host's choice, once, on open ────────────────────────────────
  useEffect(() => {
    void warmBrowserVoices().then(setBrowserVoices);

    void (async () => {
      const vc = await bridge.voiceConfig().catch(() => null);
      if (!vc) return;                       // no host (standalone) → browser voice
      setEngines(vc.engines ?? []);
      const patch: Partial<ReaderSettings> = { engine: vc.engine };
      // Adopt the host speed only on a fresh reader (rate still default) so a
      // dock speed change sticks.
      if (settings.rate === 1) patch.rate = Math.max(0.5, Math.min(2, vc.speed || 1));

      if (isNeuralEngine(vc.engine)) {
        // Ask about THAT engine — and say its name when it is not installed.
        // Silently trying it and dropping to the system voice three failures
        // later is how "the voice engine is not picked up" looks from outside.
        const st = await bridge.ttsStatus(vc.engine).catch(() => null);
        const label = vc.engines?.find(e => e.id === vc.engine)?.name ?? vc.engine;
        if (st?.success && st.data?.ready) {
          if (vc.engine === 'piper') {
            const vr = await bridge.ttsVoices().catch(() => null);
            setPiperVoices(vr?.success ? (vr.data?.voices ?? []) : []);
          }
        } else {
          patch.engine = BROWSER_ENGINE;
          notify('info', t('toast.engineNotInstalled', { name: label }));
        }
      }
      onChange(patch);
    })();
    // Once per open: the host's choice is adopted, not polled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Ask the host which engines are installed — once, when the voice menu opens.
   * An engine the user cannot use is still LISTED (greyed, "not installed"):
   * hiding it would make Settings and the dock disagree about what exists, which
   * is the shape of the bug this whole pass was about.
   */
  const probeEngines = () => {
    if (!isFramed() || !engines.length) return;
    void (async () => {
      const results = await Promise.all(engines.map(async (e) => {
        const st = await bridge.ttsStatus(e.id).catch(() => null);
        return [e.id, !!st?.success && !!st.data?.ready] as const;
      }));
      setEngineReady(Object.fromEntries(results));
      // Piper's voices are files on disk, so the list is only meaningful once.
      if (results.some(([id, ready]) => id === 'piper' && ready) && !piperVoices.length) {
        const vr = await bridge.ttsVoices().catch(() => null);
        setPiperVoices(vr?.success ? (vr.data?.voices ?? []) : []);
      }
    })();
  };

  return {
    activeEngine,
    engineInfo,
    engineLabel,
    effectiveVoice,
    voiceOptions,
    engineChoices: [
      { id: BROWSER_ENGINE, name: t('dock.systemVoice'), ready: true },
      ...engines.map(e => ({ id: e.id, name: e.name, ready: engineReady[e.id] })),
    ],
    following: sessionEngine === null,
    probeEngines,
    pickEngine: (id) => {
      setSessionEngine(id);
      setManualVoice(null);   // the old voice belongs to the old engine
    },
    pickVoice: setManualVoice,
    fallBackToSystem: () => setSessionEngine(BROWSER_ENGINE),
  };
}
