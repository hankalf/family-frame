import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';

/**
 * Location search for the weather settings. Searches are debounced and the
 * in-flight request is aborted on each keystroke — otherwise a slow response
 * for "Spring" can land after "Springfield" and repopulate the wrong results.
 */
export default function CityPicker({ place, lat, lon, onPick, onClear }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setError('');
      return undefined;
    }

    const id = setTimeout(async () => {
      const requestId = (requestIdRef.current += 1);
      setBusy(true);
      setError('');
      try {
        const data = await api.get(`/weather/search?q=${encodeURIComponent(trimmed)}`);
        if (requestId === requestIdRef.current) setResults(data.results);
      } catch (err) {
        if (requestId === requestIdRef.current) {
          setError(err.message);
          setResults(null);
        }
      } finally {
        if (requestId === requestIdRef.current) setBusy(false);
      }
    }, 350);

    return () => clearTimeout(id);
  }, [query]);

  const labelFor = (r) => [r.name, r.admin1, r.country].filter(Boolean).join(', ');

  return (
    <div className="space-y-3">
      {place ? (
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm">
          <span>{place}</span>
          <span className="text-xs tabular-nums text-slate-500">
            {Number(lat).toFixed(2)}, {Number(lon).toFixed(2)}
          </span>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear location"
            className="text-slate-500 hover:text-rose-400"
          >
            ✕
          </button>
        </div>
      ) : (
        <p className="text-sm text-amber-300/80">
          No location set — weather stays hidden on the frame until you pick one.
        </p>
      )}

      <input
        className="field"
        placeholder="Search for a town or city…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {busy && <p className="text-sm text-slate-500">Searching…</p>}

      {results && results.length === 0 && !busy && (
        <p className="text-sm text-slate-500">No matches.</p>
      )}

      {results && results.length > 0 && (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button
                type="button"
                onClick={() => {
                  onPick({ label: labelFor(r), latitude: r.latitude, longitude: r.longitude });
                  setQuery('');
                  setResults(null);
                }}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition hover:bg-slate-800"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-slate-400">
                    {[r.admin1, r.country].filter(Boolean).join(', ')}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-600">
                  {r.latitude.toFixed(2)}, {r.longitude.toFixed(2)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
