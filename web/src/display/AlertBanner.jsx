import { useEffect, useRef, useState } from 'react';

/**
 * Severe-weather banner across the top of the frame.
 *
 * Deliberately restrained: a soft red wash rather than a solid alarm bar, so it
 * reads as "look at this" without turning the room's picture frame into a
 * warning light. It only scrolls when the text is actually too long to fit —
 * permanent motion on a wall display is exhausting.
 */
export default function AlertBanner({ alerts }) {
  const trackRef = useRef(null);
  const viewportRef = useRef(null);
  const [overflows, setOverflows] = useState(false);
  const [index, setIndex] = useState(0);

  const alert = alerts?.[index] ?? null;

  // Rotate through multiple warnings rather than stacking bars.
  useEffect(() => {
    if (!alerts || alerts.length < 2) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % alerts.length), 12_000);
    return () => clearInterval(id);
  }, [alerts]);

  useEffect(() => {
    if (alerts && index >= alerts.length) setIndex(0);
  }, [alerts, index]);

  // Only animate if the line genuinely doesn't fit.
  useEffect(() => {
    const measure = () => {
      const track = trackRef.current;
      const viewport = viewportRef.current;
      if (!track || !viewport) return;
      setOverflows(track.scrollWidth > viewport.clientWidth + 8);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [alert]);

  if (!alert) return null;

  const line = [alert.headline || alert.event, alert.instruction].filter(Boolean).join(' — ');
  const extreme = alert.severity === 'Extreme';

  return (
    <div
      className={[
        'pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-3 px-6 py-3',
        'border-b backdrop-blur-sm',
        extreme
          ? 'border-rose-400/30 bg-rose-500/25'
          : 'border-rose-400/20 bg-rose-500/15',
      ].join(' ')}
      role="status"
    >
      <WarningIcon />
      <span className="shrink-0 text-sm font-semibold uppercase tracking-[0.15em] text-rose-100">
        {alert.event}
      </span>

      <div ref={viewportRef} className="relative min-w-0 flex-1 overflow-hidden">
        <div
          ref={trackRef}
          className={`whitespace-nowrap text-base text-rose-50/90 ${
            overflows ? 'animate-marquee' : 'truncate'
          }`}
        >
          {line}
          {overflows && <span className="px-16">{line}</span>}
        </div>
      </div>

      {alerts.length > 1 && (
        <span className="shrink-0 text-xs tabular-nums text-rose-200/70">
          {index + 1}/{alerts.length}
        </span>
      )}
    </div>
  );
}

function WarningIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-rose-200"
      aria-hidden="true"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
