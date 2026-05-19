import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { clearToken, getToken, setToken } from '../lib/auth';
import { disconnectSocket } from '../lib/socket';
import type { Player } from '../types';

interface AuthConfig {
  googleClientId: string | null;
  enabled: boolean;
}

interface AuthState {
  player: Player | null;
  isAdmin: boolean;
  config: AuthConfig | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  signInWithGoogle: (credential: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface MeResponse { player: Player; isAdmin: boolean }
interface GoogleResponse { player: Player; token: string; expiresAt: string; isAdmin: boolean }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setPlayer(null);
      setIsAdmin(false);
      return;
    }
    try {
      const me = await api.get<MeResponse>('/api/auth/me');
      setPlayer(me.player);
      setIsAdmin(me.isAdmin);
    } catch {
      clearToken();
      setPlayer(null);
      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.get<AuthConfig>('/api/auth/config');
        if (cancelled) return;
        setConfig(cfg);
      } catch {
        if (cancelled) return;
        setConfig({ googleClientId: null, enabled: false });
      }
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    const onExpired = () => {
      setPlayer(null);
      setIsAdmin(false);
      disconnectSocket();
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const signInWithGoogle = useCallback(async (credential: string) => {
    const res = await api.post<GoogleResponse>('/api/auth/google', { credential });
    setToken(res.token);
    setPlayer(res.player);
    setIsAdmin(res.isAdmin);
    disconnectSocket();
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout', {});
    } catch {}
    clearToken();
    setPlayer(null);
    setIsAdmin(false);
    disconnectSocket();
  }, []);

  return (
    <AuthContext.Provider value={{ player, isAdmin, config, loading, signInWithGoogle, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
