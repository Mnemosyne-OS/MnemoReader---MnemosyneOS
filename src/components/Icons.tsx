/** Inline stroke icons — no external icon dependency (cartridges bundle themselves). */
type P = { size?: number; className?: string };
const base = (size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
});

export const IconPlay = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M6 4.5v15l13-7.5-13-7.5z" fill="currentColor" stroke="none" /></svg>
);
export const IconPause = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><rect x="6.5" y="4.5" width="3.6" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="13.9" y="4.5" width="3.6" height="15" rx="1" fill="currentColor" stroke="none" /></svg>
);
export const IconBack15 = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M11 5 6 9l5 4" /><path d="M6 9h7a5 5 0 1 1-5 5" /></svg>
);
export const IconFwd15 = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M13 5l5 4-5 4" /><path d="M18 9h-7a5 5 0 1 0 5 5" /></svg>
);
export const IconPrev = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M18 5v14l-9-7 9-7z" fill="currentColor" stroke="none" /><rect x="5" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none" /></svg>
);
export const IconNext = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M6 5v14l9-7-9-7z" fill="currentColor" stroke="none" /><rect x="16.6" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none" /></svg>
);
export const IconBook = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z" /></svg>
);
export const IconFolder = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
);
export const IconPlus = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconList = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>
);
export const IconMoon = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
);
export const IconGauge = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 13l4-3" /><path d="M4 15a8 8 0 1 1 16 0" /><circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none" /></svg>
);
/**
 * The ∞, traced by a light that runs around it — Mnemosyne's own "working" sign.
 *
 * One definition for both places it appears (the cold-start overlay and the play
 * button), because two copies of a loader drift into two different animations.
 * Colour comes from the CSS: amber on a dark card, `currentColor` on the amber
 * fab, where an amber stroke would be invisible.
 */
export const IconInfinityTrace = ({ size = 24, className }: P) => {
  const d = 'M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z';
  return (
    <svg {...base(size)} className={`inf-loader ${className ?? ''}`} aria-hidden="true">
      <path className="inf-bg" d={d} />
      <path className="inf-trace" pathLength={100} d={d} />
    </svg>
  );
};

/** A voice: the waveform, not a mouth — this picks who SPEAKS, not who listens. */
export const IconWaveform = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M4 11v2M8 8v8M12 5v14M16 8v8M20 11v2" /></svg>
);
export const IconX = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconChevron = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M9 6l6 6-6 6" /></svg>
);
export const IconSparkle = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /></svg>
);
export const IconWave = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M4 12h2M8 8v8M12 5v14M16 9v6M20 12h0" /></svg>
);
export const IconArchive = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>
);
export const IconLink = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></svg>
);
export const IconColumns = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></svg>
);
