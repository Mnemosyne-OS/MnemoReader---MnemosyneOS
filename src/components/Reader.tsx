import { useEffect, useMemo, useRef, useState } from 'react';
import { isNeuralEngine, type Book, type LoadedBook, type ReaderSettings } from '../lib/types';
import { ReaderPlayer, type PlayerState, type PrepareProgress } from '../lib/voice';
import { useReaderVoice } from '../hooks/useReaderVoice';
import { useSleepTimer } from '../hooks/useSleepTimer';
import { useI18n } from '../i18n/useI18n';
import { bridge, isFramed } from '../lib/bridge';
import { ChapterRail } from './ChapterRail';
import { AudioDock } from './AudioDock';
import { PdfCompare } from './PdfCompare';
import { IconChevron, IconColumns, IconSparkle, IconInfinityTrace } from './Icons';

interface ReaderProps {
  book: Book;
  loaded: LoadedBook;
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onProgress: (sentenceIndex: number) => void;
  onBack: () => void;
  onDeepOcr: () => void;
  notify: (kind: 'info' | 'ok' | 'err', text: string) => void;
}

export function Reader({ book, loaded, settings, onChange, onProgress, onBack, onDeepOcr, notify }: ReaderProps) {
  const { t } = useI18n();
  const { sentences } = loaded;
  const count = sentences.length;

  const [activeSentence, setActiveSentence] = useState(Math.min(book.progressSentence, Math.max(0, count - 1)));
  const [activeWord, setActiveWord] = useState<{ start: number; end: number } | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  // True once audio has actually played — gates the full-screen warm-up overlay
  // so it only shows on the initial cold start, never between sentences.
  const [everPlayed, setEverPlayed] = useState(false);
  // A chapter being synthesized ahead of playback (null = not running).
  const [prepare, setPrepare] = useState<PrepareProgress | null>(null);
  // A lead being built before/during playback: seconds ready out of seconds wanted.
  const [lead, setLead] = useState<{ ready: number; target: number } | null>(null);
  // Side-by-side original-PDF compare pane (to eyeball OCR quality vs the source).
  const [compare, setCompare] = useState(false);
  const canCompare = isFramed() && book.ext === 'pdf' && !!book.filePath;

  const playerRef = useRef<ReaderPlayer | null>(null);
  const sentenceElRef = useRef<HTMLSpanElement | null>(null);
  /** Units the engine could not speak in this reading — counted, never silent. */
  const skipped = useRef(0);
  /** The "this engine cannot keep up" nudge is said once, or it becomes noise. */
  const nudged = useRef(false);

  // Who reads the book, and how that choice is allowed to change (hooks/useReaderVoice).
  const voice = useReaderVoice({ settings, text: loaded.text, onChange, notify });
  const { activeEngine, engineLabel, effectiveVoice } = voice;
  // 🪤 The player's hooks are built ONCE, so they must reach the current voice
  // object rather than the one captured at mount — the same reason `live` exists.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // Latest callbacks/settings for the player hooks (avoids stale closures without
  // re-creating the player). Assigned below, once the engine's label is known.
  const live = useRef({ onProgress, onChange, notify, engine: settings.engine, engineLabel: '' });

  live.current = { onProgress, onChange, notify, engine: activeEngine, engineLabel };

  /**
   * Once the engine's real speed is known, say so if it cannot keep up.
   *
   * 🚨 Measured, never assumed: above 1× the synthesis falls behind speech
   * cumulatively, so the lead is spent and never rebuilt while playing. The
   * player then stops on purpose now and then to rebuild one, instead of
   * breaking after every sentence — but a pause nobody explained is still a
   * reader that looks broken, so it is named once, with the number, next to the
   * one thing that removes it.
   */
  const nudgeIfBehind = () => {
    if (nudged.current) return;
    const p = playerRef.current;
    const f = p?.realtimeFactor();
    if (!p || f === null || f === undefined || f <= 1.15 || p.isPreparing) return;
    nudged.current = true;
    live.current.notify('info',
      t('toast.engineSlow', { name: live.current.engineLabel, factor: f.toFixed(1) }));
  };

  // ── chapter math ──────────────────────────────────────────────────────────
  const chapterOf = useMemo(() => {
    const starts = book.chapters.map(c => c.sentenceStart);
    return (idx: number) => {
      let ans = 0;
      for (let i = 0; i < starts.length; i++) { if (starts[i] <= idx) ans = i; else break; }
      return ans;
    };
  }, [book.chapters]);

  const activeChapter = chapterOf(activeSentence);
  const chapter = book.chapters[activeChapter];
  const chapterEndSentence = activeChapter + 1 < book.chapters.length
    ? book.chapters[activeChapter + 1].sentenceStart
    : count;
  const ticks = useMemo(
    () => book.chapters.map(c => (count > 1 ? c.sentenceStart / (count - 1) : 0)),
    [book.chapters, count]
  );

  // ── create the player once (Reader is keyed by book id in App) ──────────────
  useEffect(() => {
    const p = new ReaderPlayer(settings.engine, settings.voice, settings.rate, {
      onSentence: (i) => {
        setActiveSentence(i); setActiveWord(null); live.current.onProgress(i);
        nudgeIfBehind();
      },
      onWord: (_, s, e) => setActiveWord({ start: s, end: e }),
      onState: (s) => { setPlayerState(s); if (s === 'playing') { setEverPlayed(true); setLead(null); } },
      onLead: (ready, target) => setLead({ ready, target }),
      // A unit the engine could not speak is words the listener never hears —
      // said once, with the sentence number, and counted for the end.
      onSkipped: (index, reason) => {
        skipped.current += 1;
        if (skipped.current === 1) {
          live.current.notify('err', t('toast.sentenceSkipped', { n: index + 1, reason }));
        }
      },
      onEnd: () => {
        setActiveWord(null);
        const missed = skipped.current;
        live.current.notify(missed ? 'err' : 'ok',
          missed === 0 ? t('toast.finished')
            : missed === 1 ? t('toast.finishedWithGapsOne')
              : t('toast.finishedWithGapsMany', { n: missed }));
      },
      onError: (msg) => {
        if (isNeuralEngine(live.current.engine)) {
          // Name the engine AND the reason: a fallback that says "unavailable"
          // and nothing else is indistinguishable from the app ignoring the
          // user's choice, which is precisely what it used to be mistaken for.
          live.current.notify('info', t('toast.engineFailed', { name: live.current.engineLabel, error: msg }));
          // A fallback is for THIS session — it must not rewrite what the user
          // chose in Settings, or a passing failure would outlive its cause.
          voiceRef.current.fallBackToSystem();
        } else {
          live.current.notify('err', msg);
        }
      },
    });
    p.load(sentences);
    p.seek(Math.min(book.progressSentence, Math.max(0, count - 1))); // reposition without autoplay
    playerRef.current = p;
    return () => { p.dispose(); playerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply rate changes.
  useEffect(() => { playerRef.current?.setRate(settings.rate); }, [settings.rate]);
  // Apply engine / (language-matched) voice changes.
  useEffect(() => {
    playerRef.current?.setVoice(activeEngine, effectiveVoice);
  }, [activeEngine, effectiveVoice]);
  // Warm the neural engine ahead of first play (a cold sidecar is ~30s) so the
  // loading state has something to show and playback starts sooner.
  useEffect(() => {
    if (isNeuralEngine(activeEngine)) bridge.ttsWarm(activeEngine).catch(() => { /* best-effort */ });
  }, [activeEngine]);

  // Sleep timer — the reader owns what expiring MEANS, the hook owns the clock.
  const sleepRemaining = useSleepTimer(settings.sleepMinutes, () => {
    playerRef.current?.pause();
    notify('info', t('toast.sleepPaused'));
    onChange({ sleepMinutes: 0 });
  });

  // Auto-scroll the active sentence into view.
  useEffect(() => {
    sentenceElRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeSentence]);

  // ── transport handlers ──────────────────────────────────────────────────────
  const seek = (i: number) => playerRef.current?.seek(Math.max(0, Math.min(i, count - 1)));
  const onToggle = () => playerRef.current?.toggle();
  const onSkip = (d: number) => seek(activeSentence + d);
  const onPrevChapter = () => {
    if (activeSentence > (chapter?.sentenceStart ?? 0) + 1) seek(chapter.sentenceStart);
    else if (activeChapter > 0) seek(book.chapters[activeChapter - 1].sentenceStart);
    else seek(0);
  };
  const onNextChapter = () => {
    if (activeChapter + 1 < book.chapters.length) seek(book.chapters[activeChapter + 1].sentenceStart);
  };

  // A voice pick in the dock becomes the manual override (wins over language match).

  /**
   * Synthesize the rest of the chapter before it is needed.
   *
   * 🚨 The only real answer to an engine slower than speech: at a factor f, an
   * hour of hole-free reading needs (f − 1) hours of head start, and no rolling
   * buffer recovers a deficit that accumulates. Paid once, visibly, instead of
   * being spent as a hole after every sentence. Playback can start whenever —
   * the scheduler reads the same cache.
   */
  const togglePrepare = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPreparing) { p.stopPreparing(); return; }
    const to = chapterEndSentence;
    setPrepare({ done: 0, total: Math.max(1, to - activeSentence), secondsReady: 0 });
    void p.prepare(activeSentence, to, setPrepare).then((outcome) => {
      const ready = Math.round(p.preparedSeconds(activeSentence) / 60);
      setPrepare(null);
      if (outcome === 'done') notify('ok', t('toast.chapterReady', { minutes: ready }));
      else if (outcome === 'full') notify('info', t('toast.chapterPartly', { minutes: ready }));
      else if (outcome === 'failed') notify('err', t('toast.prepareFailed', { name: engineLabel }));
    });
  };

  // ── prose (only the current chapter is materialized, for performance) ────────
  const renderSentence = (i: number) => {
    const text = sentences[i];
    if (i === activeSentence && activeWord) {
      const before = text.slice(0, activeWord.start);
      const word = text.slice(activeWord.start, activeWord.end);
      const after = text.slice(activeWord.end);
      return (
        <span key={i} ref={sentenceElRef} className="sentence active">
          {before}<span className="kw">{word}</span>{after}{' '}
        </span>
      );
    }
    if (i === activeSentence) return <span key={i} ref={sentenceElRef} className="sentence active">{text}{' '}</span>;
    return <span key={i} className="sentence">{text}{' '}</span>;
  };

  // Group the chapter's sentences into paragraphs — a blank line in the source
  // between two sentences starts a new one — so the page reads like a book, not a wall.
  const proseStart = chapter?.sentenceStart ?? 0;
  const paragraphs: number[][] = [];
  let curPara: number[] = [];
  for (let i = proseStart; i < chapterEndSentence; i++) {
    const off = loaded.sentenceOffsets[i];
    const prevOff = i > proseStart ? loaded.sentenceOffsets[i - 1] : undefined;
    const startsPara = curPara.length > 0 && off !== undefined && prevOff !== undefined
      && loaded.text.lastIndexOf('\n\n', off) > prevOff;
    if (startsPara) { paragraphs.push(curPara); curPara = []; }
    curPara.push(i);
  }
  if (curPara.length) paragraphs.push(curPara);

  return (
    <div className="reader">
      <ChapterRail book={book} activeChapter={activeChapter} onJump={(ci) => seek(book.chapters[ci].sentenceStart)} />

      <div className="canvas-wrap" style={{ position: 'relative' }}>
        {playerState === 'buffering' && !everPlayed && (
          <div className="voice-loading">
            <div className="voice-loading-card">
              <IconInfinityTrace size={56} />
              <span>{t('reader.preparingVoice')}</span>
            </div>
          </div>
        )}
        <div className="topbar" style={{ borderBottom: '1px solid var(--stroke-soft)' }}>
          <button className="btn btn-ghost" onClick={onBack} style={{ transform: 'scaleX(-1)' }} title={t('reader.back')}>
            <IconChevron size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="dock-now-ch" style={{ fontSize: 14 }}>{chapter?.title || book.title}</div>
            <div className="brand-sub">{t('reader.chapterOf', { n: activeChapter + 1, total: book.chapters.length })}</div>
          </div>
          <div className="topbar-spacer" />
          {canCompare && (
            <button className={`chip ${compare ? 'on' : ''}`} onClick={() => setCompare(v => !v)} title={t('reader.comparePdf')}>
              <IconColumns size={15} /> PDF
            </button>
          )}
          {canCompare && (
            <button className="chip" onClick={onDeepOcr} title={t('reader.deepOcrTitle')}>
              <IconSparkle size={15} /> {t('reader.deepOcr')}
            </button>
          )}
          <button className="chip" onClick={() => onChange({ fontSize: Math.max(15, settings.fontSize - 2) })}>{t('reader.smaller')}</button>
          <button className="chip" onClick={() => onChange({ fontSize: Math.min(30, settings.fontSize + 2) })}>{t('reader.larger')}</button>
          <button className="chip" onClick={() => {
            const order: ReaderSettings['theme'][] = ['night', 'sepia', 'paper'];
            onChange({ theme: order[(order.indexOf(settings.theme) + 1) % order.length] });
          }}>{settings.theme}</button>
        </div>

        <div className="reader-body">
          <div className={`canvas theme-${settings.theme}`} style={{ ['--reader-fs' as string]: `${settings.fontSize}px` }}>
            <div className="prose">
              {paragraphs.map((para, pi) => <p key={pi} className="para">{para.map(renderSentence)}</p>)}
            </div>
          </div>
          {compare && canCompare && <PdfCompare filePath={book.filePath} onClose={() => setCompare(false)} />}
        </div>
      </div>

      <AudioDock
        state={playerState}
        chapterTitle={chapter?.title || book.title}
        sentenceIndex={activeSentence}
        sentenceCount={count}
        pct={count > 1 ? activeSentence / (count - 1) : 0}
        ticks={ticks}
        settings={settings}
        engineLabel={engineLabel}
        lead={lead}
        voice={{
          engines: voice.engineChoices,
          activeEngine,
          speedRange: voice.engineInfo?.speedRange ?? null,
          following: voice.following,
          options: voice.voiceOptions,
          activeVoice: effectiveVoice,
          onOpen: voice.probeEngines,
          onPickEngine: voice.pickEngine,
          onPickVoice: voice.pickVoice,
        }}
        prepare={{
          supported: isNeuralEngine(activeEngine),
          running: prepare !== null,
          done: prepare?.done ?? 0,
          total: prepare?.total ?? 0,
          secondsReady: prepare?.secondsReady ?? 0,
          onToggle: togglePrepare,
        }}
        sleepRemaining={sleepRemaining}
        onToggle={onToggle}
        onPrevChapter={onPrevChapter}
        onNextChapter={onNextChapter}
        onSkip={onSkip}
        onSeekPct={(p) => seek(Math.round(p * (count - 1)))}
        onChange={onChange}
      />
    </div>
  );
}
