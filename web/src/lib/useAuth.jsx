import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/auth/status');
      setUser(data.user);
      setNeedsSetup(data.needsSetup);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      needsSetup,
      loading,
      refresh,
      login: async (email, password) => {
        const data = await api.post('/auth/login', { email, password });
        setUser(data.user);
        return data.user;
      },
      logout: async () => {
        await api.post('/auth/logout');
        setUser(null);
      },
      register: async (payload) => {
        const data = await api.post('/auth/register', payload);
        setUser(data.user);
        return data.user;
      },
      setup: async (payload) => {
        const data = await api.post('/auth/setup', payload);
        setUser(data.user);
        setNeedsSetup(false);
        return data.user;
      },
      // Admins implicitly hold every permission.
      can: (permission) => {
        if (!user) return false;
        if (user.isAdmin) return true;
        return !!user[permission];
      },
    }),
    [user, needsSetup, loading, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
