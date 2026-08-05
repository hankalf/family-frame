import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
// Bundled by Vite — deliberately not the CDN <link> from Leaflet's docs, since
// the frame may only reach the LAN plus tile hosts.
import 'leaflet/dist/leaflet.css';
import RadarUnavailable from './RadarUnavailable.jsx';

const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
// Dark base map so it sits in the kiosk's palette instead of glaring white.
const BASE_LAYER = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const BASE_ATTRIBUTION = '© OpenStreetMap · © CARTO · Radar © RainViewer';

const FRAME_COUNT = 8; // bounds tile fetches; radar updates every ~10 min anyway
const FRAME_MS = 600;
const LOOP_PAUSE_MS = 1500;
const METADATA_REFRESH_MS = 5 * 60 * 1000;
const TILE_ERROR_LIMIT = 8;

export default function RadarMap({ latitude, longitude, timezone }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef([]);
  const [failed, setFailed] = useState(false);
  const [frames, setFrames] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return undefined;
    let map;
    try {
      map = L.map(containerRef.current, {
        center: [latitude, longitude],
        zoom: 7,
        minZoom: 4,
        maxZoom: 10, // radar has no detail past ~z10, and it bounds tile fetches
        zoomControl: false,
        attributionControl: true,
        dragging: true,
        touchZoom: true,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        keyboard: false,
      });
      L.tileLayer(BASE_LAYER, { attribution: BASE_ATTRIBUTION, maxZoom: 10 }).addTo(map);
      map.setMaxBounds(map.getBounds().pad(1.5));

      let tileErrors = 0;
      map.on('tileerror', () => {
        tileErrors += 1;
        if (tileErrors > TILE_ERROR_LIMIT) setFailed(true);
      });

      mapRef.current = map;
    } catch (err) {
      console.error('[radar] map init failed:', err.message);
      setFailed(true);
    }

    return () => {
      layersRef.current = [];
      try {
        map?.remove();
      } catch {
        /* already torn down */
      }
      mapRef.current = null;
    };
  }, [latitude, longitude]);

  // Fetch the radar frame index, and refresh it periodically.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(RAINVIEWER_INDEX);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const past = data.radar?.past || [];
        const nowcast = data.radar?.nowcast || [];
        const picked = [...past.slice(-FRAME_COUNT), ...nowcast];
        if (!picked.length) throw new Error('No radar frames available');
        if (!cancelled) {
          // `path` is an opaque hash now, not the timestamp — always use host+path.
          setFrames(picked.map((f) => ({ time: f.time, url: `${data.host}${f.path}` })));
        }
      } catch (err) {
        console.error('[radar] frame index failed:', err.message);
        if (!cancelled) setFailed(true);
      }
    };

    load();
    const id = setInterval(load, METADATA_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Build one tile layer per frame up front; animating opacity avoids the
  // flicker you get from adding/removing layers each tick.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !frames.length) return undefined;

    layersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch {
        /* ignore */
      }
    });

    layersRef.current = frames.map((frame, i) =>
      L.tileLayer(`${frame.url}/256/{z}/{x}/{y}/4/1_1.png`, {
        opacity: 0,
        zIndex: 10 + i,
        maxZoom: 10,
      }).addTo(map)
    );
    setActiveIndex(0);

    return () => {
      layersRef.current.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch {
          /* ignore */
        }
      });
      layersRef.current = [];
    };
  }, [frames]);

  // Step the animation.
  useEffect(() => {
    if (!layersRef.current.length) return undefined;
    layersRef.current.forEach((layer, i) => layer.setOpacity(i === activeIndex ? 0.75 : 0));

    const isLast = activeIndex === layersRef.current.length - 1;
    const id = setTimeout(
      () => setActiveIndex((i) => (i + 1) % layersRef.current.length),
      isLast ? LOOP_PAUSE_MS : FRAME_MS
    );
    return () => clearTimeout(id);
  }, [activeIndex, frames]);

  if (failed) return <RadarUnavailable />;

  const activeFrame = frames[activeIndex];
  const stamp = activeFrame
    ? new Date(activeFrame.time * 1000).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        ...(timezone ? { timeZone: timezone } : {}),
      })
    : '';
  const isNowcast = activeFrame && activeFrame.time * 1000 > Date.now();

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full bg-slate-900" />

      {/* Home marker as CSS rather than an L.Marker — Leaflet's default marker
          images are separate assets whose URLs break under Vite's bundling. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 z-[500] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 bg-sky-400/60 shadow"
        aria-hidden="true"
      />

      {stamp && (
        <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-sm tabular-nums text-slate-200 backdrop-blur-md">
          {stamp}
          {isNowcast && <span className="ml-2 text-sky-400">forecast</span>}
        </div>
      )}

      {/* Finger-sized zoom, since Leaflet's own buttons are 26px. */}
      <div className="absolute bottom-3 right-3 z-[500] flex flex-col gap-1.5">
        {[
          ['+', () => mapRef.current?.zoomIn()],
          ['−', () => mapRef.current?.zoomOut()],
        ].map(([glyph, action]) => (
          <button
            key={glyph}
            onClick={action}
            aria-label={glyph === '+' ? 'Zoom in' : 'Zoom out'}
            className="h-12 w-12 rounded-full border border-white/10 bg-slate-950/70 text-2xl text-slate-200 backdrop-blur-md active:bg-white/10"
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
