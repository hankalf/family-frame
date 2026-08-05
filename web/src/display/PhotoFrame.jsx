import { useEffect, useMemo, useRef, useState } from 'react';
import { photoUrl } from '../api.js';


const PREFETCH_AHEAD = 4;

/**
 * Weighted shuffle: a photo the family has liked shows up more often, but every
 * photo still appears — this biases the order, it doesn't filter.
 */
function shuffled(list) {
  const pool = list.map((photo) => ({
    photo,
    // Random key raised to 1/weight — the standard trick for weighted sampling
    // without replacement. More likes → key closer to 1 → sorts earlier.
    key: Math.random() ** (1 / (1 + Math.min(5, photo.likes || 0))),
  }));
  return pool.sort((a, b) => b.key - a.key).map((entry) => entry.photo);
}

/**
 * Merges a refreshed playlist into the running order: keeps the photos already
 * queued in place (so the rotation doesn't restart every five minutes), drops
 * deleted ones, and appends anything new.
 */
function mergeOrder(previousOrder, photos, shuffle) {
  const byId = new Map(photos.map((p) => [p.id, p]));
  const kept = previousOrder.filter((p) => byId.has(p.id)).map((p) => byId.get(p.id));
  const keptIds = new Set(kept.map((p) => p.id));
  const added = photos.filter((p) => !keptIds.has(p.id));
  if (!previousOrder.length) return shuffle ? shuffled(photos) : photos;
  return [...kept, ...(shuffle ? shuffled(added) : added)];
}

export default function PhotoFrame({
  photos,
  slideSeconds,
  transition,
  shuffle,
  showCaptions,
  inset,
  fit = 'contain',
  edgeFadePercent = 18,
  backdropOpacity = 40,
  crossfadeMs = 1400,
  kenburnsZoom = 12,
  sidebarWidthRem = 34,
}) {
  const [order, setOrder] = useState([]);
  const [index, setIndex] = useState(0);
  const orderRef = useRef(order);
  orderRef.current = order;

  useEffect(() => {
    const next = mergeOrder(orderRef.current, photos, shuffle);
    setOrder(next);
    setIndex((current) => (next.length ? current % next.length : 0));
  }, [photos, shuffle]);

  const currentPhoto = order[index] ?? null;
  const nextPhoto = order.length > 1 ? order[(index + 1) % order.length] : null;

  // Advance the slideshow.
  useEffect(() => {
    if (order.length < 2) return undefined;
    const ms = Math.max(3, slideSeconds) * 1000;
    const id = setTimeout(() => setIndex((i) => (i + 1) % order.length), ms);
    return () => clearTimeout(id);
  }, [index, order.length, slideSeconds]);

  /**
   * Fetch several slides ahead, not just one. The images are served with a
   * long immutable cache header, so once fetched they survive a network blip —
   * which is what used to leave a blank slide mid-rotation. Keeping the Image
   * objects in a ref stops them being collected before the browser caches them.
   */
  const prefetchRef = useRef([]);
  useEffect(() => {
    if (order.length < 2) return;
    prefetchRef.current = [];
    for (let i = 1; i <= Math.min(PREFETCH_AHEAD, order.length - 1); i += 1) {
      const photo = order[(index + i) % order.length];
      const img = new Image();
      img.src = photoUrl(photo.id, 'display');
      prefetchRef.current.push(img);
    }
  }, [index, order]);

  // Keep the outgoing slide mounted underneath until the fade completes.
  const [previousPhoto, setPreviousPhoto] = useState(null);
  const lastShownRef = useRef(null);
  useEffect(() => {
    if (!currentPhoto) return undefined;
    if (lastShownRef.current && lastShownRef.current.id !== currentPhoto.id) {
      setPreviousPhoto(lastShownRef.current);
      const id = setTimeout(() => setPreviousPhoto(null), crossfadeMs + 100);
      lastShownRef.current = currentPhoto;
      return () => clearTimeout(id);
    }
    lastShownRef.current = currentPhoto;
    return undefined;
  }, [currentPhoto]);

  const paddingLeft = inset ? `${sidebarWidthRem - 6}rem` : '0px';

  /**
   * A soft fade on every edge of the photo. The left side gets a much wider,
   * gentler ramp when the agenda is showing, so the photo dissolves into the
   * panel's gradient rather than butting against it.
   */
  const fade = Math.max(0, Math.min(45, edgeFadePercent));
  const edgeFade = fade
    ? [
        `linear-gradient(to right, transparent 0%, black ${inset ? fade : Math.min(12, fade / 3)}%, black ${100 - Math.min(8, fade / 3)}%, transparent 100%)`,
        `linear-gradient(to bottom, transparent 0%, black ${Math.min(8, fade / 3)}%, black ${100 - Math.min(8, fade / 3)}%, transparent 100%)`,
      ].join(', ')
    : undefined;

  if (!photos.length) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
        <div className="text-center" style={{ paddingLeft }}>
          <p className="text-2xl font-medium text-slate-400">No photos yet</p>
          <p className="mt-2 text-slate-600">
            Add some from the family app and they'll appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {previousPhoto && (
        <Slide
          key={`prev-${previousPhoto.id}`}
          photo={previousPhoto}
          visible
          kenburns={false}
          slideSeconds={slideSeconds}
          paddingLeft={paddingLeft}
          edgeFade={edgeFade}
          fit={fit}
          backdropOpacity={backdropOpacity}
          crossfadeMs={crossfadeMs}
          kenburnsZoom={kenburnsZoom}
          zIndex={0}
        />
      )}
      {currentPhoto && (
        <Slide
          key={`cur-${currentPhoto.id}`}
          photo={currentPhoto}
          kenburns={transition === 'kenburns'}
          slideSeconds={slideSeconds}
          paddingLeft={paddingLeft}
          edgeFade={edgeFade}
          fit={fit}
          backdropOpacity={backdropOpacity}
          crossfadeMs={crossfadeMs}
          kenburnsZoom={kenburnsZoom}
          zIndex={10}
        />
      )}

      {showCaptions && currentPhoto && (
        <Caption key={currentPhoto.id} photo={currentPhoto} />
      )}
    </div>
  );
}

function Slide({
  photo,
  visible,
  kenburns,
  slideSeconds,
  paddingLeft,
  zIndex,
  edgeFade,
  fit = 'contain',
  backdropOpacity = 40,
  crossfadeMs = 1400,
  kenburnsZoom = 12,
}) {
  const [shown, setShown] = useState(!!visible);
  // A slide that fails to load (blip mid-fetch) retries once rather than
  // leaving a hole in the rotation.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (visible) return undefined;
    // Two frames: one to mount at opacity 0, one to start the transition.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(id);
  }, [visible]);

  const src = `${photoUrl(photo.id, 'display')}${attempt ? `&retry=${attempt}` : ''}`;
  const retry = () => {
    if (attempt < 2) setTimeout(() => setAttempt((a) => a + 1), 2000);
  };

  return (
    <div
      className="absolute inset-0 transition-opacity ease-in-out"
      style={{
        opacity: shown ? 1 : 0,
        transitionDuration: `${crossfadeMs}ms`,
        zIndex,
      }}
    >
      {/* Blurred fill so portrait photos don't sit in black bars. */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-3xl"
        style={{ opacity: backdropOpacity / 100 }}
      />
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          paddingLeft,
          // Feather the photo's edges so it melts into the background instead
          // of ending on a hard line — especially where it meets the agenda
          // panel on the left.
          maskImage: edgeFade,
          WebkitMaskImage: edgeFade,
        }}
      >
        <img
          src={src}
          alt={photo.caption || ''}
          onError={retry}
          className={
            fit === 'cover'
              ? 'h-full w-full object-cover'
              : 'max-h-full max-w-full object-contain drop-shadow-2xl'
          }
          style={
            kenburns
              ? {
                  animation: `kenburns ${slideSeconds + 2}s ease-out forwards`,
                  // Drives the @keyframes via a custom property so the zoom
                  // depth is adjustable without a second animation.
                  '--kenburns-scale': 1 + kenburnsZoom / 100,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

function Caption({ photo }) {
  const label = useMemo(() => {
    const bits = [];
    if (photo.caption) bits.push(photo.caption);
    if (photo.addedBy) bits.push(`Added by ${photo.addedBy}`);
    return bits;
  }, [photo]);

  if (!label.length) return null;

  return (
    <div className="absolute bottom-8 right-9 z-30 max-w-lg animate-fadeUp text-right">
      {photo.caption && (
        <p className="text-2xl font-medium text-white drop-shadow-lg">{photo.caption}</p>
      )}
      {photo.addedBy && (
        <p className="mt-1 text-sm text-white/60 drop-shadow">Added by {photo.addedBy}</p>
      )}
    </div>
  );
}
