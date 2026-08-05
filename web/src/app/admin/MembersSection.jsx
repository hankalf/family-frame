import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../lib/useAuth.jsx';

export default function MembersSection() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [u, i] = await Promise.all([api.get('/users'), api.get('/invites')]);
      setUsers(u.users);
      setInvites(i.invites);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-rose-400">{error}</p>}

      <section className="space-y-3">
        <h2 className="font-medium">Family members</h2>
        <ul className="space-y-2">
          {users.map((user) => (
            <MemberRow key={user.id} user={user} isMe={user.id === me.id} onChanged={load} />
          ))}
        </ul>
      </section>

      <InvitePanel invites={invites} onChanged={load} />
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label
      className={[
        'flex items-center justify-between gap-3 text-sm',
        disabled ? 'opacity-50' : 'cursor-pointer',
      ].join(' ')}
    >
      <span className="text-slate-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-6 w-10 shrink-0 rounded-full transition',
          checked ? 'bg-sky-500' : 'bg-slate-700',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
            checked ? 'left-[calc(100%-1.375rem)]' : 'left-0.5',
          ].join(' ')}
        />
      </button>
    </label>
  );
}

function MemberRow({ user, isMe, onChanged }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const patch = async (updates) => {
    setError('');
    try {
      await api.patch(`/users/${user.id}`, updates);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900/40">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-3.5 text-left"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-800 text-sm font-semibold uppercase text-slate-300">
          {user.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{user.name}</span>
            {isMe && <span className="text-xs text-slate-500">you</span>}
            {user.isAdmin && (
              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                admin
              </span>
            )}
            {user.disabled && (
              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-300">
                disabled
              </span>
            )}
          </span>
          <span className="block truncate text-sm text-slate-500">{user.email}</span>
        </span>
        <span className="text-slate-600">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-800 p-3.5">
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <Toggle
            label="Can add photos to the frame"
            checked={user.canUploadPhotos}
            onChange={(v) => patch({ canUploadPhotos: v })}
            disabled={user.isAdmin}
          />
          <Toggle
            label="Can add calendar events"
            checked={user.canAddEvents}
            onChange={(v) => patch({ canAddEvents: v })}
            disabled={user.isAdmin}
          />
          <Toggle
            label="Administrator"
            checked={user.isAdmin}
            onChange={(v) => patch({ isAdmin: v })}
            disabled={isMe}
          />
          {user.isAdmin && (
            <p className="text-xs text-slate-600">Admins can always add photos and events.</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              className="btn-ghost text-sm"
              onClick={() => patch({ disabled: !user.disabled })}
              disabled={isMe}
            >
              {user.disabled ? 'Re-enable account' : 'Disable account'}
            </button>
            <button
              className="btn-danger text-sm"
              disabled={isMe}
              onClick={async () => {
                if (!confirm(`Remove ${user.name}? Their photos and events stay on the frame.`))
                  return;
                try {
                  await api.del(`/users/${user.id}`);
                  onChanged();
                } catch (err) {
                  setError(err.message);
                }
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function InvitePanel({ invites, onChanged }) {
  const [form, setForm] = useState({ name: '', canUploadPhotos: true, canAddEvents: false });
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = invites.filter((i) => !i.usedBy);

  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.post('/invites', { ...form, expiresInDays: 14 });
      setCreated(result.code);
      setForm({ name: '', canUploadPhotos: true, canAddEvents: false });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const inviteLink = (code) => `${window.location.origin}/app?invite=${code}`;

  return (
    <section className="space-y-3">
      <h2 className="font-medium">Invite someone</h2>

      <form onSubmit={create} className="card space-y-4">
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div>
          <label className="label" htmlFor="i-name">
            Who is it for? <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id="i-name"
            className="field"
            placeholder="e.g. Grandma"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <Toggle
          label="Can add photos to the frame"
          checked={form.canUploadPhotos}
          onChange={(v) => setForm((f) => ({ ...f, canUploadPhotos: v }))}
        />
        <Toggle
          label="Can add calendar events"
          checked={form.canAddEvents}
          onChange={(v) => setForm((f) => ({ ...f, canAddEvents: v }))}
        />
        <button className="btn-primary" disabled={busy}>
          Create invite link
        </button>
        <p className="text-xs text-slate-600">Invites expire after 14 days if unused.</p>
      </form>

      {created && (
        <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-4">
          <p className="text-sm font-medium text-emerald-300">Share this link:</p>
          <div className="mt-2 flex gap-2">
            <input readOnly className="field flex-1 font-mono text-xs" value={inviteLink(created)} />
            <button
              className="btn-ghost shrink-0"
              onClick={() => navigator.clipboard?.writeText(inviteLink(created))}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map((invite) => (
            <li
              key={invite.code}
              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-3.5 py-2.5 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{invite.name || 'Unnamed invite'}</p>
                <p className="truncate text-xs text-slate-500">
                  {[
                    invite.canUploadPhotos && 'photos',
                    invite.canAddEvents && 'events',
                    invite.isAdmin && 'admin',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'view only'}
                </p>
              </div>
              <button
                className="btn-ghost text-xs"
                onClick={() => navigator.clipboard?.writeText(inviteLink(invite.code))}
              >
                Copy link
              </button>
              <button
                className="text-rose-400 hover:text-rose-300"
                aria-label="Revoke invite"
                onClick={async () => {
                  await api.del(`/invites/${invite.code}`);
                  onChanged();
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
