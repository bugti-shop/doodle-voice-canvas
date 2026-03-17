import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  GoogleUser,
  signInWithGoogle,
  signOutGoogle,
  getStoredGoogleUser,
  loadGoogleIdentityServices,
  backgroundTokenRefresh,
  onFirebaseAuthStateChanged,
} from '@/utils/googleAuth';
import { setSetting } from '@/utils/settingsStorage';

interface GoogleAuthContextType {
  user: GoogleUser | null;
  isLoading: boolean;
  isSigningIn: boolean;
  signIn: () => Promise<GoogleUser>;
  signOut: () => Promise<void>;
}

const GoogleAuthContext = createContext<GoogleAuthContextType | undefined>(undefined);

const BG_REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes
const SESSION_TTL = 365 * 24 * 3600 * 1000;

export function GoogleAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>();

  // Load stored user on mount — ALWAYS restore if stored, no expiry check
  useEffect(() => {
    const loadUser = async () => {
      try {
        const stored = await getStoredGoogleUser();
        if (stored) {
          // Extend session silently so user never gets logged out
          if (stored.expiresAt < Date.now() + 30 * 24 * 3600 * 1000) {
            stored.expiresAt = Date.now() + SESSION_TTL;
            await setSetting('googleUser', stored);
          }
          setUser(stored);
        }
        loadGoogleIdentityServices().catch(() => {});
      } catch (err) {
        console.error('Failed to load Google user:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadUser();
  }, []);

  // Listen to Firebase auth state — always ensure stored context carries Firebase UID
  useEffect(() => {
    const unsubscribe = onFirebaseAuthStateChanged(async (fbUser) => {
      if (!fbUser) return;
      if (user?.uid === fbUser.uid) return;

      const stored = await getStoredGoogleUser();
      const nextUser: GoogleUser = stored
        ? { ...stored, uid: fbUser.uid, expiresAt: Date.now() + SESSION_TTL }
        : {
            email: fbUser.email || '',
            name: fbUser.displayName || fbUser.email || '',
            picture: fbUser.photoURL || '',
            accessToken: '',
            uid: fbUser.uid,
            accessTokenExpiresAt: 0,
            expiresAt: Date.now() + SESSION_TTL,
          };

      await setSetting('googleUser', nextUser);
      setUser(nextUser);
    });
    return () => unsubscribe();
  }, [user?.uid]);

  // Background token refresh
  useEffect(() => {
    if (!user) return;

    backgroundTokenRefresh().catch(() => {});

    refreshTimerRef.current = setInterval(() => {
      backgroundTokenRefresh().then(async () => {
        const refreshed = await getStoredGoogleUser();
        if (refreshed) setUser(refreshed);
      }).catch(() => {});
    }, BG_REFRESH_INTERVAL);

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [user?.email]);

  const signIn = useCallback(async (): Promise<GoogleUser> => {
    setIsSigningIn(true);
    try {
      const googleUser = await signInWithGoogle();
      setUser(googleUser);
      // Notify RevenueCat to associate subscription with this account
      window.dispatchEvent(new CustomEvent('googleAuthStateChanged'));
      return googleUser;
    } catch (err) {
      console.error('Google sign-in failed:', err);
      throw err;
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await signOutGoogle();
    setUser(null);
    // Notify RevenueCat to disassociate subscription
    window.dispatchEvent(new CustomEvent('googleAuthStateChanged'));
  }, []);

  return (
    <GoogleAuthContext.Provider value={{ user, isLoading, isSigningIn, signIn, signOut }}>
      {children}
    </GoogleAuthContext.Provider>
  );
}

export function useGoogleAuth() {
  const context = useContext(GoogleAuthContext);
  if (!context) {
    throw new Error('useGoogleAuth must be used within a GoogleAuthProvider');
  }
  return context;
}
