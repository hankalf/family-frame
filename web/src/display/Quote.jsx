import { forwardRef } from 'react';

/**
 * The day's quote, shown under the agenda when the day is quiet enough to
 * leave room. Purely presentational — Display owns the does-it-fit decision.
 */
const Quote = forwardRef(function Quote({ quote, accent }, ref) {
  if (!quote) return null;

  return (
    <div ref={ref} className="shrink-0 animate-fadeUp border-t border-slate-800/80 pt-5">
      <p className="text-xl font-light italic leading-snug text-slate-300">"{quote.text}"</p>
      {quote.by && (
        <p className="mt-2 text-sm uppercase tracking-[0.15em]" style={{ color: accent }}>
          {quote.by}
        </p>
      )}
    </div>
  );
});

export default Quote;
