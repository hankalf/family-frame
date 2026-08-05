import { useCallback, useEffect, useRef, useState } from 'react';
import { api, photoUrl } from '../api.js';
import { useAuth } from '../lib/useAuth.jsx';
import { formatShortDate } from '../lib/dates.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Awaiting approval' },
  { id: 'mine', label: 'Mine' },
];

export default function PhotosPage() {
  const { user, can } = useAuth();
  const [photos, setPhotos] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query =
        filter === 'pending' ? '?status=pending' : filter === 'mine' ? '?mine=true' : '';
      const data = await api.get(`/photos${query}`);
      setPhotos(data.photos);
      setPendingCount(data.pendingCount);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const canUpload = can('canUploadPhotos');

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Photos</h1>
          <p className="mt-1 text-sm text-slate-400">
            {canUpload
              ? 'Anything you add starts showing on the frame.'
              : 'You can view the frame’s photos, but not add to them.'}
          </p>
        </div>
      </div>

      {canUpload && <Uploader onUploaded={load} />}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.filter((f) => f.id !== 'pending' || user.isAdmin).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={[
              'rounded-full px-3.5 py-1.5 text-sm font-medium transition',
              filter === f.id
                ? 'bg-slate-100 text-slate-900'
                : 'border border-slate-800 text-slate-400 hover:text-slate-200',
            ].join(' ')}
          >
            {f.label}
            {f.id === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-xs text-amber-300">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-slate-900" />
          ))}
        </div>
      ) : photos.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>No photos here yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((photo) => (
            <button
              key={photo.id}
              onClick={() => setSelected(photo)}
              className="group relative aspect-square overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
            >
              <img
                src={photoUrl(photo.id, 'thumb')}
                alt={photo.caption || photo.originalName || 'Photo'}
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
              {photo.status !== 'approved' && (
                <span
                  className={[
                    'absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    photo.status === 'pending'
                      ? 'bg-amber-500/90 text-amber-950'
                      : 'bg-rose-500/90 text-rose-950',
                  ].join(' ')}
                >
                  {photo.status}
                </span>
              )}
              {photo.caption && (
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-left text-xs text-white">
                  {photo.caption}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <PhotoDetail
          photo={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function Uploader({ onUploaded }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [dragging, setDragging] = useState(false);

  const send = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;

    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      files.forEach((file) => form.append('photos', file));
      const result = await api.upload('/photos', form);

      const parts = [];
      if (result.photos.length) {
        parts.push(
          `Added ${result.photos.length} photo${result.photos.length === 1 ? '' : 's'}${
            result.pendingApproval ? ' — waiting for approval' : ''
          }`
        );
      }
      if (result.duplicates.length) {
        parts.push(`${result.duplicates.length} already on the frame`);
      }
      setMessage({ tone: 'ok', text: parts.join(' · ') || 'Nothing to add' });
      onUploaded();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          send(e.dataTransfer.files);
        }}
        className={[
          'rounded-2xl border-2 border-dashed p-6 text-center transition',
          dragging ? 'border-sky-500 bg-sky-500/5' : 'border-slate-800 bg-slate-900/30',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => send(e.target.files)}
        />
        <p className="text-sm text-slate-400">
          {busy ? 'Uploading…' : 'Drop photos here, or'}
        </p>
        <button
          type="button"
          className="btn-primary mt-3"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose photos
        </button>
        <p className="mt-2.5 text-xs text-slate-600">
          JPEG, PNG, WebP or HEIC · up to 40&nbsp;MB each
        </p>
      </div>

      {message && (
        <p
          className={[
            'mt-2.5 text-sm',
            message.tone === 'ok' ? 'text-emerald-400' : 'text-rose-400',
          ].join(' ')}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

function PhotoDetail({ photo, onClose, onChanged }) {
  const { user } = useAuth();
  const [caption, setCaption] = useState(photo.caption || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mine = photo.uploadedBy === user.id;
  const canEdit = user.isAdmin || mine;

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={photoUrl(photo.id, 'display')}
          alt={photo.caption || ''}
          className="max-h-[50vh] w-full bg-black object-contain"
        />

        <div className="space-y-4 p-5">
          <div className="text-sm text-slate-400">
            <p>
              Added by {photo.uploadedByName || 'the folder watcher'} ·{' '}
              {formatShortDate(photo.createdAt)}
            </p>
            {photo.width && (
              <p className="mt-0.5 text-xs text-slate-600">
                {photo.width}×{photo.height} · {(photo.bytes / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
          </div>

          {error && <p className="text-sm text-rose-400">{error}</p>}

          {canEdit && (
            <div>
              <label className="label" htmlFor="caption">
                Caption
              </label>
              <input
                id="caption"
                className="field"
                value={caption}
                placeholder="Shown on the frame"
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <button
                className="btn-primary"
                disabled={busy || caption === (photo.caption || '')}
                onClick={() => run(() => api.patch(`/photos/${photo.id}`, { caption }))}
              >
                Save caption
              </button>
            )}

            {user.isAdmin && photo.status !== 'approved' && (
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => run(() => api.patch(`/photos/${photo.id}`, { status: 'approved' }))}
              >
                Approve
              </button>
            )}
            {user.isAdmin && photo.status === 'approved' && (
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => run(() => api.patch(`/photos/${photo.id}`, { status: 'rejected' }))}
              >
                Hide from frame
              </button>
            )}

            {canEdit && (
              <button
                className="btn-danger ml-auto"
                disabled={busy}
                onClick={() => {
                  if (confirm('Delete this photo permanently?')) {
                    run(() => api.del(`/photos/${photo.id}`));
                  }
                }}
              >
                Delete
              </button>
            )}
          </div>

          <button onClick={onClose} className="w-full text-sm text-slate-500 hover:text-slate-300">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
