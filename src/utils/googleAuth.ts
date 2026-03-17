// Google Sign-In via Firebase Auth — native (Capgo Social Login) on Android/iOS, Firebase popup on web
import { Capacitor } from '@capacitor/core';
import { getSetting, setSetting, removeSetting } from './settingsStorage';
import { firebaseAuth, googleProvider } from '@/lib/firebase';
import {
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';

const CLIENT_ID = '425291387152-n9k3dc2b60nbsup70tub111n8l8o22lo.apps.googleusercontent.com';
const NATIVE_SCOPES = ['openid', 'email', 'profile'];
const SESSION_TTL = 365 * 24 * 3600 * 1000; // 1 year session
const ACCESS_TOKEN_TTL = 3500 * 1000; // ~58 min
const NATIVE_LOGIN_OPTIONS = {
  scopes: NATIVE_SCOPES,
  forceRefreshToken: true,
  filterByAuthorizedAccounts: false,
  autoSelectEnabled: false,
};

export interface GoogleUser {
  email: string;
  name: string;
  picture: string;
  accessToken: string;
  /** Firebase ID token */
  idToken?: string;
  /** Firebase UID */
  uid?: string;
  accessTokenExpiresAt: number;
  expiresAt: number;
}

const isNative = () => Capacitor.isNativePlatform();

const makeUser = (
  profile: { email: string; name: string; picture: string },
  accessToken: string,
  firebaseUser?: FirebaseUser,
): GoogleUser => ({
  ...profile,
  accessToken,
  uid: firebaseUser?.uid,
  accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_TTL,
  expiresAt: Date.now() + SESSION_TTL,
});

// ── Native (Capgo Social Login → Firebase credential) ─────────────────────

let nativeInitialized = false;

const ensureNativeInit = async () => {
  if (nativeInitialized) return;
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  await SocialLogin.initialize({
    google: { webClientId: CLIENT_ID },
  });
  nativeInitialized = true;
};

const getNativeAccessToken = (result: any): string => {
  const r = result?.result ?? result;
  return (
    r?.accessToken?.token ||
    r?.accessToken ||
    result?.accessToken?.token ||
    result?.accessToken ||
    ''
  );
};

const getNativeIdToken = (result: any): string => {
  const r = result?.result ?? result;
  return (
    r?.idToken ||
    result?.idToken ||
    r?.credential?.idToken ||
    ''
  );
};

const extractNativeProfile = async (r: any, accessToken: string) => {
  let email = r.profile?.email || r.email || '';
  let name = r.profile?.name || r.name || '';
  let picture = r.profile?.imageUrl || r.profile?.picture || '';

  if (!email && accessToken) {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const info = await res.json();
        email = info.email || email;
        name = info.name || name;
        picture = info.picture || picture;
      }
    } catch {}
  }
  return { email, name: name || email, picture };
};

const nativeSignIn = async (): Promise<GoogleUser> => {
  await ensureNativeInit();
  const { SocialLogin } = await import('@capgo/capacitor-social-login');

  const result = await SocialLogin.login({
    provider: 'google',
    options: NATIVE_LOGIN_OPTIONS,
  });

  const r = result.result as any;
  const accessToken = getNativeAccessToken(result);
  const idToken = getNativeIdToken(result);

  if (!accessToken) throw new Error('No access token received from Google Sign-In');

  // Sign into Firebase with the Google credential
  let firebaseUser: FirebaseUser | undefined;
  if (idToken) {
    try {
      const credential = GoogleAuthProvider.credential(idToken, accessToken);
      const userCredential = await signInWithCredential(firebaseAuth, credential);
      firebaseUser = userCredential.user;
    } catch (e) {
      console.warn('Firebase credential sign-in failed, continuing with Google token:', e);
    }
  }

  const profile = await extractNativeProfile(r, accessToken);
  const user = makeUser(profile, accessToken, firebaseUser);
  await setSetting('googleUser', user);
  return user;
};

const nativeSignOut = async () => {
  try {
    const { SocialLogin } = await import('@capgo/capacitor-social-login');
    await SocialLogin.logout({ provider: 'google' });
  } catch {}
};

let nativeRefreshCooldownUntil = 0;
const REFRESH_RETRY_COOLDOWN_MS = 2 * 60 * 1000;

const nativeRefresh = async (): Promise<GoogleUser> => {
  const stored = await getStoredGoogleUser();
  if (!stored) throw new Error('No stored Google user');

  if (Date.now() < nativeRefreshCooldownUntil) return stored;

  await ensureNativeInit();
  const { SocialLogin } = await import('@capgo/capacitor-social-login');

  try {
    const refreshResult = await SocialLogin.refresh({
      provider: 'google',
      options: NATIVE_LOGIN_OPTIONS,
    });

    const accessToken = getNativeAccessToken(refreshResult);
    if (!accessToken) {
      nativeRefreshCooldownUntil = Date.now() + REFRESH_RETRY_COOLDOWN_MS;
      return stored;
    }

    nativeRefreshCooldownUntil = 0;
    const refreshedUser: GoogleUser = {
      ...stored,
      accessToken,
      accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_TTL,
      expiresAt: Date.now() + SESSION_TTL,
    };

    await setSetting('googleUser', refreshedUser);
    return refreshedUser;
  } catch (err) {
    nativeRefreshCooldownUntil = Date.now() + REFRESH_RETRY_COOLDOWN_MS;
    console.warn('Native silent refresh failed, keeping stored token:', err);
    return stored;
  }
};

// ── Web (Firebase Auth popup) ─────────────────────────────────────────────

let refreshInProgress: Promise<GoogleUser | null> | null = null;
let tokenRefreshInProgress: Promise<GoogleUser> | null = null;
let webSilentRefreshCooldownUntil = 0;

// No longer need GIS script loading — Firebase handles everything

export const loadGoogleIdentityServices = (): Promise<void> => {
  // No-op now — Firebase Auth handles web sign-in
  return Promise.resolve();
};

const webSignIn = async (): Promise<GoogleUser> => {
  const result = await signInWithPopup(firebaseAuth, googleProvider);
  const firebaseUser = result.user;

  // Get Google access token from credential
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken || '';

  const profile = {
    email: firebaseUser.email || '',
    name: firebaseUser.displayName || firebaseUser.email || '',
    picture: firebaseUser.photoURL || '',
  };

  const user = makeUser(profile, accessToken, firebaseUser);
  await setSetting('googleUser', user);
  return user;
};

const webSignOut = async () => {
  try {
    await firebaseSignOut(firebaseAuth);
  } catch {}
};

// Silent web refresh via Firebase token refresh
const silentWebRefresh = async (): Promise<GoogleUser | null> => {
  if (Date.now() < webSilentRefreshCooldownUntil) return null;
  if (refreshInProgress) return refreshInProgress;

  refreshInProgress = (async () => {
    try {
      const fbUser = firebaseAuth.currentUser;
      if (!fbUser) return null;

      // Force token refresh
      const idToken = await fbUser.getIdToken(true);
      const stored = await getStoredGoogleUser();
      if (!stored) return null;

      const user: GoogleUser = {
        ...stored,
        uid: fbUser.uid,
        idToken,
        accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_TTL,
        expiresAt: Date.now() + SESSION_TTL,
      };
      await setSetting('googleUser', user);
      webSilentRefreshCooldownUntil = 0;
      return user;
    } catch {
      webSilentRefreshCooldownUntil = Date.now() + REFRESH_RETRY_COOLDOWN_MS;
      return null;
    }
  })();

  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }
};

// ── Unified API ───────────────────────────────────────────────────────────

export const signInWithGoogle = (): Promise<GoogleUser> =>
  isNative() ? nativeSignIn() : webSignIn();

export const signOutGoogle = async (): Promise<void> => {
  if (isNative()) {
    await nativeSignOut();
  } else {
    await webSignOut();
  }
  await firebaseSignOut(firebaseAuth).catch(() => {});
  await removeSetting('googleUser');
};

export const getStoredGoogleUser = async (): Promise<GoogleUser | null> => {
  const user = await getSetting<GoogleUser | null>('googleUser', null);
  if (!user) return null;
  if (!user.accessTokenExpiresAt) {
    user.accessTokenExpiresAt = 0;
  }
  return user;
};

export const isSessionValid = (user: GoogleUser): boolean =>
  user.expiresAt > Date.now();

export const isAccessTokenFresh = (user: GoogleUser): boolean =>
  user.accessTokenExpiresAt > Date.now() + 60000;

/** @deprecated Use isAccessTokenFresh instead */
export const isTokenValid = (user: GoogleUser): boolean =>
  isAccessTokenFresh(user);

export const refreshGoogleToken = async (): Promise<GoogleUser> => {
  if (tokenRefreshInProgress) return tokenRefreshInProgress;

  tokenRefreshInProgress = (async () => {
    if (isNative()) return nativeRefresh();

    const silent = await silentWebRefresh();
    if (silent) return silent;

    const stored = await getStoredGoogleUser();
    if (stored) return stored;
    throw new Error('Token refresh failed');
  })();

  try {
    return await tokenRefreshInProgress;
  } finally {
    tokenRefreshInProgress = null;
  }
};

export const getValidAccessToken = async (): Promise<string | null> => {
  const user = await getStoredGoogleUser();
  if (!user) return null;

  if (!isSessionValid(user)) return null;

  if (isNative()) return user.accessToken;

  if (isAccessTokenFresh(user)) return user.accessToken;

  try {
    const refreshed = await silentWebRefresh();
    if (refreshed) return refreshed.accessToken;
  } catch {}

  return user.accessToken;
};

export const backgroundTokenRefresh = async (): Promise<void> => {
  if (isNative()) return;
  const user = await getStoredGoogleUser();
  if (!user || !isSessionValid(user)) return;
  if (isAccessTokenFresh(user)) return;

  try {
    await silentWebRefresh();
  } catch {
    console.warn('Background token refresh failed — will retry later');
  }
};

// ── Firebase Auth state listener ──────────────────────────────────────────

export const onFirebaseAuthStateChanged = (callback: (user: FirebaseUser | null) => void) => {
  return onAuthStateChanged(firebaseAuth, callback);
};
