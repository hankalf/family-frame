import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/useAuth.jsx';
import AuthScreen from './AuthScreen.jsx';
import FeedPage from './FeedPage.jsx';
import PhotosPage from './PhotosPage.jsx';
import EventsPage from './EventsPage.jsx';
import AdminPage from './AdminPage.jsx';
import AccountPage from './AccountPage.jsx';

export default function AppShell() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-500/15 text-sky-400">
              <FrameIcon />
            </span>
            <span className="font-semibold tracking-tight">Family Frame</span>
          </div>
          <NavLink
            to="/app/account"
            className="truncate text-sm text-slate-400 transition hover:text-slate-200"
          >
            {user.name}
          </NavLink>
        </div>

        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pb-2">
          <Tab to="/app" end>
            Feed
          </Tab>
          <Tab to="/app/photos">Photos</Tab>
          <Tab to="/app/events">Calendar</Tab>
          {user.isAdmin && <Tab to="/app/admin">Admin</Tab>}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24">
        <Routes>
          <Route index element={<FeedPage />} />
          <Route path="photos" element={<PhotosPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route
            path="admin/*"
            element={user.isAdmin ? <AdminPage /> : <Navigate to="/app" replace />}
          />
          <Route path="*" element={<Navigate to="/app" replace state={{ from: location }} />} />
        </Routes>
      </main>
    </div>
  );
}

function Tab({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          'shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-medium transition',
          isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  );
}

function FrameIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-5 3.5 3.5L15 13l5 4.5" />
    </svg>
  );
}
