import { useEffect, useMemo, useRef, useState } from 'react';
import { photoUrl } from '../api.js';

const CROSSFADE_MS = 1400;

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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

  // Fetch the next image while the current one is still on screen, so the
  // crossfade never lands on a half-decoded frame.
  useEffect(() => {
    if (!nextPhoto) return;
    const img = new Image();
    img.src = photoUrl(nextPhoto.id, 'display');
  }, [nextPhoto]);

  // Keep the outgoing slide mounted underneath until the fade completes.
  const [previousPhoto, setPreviousPhoto] = useState(null);
  const lastShownRef = useRef(null);
  useEffect(() => {
    if (!currentPhoto) return undefined;
    if (lastShownRef.current && lastShownRef.current.id !== currentPhoto.id) {
      setPreviousPhoto(lastShownRef.current);
      const id = setTimeout(() => setPreviousPhoto(null), CROSSFADE_MS + 100);
      lastShownRef.current = currentPhoto;
      return () => clearTimeout(id);
    }
    lastShownRef.current = currentPhoto;
    return undefined;
  }, [currentPhoto]);

  const paddingLeft = inset ? '28rem' : '0px';

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
          zIndex={10}
        />
      )}

      {showCaptions && currentPhoto && (
        <Caption key={currentPhoto.id} photo={currentPhoto} />
      )}
    </div>
  );
}

function Slide({ photo, visible, kenburns, slideSeconds, paddingLeft, zIndex }) {
  const [shown, setShown] = useState(!!visible);

  useEffect(() => {
    if (visible) return undefined;
    // Two frames: one to mount at opacity 0, one to start the transition.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(id);
  }, [visible]);

  const src = photoUrl(photo.id, 'display');

  return (
    <div
      className="absolute inset-0 transition-opacity ease-in-out"
      style={{
        opacity: shown ? 1 : 0,
        transitionDuration: `${CROSSFADE_MS}ms`,
        zIndex,
      }}
    >
      {/* Blurred fill so portrait photos don't sit in black bars. */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-3xl"
      />
      <div className="absolute inset-0 flex items-center justify-center" style={{ paddingLeft }}>
        <img
          src={src}
          alt={photo.caption || ''}
          className="max-h-full max-w-full object-contain drop-shadow-2xl"
          style={
            kenburns
              ? {
                  animation: `kenburns ${slideSeconds + 2}s ease-out forwards`,
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
