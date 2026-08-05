import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../lib/useAuth.jsx';

export default function AccountPage() {
  const { user, logout } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const changePassword = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/auth/password', form);
      setMessage({ tone: 'ok', text: 'Password updated.' });
      setForm({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="card">
        <h1 className="font-medium">{user.name}</h1>
        <p className="mt-0.5 text-sm text-slate-500">{user.email}</p>
        <ul className="mt-3 space-y-1 text-sm text-slate-400">
          <li>{user.isAdmin || user.canUploadPhotos ? '✓' : '✕'} Add photos</li>
          <li>{user.isAdmin || user.canAddEvents ? '✓' : '✕'} Add calendar events</li>
          {user.isAdmin && <li>✓ Administrator</li>}
        </ul>
      </div>

      <form onSubmit={changePassword} className="card space-y-4">
        <h2 className="font-medium">Change password</h2>
        {message && (
          <p
            className={[
              'text-sm',
              message.tone === 'ok' ? 'text-emerald-400' : 'text-rose-400',
            ].join(' ')}
          >
            {message.text}
          </p>
        )}
        <div>
          <label className="label" htmlFor="a-current">
            Current password
          </label>
          <input
            id="a-current"
            type="password"
            className="field"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="a-new">
            New password
          </label>
          <input
            id="a-new"
            type="password"
            className="field"
            autoComplete="new-password"
            minLength={8}
            value={form.newPassword}
            onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
            required
          />
        </div>
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>

      <button className="btn-ghost w-full" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}
