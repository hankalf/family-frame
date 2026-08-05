/**
 * Shortens an event location for a display that's read from across a room.
 *
 * Calendar feeds put all sorts of things in this field — full postal addresses,
 * "Room 3B, Building 2, ...", and very often a raw video-call URL. A wall frame
 * wants the recognisable part, not the whole string.
 */

const VIDEO_HOSTS = [
  [/zoom\.us/i, 'Zoom'],
  [/meet\.google\.com/i, 'Google Meet'],
  [/teams\.(microsoft|live)\.com/i, 'Teams'],
  [/webex\.com/i, 'Webex'],
  [/whereby\.com/i, 'Whereby'],
  [/facetime/i, 'FaceTime'],
];

/** Postal codes and country names carry no meaning on a family frame. */
const NOISE = [
  /^\d{5}(-\d{4})?$/, // US ZIP
  /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i, // UK postcode
  /^\d{3}\s?\d{2}$/, // SE postcode
  /^(usa|united states|uk|united kingdom|canada|australia|sverige|sweden|deutschland|germany)$/i,
];

export function formatLocation(raw, maxLength = 42) {
  const value = String(raw || '').trim();
  if (!value) return null;

  // A bare link is almost always a video call — name the service instead.
  const url = value.match(/https?:\/\/\S+/i);
  if (url) {
    for (const [pattern, label] of VIDEO_HOSTS) {
      if (pattern.test(url[0])) return label;
    }
    // Some other link: show the host, which is at least recognisable.
    try {
      return new URL(url[0]).hostname.replace(/^www\./, '');
    } catch {
      return 'Online';
    }
  }

  for (const [pattern, label] of VIDEO_HOSTS) {
    if (pattern.test(value)) return label;
  }

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !NOISE.some((pattern) => pattern.test(part)));

  if (!parts.length) return null;

  // The first part is the venue or street — the bit people actually recognise.
  let short = parts[0];
  // Keep the town too if there's room; it disambiguates a chain or a clinic.
  if (parts.length > 1 && short.length + parts[1].length + 2 <= maxLength) {
    short = `${short}, ${parts[1]}`;
  }

  if (short.length > maxLength) short = `${short.slice(0, maxLength - 1).trimEnd()}…`;
  return short;
}
