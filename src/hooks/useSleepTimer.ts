import { useEffect, useRef, useState } from 'react';

/**
 * The sleep timer: a countdown in minutes, and one call when it runs out.
 *
 * 🪤 `onExpire` is held in a ref rather than listed as a dependency. The caller
 * builds it inline — it pauses the player, raises a toast and writes the setting
 * back — so a new identity on every render would re-arm the timer on every
 * render, and a reader left running would never fall asleep.
 *
 * Returns the minutes left, or null when no timer is set.
 */
export function useSleepTimer(minutes: number, onExpire: () => void): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    if (minutes <= 0) { setRemaining(null); return; }
    const deadline = Date.now() + minutes * 60_000;
    setRemaining(minutes);
    let fired = false;
    const tick = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 60_000)));
      // Guarded because the interval keeps running until the effect is torn
      // down: expiring twice would pause a reading the user had just resumed.
      if (!fired && Date.now() >= deadline) { fired = true; expire.current(); }
    }, 5_000);
    return () => clearInterval(tick);
  }, [minutes]);

  return remaining;
}
