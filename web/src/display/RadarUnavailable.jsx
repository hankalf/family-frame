/**
 * Shown in place of the map when radar can't load. Lives in its own file so
 * both WeatherScreen (as the error-boundary fallback, which must not be lazy)
 * and RadarMap (on tile/metadata failure) can use it without a circular import.
 */
export default function RadarUnavailable({ message = 'Radar unavailable' }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-900/40 p-6 text-center">
      <div>
        <p className="text-xl text-slate-400">{message}</p>
        <p className="mt-1.5 text-sm text-slate-600">
          The frame needs internet access to load map tiles.
        </p>
      </div>
    </div>
  );
}
