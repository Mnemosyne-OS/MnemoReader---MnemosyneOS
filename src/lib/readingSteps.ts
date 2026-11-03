/**
 * readingSteps — the paces and sleep-timer lengths the dock offers, shared by
 * the dock and by the agent door (doc 149) so a spoken « plus vite » steps
 * through exactly what the dock's menu would. Kept out of AudioDock.tsx: a
 * component file that also exports values breaks Fast Refresh.
 *
 * @module lib/readingSteps
 */

/**
 * Every pace the dock could offer — filtered per engine before it is drawn.
 *
 * 🚨 An engine that ignores a value must not be offered it. Chatterbox only ever
 * SLOWS (its pace rides cfg_weight, and anything at or above 1 is the default),
 * XTTS takes no pacing argument at all, Piper has a true tempo. Showing 2× on an
 * engine that cannot go faster is a control that lies — reported as "Chatterbox
 * reste bloqué à 1.5".
 */
export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** The system voice takes a real rate (SpeechSynthesisUtterance.rate). */
export const BROWSER_SPEED_RANGE = { min: 0.5, max: 2 };

/** Sleep-timer lengths, in minutes; 0 = off. */
export const SLEEPS = [0, 5, 15, 30, 45, 60];

/** The reading text sizes the « A- / A+ » buttons move between, in px, and their step. */
export const FONT_MIN = 15;
export const FONT_MAX = 30;
export const FONT_STEP = 2;
