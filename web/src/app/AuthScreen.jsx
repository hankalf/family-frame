import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../lib/useAuth.jsx';

export default function AuthScreen() {
  const { needsSetup } = useAuth();
  const [params] = useSearchParams();
  const inviteCode = params.get('invite') || '';
  const [mode, setMode] = useState(inviteCode ? 'join' : 'login');

  useEffect(() => {
    if (inviteCode) setMode('join');
  }, [inviteCode]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Family Frame</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {needsSetup
              ? 'Create the first account to get started'
              : 'Photos and calendar for the family display'}
          </p>
        </div>

        {needsSetup ? (
          <SetupForm />
        ) : mode === 'join' ? (
          <JoinForm initialCode={inviteCode} onBack={() => setMode('login')} />
        ) : (
          <LoginForm onJoin={() => setMode('join')} />
        )}
      </div>
    </div>
  );
}

function Alert({ children }) {
  if (!children) return null;
  return (
    <p className="rounded-xl border border-rose-900/60 bg-rose-950/40 px-3.5 py-2.5 text-sm text-rose-300">
      {children}
    </p>
  );
}

function LoginForm({ onJoin }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4">
      <Alert>{error}</Alert>
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="field"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="field"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <button type="button" onClick={onJoin} className="w-full text-sm text-slate-400 hover:text-slate-200">
        I have an invite code
      </button>
    </form>
  );
}

function SetupForm() {
  const { setup } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await setup(form);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form onSubmit={submit} className="card space-y-4">
      <Alert>{error}</Alert>
      <p className="text-sm text-slate-400">
        This first account is an admin: it manages the display, calendar feeds and who else can
        join.
      </p>
      <div>
        <label className="label" htmlFor="s-name">
          Your name
        </label>
        <input id="s-name" className="field" value={form.name} onChange={update('name')} required />
      </div>
      <div>
        <label className="label" htmlFor="s-email">
          Email
        </label>
        <input
          id="s-email"
          type="email"
          className="field"
          autoComplete="username"
          value={form.email}
          onChange={update('email')}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="s-password">
          Password
        </label>
        <input
          id="s-password"
          type="password"
          className="field"
          autoComplete="new-password"
          minLength={8}
          value={form.password}
          onChange={update('password')}
          required
        />
        <p className="mt-1.5 text-xs text-slate-500">At least 8 characters.</p>
      </div>
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Creating…' : 'Create admin account'}
      </button>
    </form>
  );
}

function JoinForm({ initialCode, onBack }) {
  const { register } = useAuth();
  const [code, setCode] = useState(initialCode);
  const [invite, setInvite] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Preview the invite so people can see what they're being given.
  useEffect(() => {
    const trimmed = code.trim();
    if (trimmed.length < 6) {
      setInvite(null);
      return undefined;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const data = await api.get(`/auth/invite/${encodeURIComponent(trimmed)}`);
        if (!cancelled) {
          setInvite(data.invite);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setInvite(null);
          setError(err.message);
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [code]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register({ code: code.trim(), ...form });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form onSubmit={submit} className="card space-y-4">
      <Alert>{error}</Alert>
      <div>
        <label className="label" htmlFor="j-code">
          Invite code
        </label>
        <input
          id="j-code"
          className="field font-mono"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
      </div>

      {invite && (
        <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-3.5 py-3 text-sm">
          <p className="font-medium text-emerald-300">Invite found</p>
          <ul className="mt-1.5 space-y-0.5 text-emerald-200/70">
            <li>{invite.canUploadPhotos ? '✓' : '✕'} Add photos to the frame</li>
            <li>{invite.canAddEvents ? '✓' : '✕'} Add calendar events</li>
            {invite.isAdmin && <li>✓ Administrator</li>}
          </ul>
        </div>
      )}

      <div>
        <label className="label" htmlFor="j-name">
          Your name
        </label>
        <input id="j-name" className="field" value={form.name} onChange={update('name')} required />
      </div>
      <div>
        <label className="label" htmlFor="j-email">
          Email
        </label>
        <input
          id="j-email"
          type="email"
          className="field"
          autoComplete="username"
          value={form.email}
          onChange={update('email')}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="j-password">
          Choose a password
        </label>
        <input
          id="j-password"
          type="password"
          className="field"
          autoComplete="new-password"
          minLength={8}
          value={form.password}
          onChange={update('password')}
          required
        />
      </div>

      <button className="btn-primary w-full" disabled={busy || !invite}>
        {busy ? 'Creating…' : 'Join'}
      </button>
      <button type="button" onClick={onBack} className="w-full text-sm text-slate-400 hover:text-slate-200">
        Back to sign in
      </button>
    </form>
  );
}
