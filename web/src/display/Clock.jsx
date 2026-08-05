import { useEffect, useState } from 'react';

export default function Clock({ clock24, timezone, sizeRem = 5.5, showDate = true }) {
  const [now, setNow] = useState(() => new Date());

  // Tick on the minute boundary rather than every second — nothing on screen
  // shows seconds, and the frame runs for months at a time.
  useEffect(() => {
    let timeout;
    const schedule = () => {
      const msToNextMinute = 60_000 - (Date.now() % 60_000);
      timeout = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, msToNextMinute + 50);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, []);

  const tz = timezone ? { timeZone: timezone } : {};

  const time = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !clock24,
    ...tz,
  });

  const date = now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...tz,
  });

  return (
    <header className="shrink-0">
      <div
        className="font-semibold leading-none tracking-tight text-white tabular-nums"
        style={{ fontSize: `${sizeRem}rem` }}
      >
        {time}
      </div>
      {showDate && (
        <div
          className="mt-3 font-light text-slate-300"
          // Scales with the clock so the pair keeps its proportions.
          style={{ fontSize: `${Math.max(1, sizeRem * 0.27)}rem` }}
        >
          {date}
        </div>
      )}
    </header>
  );
}
