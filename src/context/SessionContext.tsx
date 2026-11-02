import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  getAuthState,
  getCurrentUser,
  isDesktopAvailable,
  login,
  logout,
  setupOwner as setupOwnerRequest,
  type AuthResult,
  type SetupOwnerInput,
} from '@/services/authService';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  roleId: string;
  roleLabel: string;
  permissions: Set<string>;
}

interface SessionContextValue {
  user: SessionUser | null;
  checking: boolean;
  needsSetup: boolean;
  desktopAvailable: boolean;
  sessionError: string | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  setupOwner: (input: SetupOwnerInput) => Promise<void>;
  signOut: () => Promise<void>;
  hasPermission: (perm: string) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function toSessionUser(result: AuthResult): SessionUser {
  return {
    id: result.id,
    username: result.username,
    displayName: result.displayName,
    roleId: result.roleId,
    roleLabel: result.roleLabel,
    permissions: new Set(result.permissions),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const desktopAvailable = isDesktopAvailable();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(desktopAvailable);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!desktopAvailable) return;
    let cancelled = false;

    async function restoreSession() {
      try {
        const [state, current] = await Promise.all([getAuthState(), getCurrentUser()]);
        if (cancelled) return;
        setNeedsSetup(state.needsSetup);
        setUser(current ? toSessionUser(current) : null);
      } catch (error) {
        if (!cancelled) setSessionError(errorMessage(error));
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, [desktopAvailable]);

  const signIn = useCallback(async (username: string, password: string) => {
    setLoading(true);
    try {
      setUser(toSessionUser(await login(username, password)));
    } finally {
      setLoading(false);
    }
  }, []);

  const setupOwner = useCallback(async (input: SetupOwnerInput) => {
    setLoading(true);
    try {
      setUser(toSessionUser(await setupOwnerRequest(input)));
      setNeedsSetup(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setUser(null);
    }
  }, []);

  const hasPermission = useCallback(
    (perm: string) => {
      if (!user) return false;
      if (user.roleId === 'owner') return true;
      return user.permissions.has(perm);
    },
    [user]
  );

  return (
    <SessionContext.Provider
      value={{
        user,
        checking,
        needsSetup,
        desktopAvailable,
        sessionError,
        loading,
        signIn,
        setupOwner,
        signOut,
        hasPermission,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
