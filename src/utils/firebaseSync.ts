/**
 * Firebase Realtime Database sync utilities.
 * All user data lives under `users/{uid}/` with granular paths:
 *   - users/{uid}/notes
 *   - users/{uid}/tasks
 *   - users/{uid}/folders
 *   - users/{uid}/sections
 *   - users/{uid}/tags
 *   - users/{uid}/settings/{key}
 *   - users/{uid}/habits
 *   - users/{uid}/appSettings
 *   - users/{uid}/virtualJourney
 */

import { ref, set, get, onValue, off, serverTimestamp, Unsubscribe } from 'firebase/database';
import { firebaseDb } from '@/lib/firebase';

// ── Helpers ────────────────────────────────────────────────

const userPath = (uid: string, path: string) => `users/${uid}/${path}`;

/** Serialise dates to ISO strings and strip undefined/NaN/Infinity/functions for Firebase */
const serialise = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (obj instanceof Date) {
    const timestamp = obj.getTime();
    return Number.isFinite(timestamp) ? obj.toISOString() : null;
  }
  if (typeof obj === 'number' && !isFinite(obj)) return null;
  if (typeof obj === 'function') return null;
  if (Array.isArray(obj)) return obj.map(item => serialise(item));
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || typeof v === 'function') continue;
      const serialised = serialise(v);
      if (serialised !== undefined) {
        result[k] = serialised;
      }
    }
    return result;
  }
  return obj;
};

// ── Upload functions ───────────────────────────────────────

export const syncNotesToFirebase = async (uid: string, notes: any[]): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, 'notes'));
  await set(dbRef, serialise(notes));
};

export const syncTasksToFirebase = async (uid: string, tasks: any[]): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, 'tasks'));
  await set(dbRef, serialise(tasks));
};

export const syncFoldersToFirebase = async (uid: string, folders: any[]): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, 'folders'));
  await set(dbRef, serialise(folders));
};

export const syncNoteFoldersToFirebase = async (uid: string, folders: any[]): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, 'noteFolders'));
  await set(dbRef, serialise(folders));
};

export const syncSectionsToFirebase = async (uid: string, sections: any[]): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, 'sections'));
  await set(dbRef, serialise(sections));
};

export const syncTagsToFirebase = async (uid: string, tags: any[]): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, 'tags'));
  await set(dbRef, serialise(tags));
};

export const syncSettingToFirebase = async (uid: string, key: string, value: any): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, `settings/${key}`));
  await set(dbRef, serialise(value));
};

export const syncHabitsToFirebase = async (uid: string, habits: any[]): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, 'habits'));
  await set(dbRef, serialise(habits));
};

export const syncAppSettingsToFirebase = async (uid: string, settings: Record<string, any>): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, 'appSettings'));
  await set(dbRef, serialise(settings));
};

export const syncVirtualJourneyToFirebase = async (uid: string, data: any): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, 'virtualJourney'));
  await set(dbRef, serialise(data));
};

export const updateSyncTimestamp = async (uid: string): Promise<void> => {
  const dbRef = ref(firebaseDb, userPath(uid, 'lastSyncedAt'));
  await set(dbRef, serverTimestamp());
};

// ── Download (one-shot) ────────────────────────────────────

export const loadNotesFromFirebase = async (uid: string): Promise<any[] | null> => {
  const snap = await get(ref(firebaseDb, userPath(uid, 'notes')));
  if (!snap.exists()) return null;
  const data = snap.val();
  return Array.isArray(data) ? data : Object.values(data);
};

export const loadTasksFromFirebase = async (uid: string): Promise<any[] | null> => {
  const snap = await get(ref(firebaseDb, userPath(uid, 'tasks')));
  if (!snap.exists()) return null;
  const data = snap.val();
  return Array.isArray(data) ? data : Object.values(data);
};

export const loadFoldersFromFirebase = async (uid: string): Promise<any[] | null> => {
  const snap = await get(ref(firebaseDb, userPath(uid, 'folders')));
  if (!snap.exists()) return null;
  const data = snap.val();
  return Array.isArray(data) ? data : Object.values(data);
};

export const loadNoteFoldersFromFirebase = async (uid: string): Promise<any[] | null> => {
  const snap = await get(ref(firebaseDb, userPath(uid, 'noteFolders')));
  if (!snap.exists()) return null;
  const data = snap.val();
  return Array.isArray(data) ? data : Object.values(data);
};

export const loadSectionsFromFirebase = async (uid: string): Promise<any[] | null> => {
  const snap = await get(ref(firebaseDb, userPath(uid, 'sections')));
  if (!snap.exists()) return null;
  const data = snap.val();
  return Array.isArray(data) ? data : Object.values(data);
};

export const loadTagsFromFirebase = async (uid: string): Promise<any[] | null> => {
  const snap = await get(ref(firebaseDb, userPath(uid, 'tags')));
  if (!snap.exists()) return null;
  const data = snap.val();
  return Array.isArray(data) ? data : Object.values(data);
};

export const loadSettingsFromFirebase = async (uid: string): Promise<Record<string, any> | null> => {
  const snap = await get(ref(firebaseDb, userPath(uid, 'settings')));
  if (!snap.exists()) return null;
  return snap.val();
};

export const loadHabitsFromFirebase = async (uid: string): Promise<any[] | null> => {
  const snap = await get(ref(firebaseDb, userPath(uid, 'habits')));
  if (!snap.exists()) return null;
  const data = snap.val();
  return Array.isArray(data) ? data : Object.values(data);
};

export const loadAppSettingsFromFirebase = async (uid: string): Promise<Record<string, any> | null> => {
  const snap = await get(ref(firebaseDb, userPath(uid, 'appSettings')));
  if (!snap.exists()) return null;
  return snap.val();
};

export const loadVirtualJourneyFromFirebase = async (uid: string): Promise<any | null> => {
  const snap = await get(ref(firebaseDb, userPath(uid, 'virtualJourney')));
  if (!snap.exists()) return null;
  return snap.val();
};

// ── Real-time listeners ────────────────────────────────────

export const onNotesChanged = (uid: string, callback: (notes: any[]) => void): Unsubscribe => {
  const dbRef = ref(firebaseDb, userPath(uid, 'notes'));
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) { callback([]); return; }
    const data = snap.val();
    callback(Array.isArray(data) ? data : Object.values(data));
  });
  return () => off(dbRef, 'value', unsub as any);
};

export const onTasksChanged = (uid: string, callback: (tasks: any[]) => void): Unsubscribe => {
  const dbRef = ref(firebaseDb, userPath(uid, 'tasks'));
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) { callback([]); return; }
    const data = snap.val();
    callback(Array.isArray(data) ? data : Object.values(data));
  });
  return () => off(dbRef, 'value', unsub as any);
};

export const onFoldersChanged = (uid: string, callback: (folders: any[]) => void): Unsubscribe => {
  const dbRef = ref(firebaseDb, userPath(uid, 'folders'));
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) { callback([]); return; }
    const data = snap.val();
    callback(Array.isArray(data) ? data : Object.values(data));
  });
  return () => off(dbRef, 'value', unsub as any);
};

export const onNoteFoldersChanged = (uid: string, callback: (folders: any[]) => void): Unsubscribe => {
  const dbRef = ref(firebaseDb, userPath(uid, 'noteFolders'));
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) { callback([]); return; }
    const data = snap.val();
    callback(Array.isArray(data) ? data : Object.values(data));
  });
  return () => off(dbRef, 'value', unsub as any);
};

export const onSectionsChanged = (uid: string, callback: (sections: any[]) => void): Unsubscribe => {
  const dbRef = ref(firebaseDb, userPath(uid, 'sections'));
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) { callback([]); return; }
    const data = snap.val();
    callback(Array.isArray(data) ? data : Object.values(data));
  });
  return () => off(dbRef, 'value', unsub as any);
};

export const onTagsChanged = (uid: string, callback: (tags: any[]) => void): Unsubscribe => {
  const dbRef = ref(firebaseDb, userPath(uid, 'tags'));
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) { callback([]); return; }
    const data = snap.val();
    callback(Array.isArray(data) ? data : Object.values(data));
  });
  return () => off(dbRef, 'value', unsub as any);
};

export const onHabitsChanged = (uid: string, callback: (habits: any[]) => void): Unsubscribe => {
  const dbRef = ref(firebaseDb, userPath(uid, 'habits'));
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) { callback([]); return; }
    const data = snap.val();
    callback(Array.isArray(data) ? data : Object.values(data));
  });
  return () => off(dbRef, 'value', unsub as any);
};

export const onAppSettingsChanged = (uid: string, callback: (settings: Record<string, any>) => void): Unsubscribe => {
  const dbRef = ref(firebaseDb, userPath(uid, 'appSettings'));
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) { callback({}); return; }
    callback(snap.val());
  });
  return () => off(dbRef, 'value', unsub as any);
};

export const onVirtualJourneyChanged = (uid: string, callback: (data: any) => void): Unsubscribe => {
  const dbRef = ref(firebaseDb, userPath(uid, 'virtualJourney'));
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) { callback(null); return; }
    callback(snap.val());
  });
  return () => off(dbRef, 'value', unsub as any);
};
