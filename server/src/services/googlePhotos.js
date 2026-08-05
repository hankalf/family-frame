/**
 * Google Photos source — NOT IMPLEMENTED, deliberately.
 *
 * Why: Google retired the broad `photoslibrary.readonly` scope in 2025. A
 * third-party app can no longer enumerate an existing album or a user's whole
 * library. What remains is:
 *
 *   - photospicker.mediaitems.readonly (Picker API) — the user opens a Google
 *     picker in a browser and hand-selects items; your app gets short-lived
 *     access to just those items. There is no unattended sync, which is exactly
 *     what a wall frame needs, and the base URLs expire (~60 min).
 *   - photoslibrary.appendonly / .readonly.appcreateddata — your app can only
 *     read media it uploaded itself, so an existing family album is invisible.
 *
 * So "point the frame at our shared album and let it refresh forever" is not
 * something the current API supports. Verify against Google's current docs
 * before building on this — the policy has moved more than once.
 *
 * Practical alternatives, in the order I'd try them:
 *
 *   1. The companion app (already built) — family members push photos directly.
 *      No third-party API, no token expiry, and you get moderation for free.
 *   2. The folder source — point `photo_folder_path` at a directory that some
 *      other tool syncs (Syncthing, rclone, a Nextcloud/Immich mount). This is
 *      how most self-hosted frames solve it today.
 *   3. Immich or another self-hosted library with a real read API. To add it,
 *      implement the contract below and register it alongside the folder scanner
 *      in index.js.
 *
 * The contract a source must satisfy:
 *
 *   async function sync() -> { added: number }
 *     - fetch remote items
 *     - skip anything whose content hash already exists in `photos`
 *     - write the file into ORIGINALS_DIR as `<uuid><ext>`
 *     - insert a `photos` row with source = '<your-source>' and source_ref set
 *       to the remote id, then call pregenerate({ id, filename })
 *
 * See photoSources.js#scanPhotoFolder for a working example of that shape.
 */

export const GOOGLE_PHOTOS_STATUS = {
  available: false,
  reason:
    'Google removed general read access to existing Photos libraries in 2025. Use the companion app, or sync an album into a local folder and set photo_folder_path.',
};

export async function sync() {
  throw new Error(GOOGLE_PHOTOS_STATUS.reason);
}
