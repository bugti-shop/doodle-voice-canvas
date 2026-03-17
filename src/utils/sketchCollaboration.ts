/**
 * Sketch Real-time Collaboration via Firebase Realtime Database
 * 
 * Features:
 * - Completed strokes synced on finish
 * - Live in-progress strokes broadcast point-by-point (~15fps)
 * - Cursors synced at ~16fps (60ms intervals)
 * - Presence uses onDisconnect for auto-cleanup
 * - Any user can delete any stroke (eraser/select delete)
 * - Room data auto-expires when empty
 * - Text annotations synced
 * - Washi tape elements synced
 * - Sticky notes synced
 * - Stroke transforms (move/resize/rotate) synced
 * - Clear layer/all broadcast
 * - Zoom/pan state sharing
 * - Permission levels (editor/viewer)
 * - Session persistence (auto-rejoin on reconnect)
 * - Page/notebook switching sync
 */
import { firebaseDb, firebaseAuth } from '@/lib/firebase';
import { ref, set, get, push, onValue, onChildAdded, onChildRemoved, off, remove, onDisconnect, update } from 'firebase/database';
import type { Stroke, TextAnnotation, WashiTapeData, StickyNoteData, CanvasImageData } from '@/components/sketch/SketchTypes';

// --- Types ---

export type CollabRole = 'editor' | 'viewer';

export interface CollabUser {
  id: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number; tool?: string };
  lastSeen: number;
  isDrawing?: boolean;
  role?: CollabRole;
}

export interface CollabRoom {
  id: string;
  createdBy: string;
  createdAt: number;
  name?: string;
}

export interface RemoteStroke {
  id: string;
  stroke: Stroke;
  layerId: number;
  userId: string;
  userName: string;
  userColor: string;
  timestamp: number;
}

/** In-progress stroke being drawn by a remote user */
export interface LiveStroke {
  userId: string;
  userName: string;
  userColor: string;
  stroke: Stroke;
  layerId: number;
  timestamp: number;
}

/** Remote text annotation event */
export interface RemoteTextAnnotation {
  id: string;
  annotation: TextAnnotation;
  layerId: number;
  userId: string;
  userName: string;
  timestamp: number;
  action: 'add' | 'update' | 'delete';
}

/** Remote washi tape event */
export interface RemoteWashiTape {
  id: string;
  tape: WashiTapeData;
  layerId: number;
  userId: string;
  userName: string;
  timestamp: number;
  action: 'add' | 'update' | 'delete';
}

/** Remote stroke transform event */
export interface RemoteTransform {
  userId: string;
  userName: string;
  layerId: number;
  strokeIndices: number[];
  collabStrokeIds: string[];
  transformedStrokes: Stroke[];
  timestamp: number;
}

/** Remote clear event */
export interface RemoteClear {
  userId: string;
  userName: string;
  layerId: number | 'all';
  timestamp: number;
}

/** Shared viewport state */
export interface SharedViewport {
  zoom: number;
  panX: number;
  panY: number;
  userId: string;
  timestamp: number;
}

/** Remote sticky note event */
export interface RemoteStickyNote {
  id: string;
  stickyNote: StickyNoteData;
  layerId: number;
  userId: string;
  userName: string;
  timestamp: number;
  action: 'add' | 'update' | 'delete';
}

/** Remote image element event */
export interface RemoteImageElement {
  id: string;
  image: CanvasImageData;
  layerId: number;
  userId: string;
  userName: string;
  timestamp: number;
  action: 'add' | 'update' | 'delete';
}

/** Page/notebook switch event */
export interface RemotePageSwitch {
  userId: string;
  userName: string;
  pageIndex: number;
  timestamp: number;
}

/** Remote layer management event */
export type LayerAction = 'add' | 'delete' | 'rename' | 'reorder' | 'visibility' | 'opacity' | 'blendMode';

export interface RemoteLayerEvent {
  userId: string;
  userName: string;
  action: LayerAction;
  layerId?: number;
  layerName?: string;
  layerOrder?: number[];
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  newLayer?: { id: number; name: string; opacity: number; visible: boolean; blendMode?: string };
  timestamp: number;
}

/** Chat message */
export interface CollabChatMessage {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  text: string;
  timestamp: number;
}

/** Session persistence data */
export interface CollabSession {
  roomId: string;
  userName: string;
  userColor: string;
  role: CollabRole;
  timestamp: number;
}

export interface CollabCallbacks {
  onUserJoined?: (user: CollabUser) => void;
  onUserLeft?: (userId: string) => void;
  onCursorUpdate?: (userId: string, cursor: { x: number; y: number; tool?: string }) => void;
  onRemoteStroke?: (stroke: RemoteStroke) => void;
  onRemoteStrokeRemoved?: (strokeId: string) => void;
  onRemoteUndo?: (userId: string, strokeId: string) => void;
  onUsersChanged?: (users: CollabUser[]) => void;
}

// --- Collab colors for users ---
const COLLAB_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#10b981',
];

export const getCollabColor = (index: number): string => {
  return COLLAB_COLORS[index % COLLAB_COLORS.length];
};

// --- Room management ---

const REQUEST_TIMEOUT_MS = 12_000;
const getRoomPath = (roomId: string) => `collab-rooms/${roomId}`;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

/** Generate a short 6-digit room code */
const generateRoomCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

export const createCollabRoom = async (roomName?: string): Promise<string> => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Must be signed in to create a room');
  if (!navigator.onLine) throw new Error('No internet connection. Please try again when online.');

  const roomCode = generateRoomCode();
  const roomRef = ref(firebaseDb, `collab-rooms/${roomCode}`);
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

  await withTimeout(
    set(roomRef, {
      id: roomCode,
      createdBy: user.uid,
      createdAt: Date.now(),
      expiresAt,
      name: roomName || 'Sketch Room',
    }),
    REQUEST_TIMEOUT_MS,
    'Create request timed out. Please check your internet and retry.',
  );

  return roomCode;
};

export const doesRoomExist = async (roomId: string): Promise<boolean> => {
  const snapshot = await withTimeout(
    get(ref(firebaseDb, getRoomPath(roomId))),
    REQUEST_TIMEOUT_MS,
    'Join request timed out. Please check your internet and retry.',
  );
  if (!snapshot.exists()) return false;
  const data = snapshot.val();
  if (data.expiresAt && Date.now() > data.expiresAt) {
    await remove(ref(firebaseDb, getRoomPath(roomId)));
    return false;
  }
  return true;
};

// --- Session persistence ---

const SESSION_KEY = 'sketch_collab_session';

export const saveCollabSession = (session: CollabSession): void => {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
};

export const loadCollabSession = (): CollabSession | null => {
  try {
    const data = localStorage.getItem(SESSION_KEY);
    if (!data) return null;
    const session = JSON.parse(data) as CollabSession;
    // Sessions expire after 24 hours
    if (Date.now() - session.timestamp > 24 * 60 * 60 * 1000) {
      clearCollabSession();
      return null;
    }
    return session;
  } catch { return null; }
};

export const clearCollabSession = (): void => {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
};

// --- Presence ---

export const joinRoom = async (
  roomId: string,
  userName: string,
  userColor: string,
  role: CollabRole = 'editor',
): Promise<string> => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Must be signed in');

  const userId = user.uid;
  const userRef = ref(firebaseDb, `${getRoomPath(roomId)}/users/${userId}`);

  const userData: CollabUser = {
    id: userId,
    name: userName,
    color: userColor,
    lastSeen: Date.now(),
    role,
  };

  await withTimeout(
    set(userRef, userData),
    REQUEST_TIMEOUT_MS,
    'Joining room timed out. Please check your internet and retry.',
  );

  onDisconnect(userRef).remove().catch(() => {});
  const liveStrokeRef = ref(firebaseDb, `${getRoomPath(roomId)}/liveStrokes/${userId}`);
  onDisconnect(liveStrokeRef).remove().catch(() => {});

  return userId;
};

export const leaveRoom = async (roomId: string): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const userRef = ref(firebaseDb, `${getRoomPath(roomId)}/users/${user.uid}`);
  const liveRef = ref(firebaseDb, `${getRoomPath(roomId)}/liveStrokes/${user.uid}`);
  await Promise.all([remove(userRef), remove(liveRef)]);
};

// --- Cursor sync ---

let lastCursorUpdate = 0;
const CURSOR_THROTTLE_MS = 60;

export const broadcastCursor = (
  roomId: string, x: number, y: number, tool?: string, isDrawing?: boolean,
): void => {
  const now = Date.now();
  if (now - lastCursorUpdate < CURSOR_THROTTLE_MS) return;
  lastCursorUpdate = now;
  const user = firebaseAuth.currentUser;
  if (!user) return;

  const updates: Record<string, unknown> = {
    [`${getRoomPath(roomId)}/users/${user.uid}/cursor`]: { x, y, tool: tool || null },
    [`${getRoomPath(roomId)}/users/${user.uid}/lastSeen`]: now,
  };
  if (isDrawing !== undefined) {
    updates[`${getRoomPath(roomId)}/users/${user.uid}/isDrawing`] = isDrawing;
  }
  update(ref(firebaseDb), updates);
};

// --- Live stroke sync ---

let lastLiveStrokeUpdate = 0;
const LIVE_STROKE_THROTTLE_MS = 33;

export const broadcastLiveStroke = (
  roomId: string, stroke: Stroke, layerId: number, userName: string, userColor: string,
): void => {
  const now = Date.now();
  if (now - lastLiveStrokeUpdate < LIVE_STROKE_THROTTLE_MS) return;
  lastLiveStrokeUpdate = now;
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const liveRef = ref(firebaseDb, `${getRoomPath(roomId)}/liveStrokes/${user.uid}`);
  set(liveRef, { userId: user.uid, userName, userColor, stroke, layerId, timestamp: now });
};

export const clearLiveStroke = (roomId: string): void => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  remove(ref(firebaseDb, `${getRoomPath(roomId)}/liveStrokes/${user.uid}`));
};

// --- Stroke sync (completed strokes) ---

export const broadcastStroke = async (
  roomId: string, stroke: Stroke, layerId: number, userName: string, userColor: string,
): Promise<string> => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Must be signed in');
  const strokeRef = push(ref(firebaseDb, `${getRoomPath(roomId)}/strokes`));
  const strokeId = strokeRef.key!;
  const remoteStroke: RemoteStroke = {
    id: strokeId, stroke, layerId, userId: user.uid, userName, userColor, timestamp: Date.now(),
  };
  await set(strokeRef, remoteStroke);
  clearLiveStroke(roomId);
  return strokeId;
};

export const removeRemoteStroke = async (roomId: string, strokeId: string): Promise<void> => {
  await remove(ref(firebaseDb, `${getRoomPath(roomId)}/strokes/${strokeId}`));
};

export const broadcastStrokesDeletion = async (roomId: string, strokeIds: string[]): Promise<void> => {
  if (strokeIds.length === 0) return;
  const updates: Record<string, null> = {};
  for (const id of strokeIds) {
    updates[`${getRoomPath(roomId)}/strokes/${id}`] = null;
  }
  await update(ref(firebaseDb), updates);
};

export const broadcastUndo = async (roomId: string, strokeId: string): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  await removeRemoteStroke(roomId, strokeId);
};

// --- Text annotation sync ---

export const broadcastTextAnnotation = async (
  roomId: string, annotation: TextAnnotation, layerId: number, userName: string, action: 'add' | 'update' | 'delete',
): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const textRef = ref(firebaseDb, `${getRoomPath(roomId)}/textAnnotations/${annotation.id}`);
  if (action === 'delete') {
    await remove(textRef);
  } else {
    await set(textRef, {
      id: `${annotation.id}`,
      annotation,
      layerId,
      userId: user.uid,
      userName,
      timestamp: Date.now(),
      action,
    });
  }
};

// --- Washi tape sync ---

export const broadcastWashiTape = async (
  roomId: string, tape: WashiTapeData, layerId: number, userName: string, action: 'add' | 'update' | 'delete',
): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const washiRef = ref(firebaseDb, `${getRoomPath(roomId)}/washiTapes/${tape.id}`);
  if (action === 'delete') {
    await remove(washiRef);
  } else {
    await set(washiRef, {
      id: `${tape.id}`,
      tape,
      layerId,
      userId: user.uid,
      userName,
      timestamp: Date.now(),
      action,
    });
  }
};

// --- Stroke transform sync ---

let lastTransformUpdate = 0;
const TRANSFORM_THROTTLE_MS = 100;

export const broadcastTransform = (
  roomId: string,
  layerId: number,
  collabStrokeIds: string[],
  transformedStrokes: Stroke[],
  userName: string,
): void => {
  const now = Date.now();
  if (now - lastTransformUpdate < TRANSFORM_THROTTLE_MS) return;
  lastTransformUpdate = now;
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const transformRef = ref(firebaseDb, `${getRoomPath(roomId)}/transforms/${user.uid}`);
  set(transformRef, {
    userId: user.uid,
    userName,
    layerId,
    collabStrokeIds,
    transformedStrokes,
    timestamp: now,
  });
};

export const clearTransform = (roomId: string): void => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  remove(ref(firebaseDb, `${getRoomPath(roomId)}/transforms/${user.uid}`));
};

// --- Clear layer/all broadcast ---

export const broadcastClearLayer = async (
  roomId: string, layerId: number | 'all', userName: string,
): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const clearRef = push(ref(firebaseDb, `${getRoomPath(roomId)}/clearEvents`));
  await set(clearRef, {
    userId: user.uid,
    userName,
    layerId,
    timestamp: Date.now(),
  });
};

// --- Zoom/pan state sharing ---

let lastViewportUpdate = 0;
const VIEWPORT_THROTTLE_MS = 200;

export const broadcastViewport = (
  roomId: string, zoom: number, panX: number, panY: number,
): void => {
  const now = Date.now();
  if (now - lastViewportUpdate < VIEWPORT_THROTTLE_MS) return;
  lastViewportUpdate = now;
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const vpRef = ref(firebaseDb, `${getRoomPath(roomId)}/viewports/${user.uid}`);
  set(vpRef, { zoom, panX, panY, userId: user.uid, timestamp: now });
};

// --- Listeners ---

export type UnsubFn = () => void;

export const listenToUsers = (
  roomId: string, callback: (users: CollabUser[]) => void,
): UnsubFn => {
  const usersRef = ref(firebaseDb, `${getRoomPath(roomId)}/users`);
  const handler = onValue(usersRef, (snapshot) => {
    if (!snapshot.exists()) { callback([]); return; }
    callback(Object.values(snapshot.val()));
  });
  return () => off(usersRef, 'value', handler);
};

export const listenToStrokes = (
  roomId: string, onAdded: (stroke: RemoteStroke) => void, onRemoved: (strokeId: string) => void,
): UnsubFn => {
  const strokesRef = ref(firebaseDb, `${getRoomPath(roomId)}/strokes`);
  const addHandler = onChildAdded(strokesRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.val() as RemoteStroke;
    const user = firebaseAuth.currentUser;
    if (user && data.userId === user.uid) return;
    onAdded(data);
  });
  const removeHandler = onChildRemoved(strokesRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.val() as RemoteStroke;
    onRemoved(data.id);
  });
  return () => {
    off(strokesRef, 'child_added', addHandler);
    off(strokesRef, 'child_removed', removeHandler);
  };
};

export const listenToLiveStrokes = (
  roomId: string, onUpdate: (liveStrokes: LiveStroke[]) => void,
): UnsubFn => {
  const liveRef = ref(firebaseDb, `${getRoomPath(roomId)}/liveStrokes`);
  const user = firebaseAuth.currentUser;
  const handler = onValue(liveRef, (snapshot) => {
    if (!snapshot.exists()) { onUpdate([]); return; }
    const data = snapshot.val();
    const strokes: LiveStroke[] = [];
    for (const [uid, val] of Object.entries(data)) {
      if (user && uid === user.uid) continue;
      if (val && typeof val === 'object') strokes.push(val as LiveStroke);
    }
    onUpdate(strokes);
  });
  return () => off(liveRef, 'value', handler);
};

export const listenToTextAnnotations = (
  roomId: string, onUpdate: (annotations: RemoteTextAnnotation[]) => void,
): UnsubFn => {
  const textRef = ref(firebaseDb, `${getRoomPath(roomId)}/textAnnotations`);
  const user = firebaseAuth.currentUser;
  const handler = onValue(textRef, (snapshot) => {
    if (!snapshot.exists()) { onUpdate([]); return; }
    const data = snapshot.val();
    const annotations: RemoteTextAnnotation[] = [];
    for (const val of Object.values(data)) {
      const item = val as RemoteTextAnnotation;
      if (user && item.userId === user.uid) continue;
      annotations.push(item);
    }
    onUpdate(annotations);
  });
  return () => off(textRef, 'value', handler);
};

export const listenToWashiTapes = (
  roomId: string, onUpdate: (tapes: RemoteWashiTape[]) => void,
): UnsubFn => {
  const washiRef = ref(firebaseDb, `${getRoomPath(roomId)}/washiTapes`);
  const user = firebaseAuth.currentUser;
  const handler = onValue(washiRef, (snapshot) => {
    if (!snapshot.exists()) { onUpdate([]); return; }
    const data = snapshot.val();
    const tapes: RemoteWashiTape[] = [];
    for (const val of Object.values(data)) {
      const item = val as RemoteWashiTape;
      if (user && item.userId === user.uid) continue;
      tapes.push(item);
    }
    onUpdate(tapes);
  });
  return () => off(washiRef, 'value', handler);
};

export const listenToTransforms = (
  roomId: string, onUpdate: (transforms: RemoteTransform[]) => void,
): UnsubFn => {
  const transformRef = ref(firebaseDb, `${getRoomPath(roomId)}/transforms`);
  const user = firebaseAuth.currentUser;
  const handler = onValue(transformRef, (snapshot) => {
    if (!snapshot.exists()) { onUpdate([]); return; }
    const data = snapshot.val();
    const transforms: RemoteTransform[] = [];
    for (const [uid, val] of Object.entries(data)) {
      if (user && uid === user.uid) continue;
      if (val && typeof val === 'object') transforms.push(val as RemoteTransform);
    }
    onUpdate(transforms);
  });
  return () => off(transformRef, 'value', handler);
};

export const listenToClearEvents = (
  roomId: string, onClear: (event: RemoteClear) => void,
): UnsubFn => {
  const clearRef = ref(firebaseDb, `${getRoomPath(roomId)}/clearEvents`);
  const user = firebaseAuth.currentUser;
  const handler = onChildAdded(clearRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.val() as RemoteClear;
    if (user && data.userId === user.uid) return;
    onClear(data);
    // Clean up processed event
    remove(snapshot.ref).catch(() => {});
  });
  return () => off(clearRef, 'child_added', handler);
};

export const listenToViewports = (
  roomId: string, onUpdate: (viewports: SharedViewport[]) => void,
): UnsubFn => {
  const vpRef = ref(firebaseDb, `${getRoomPath(roomId)}/viewports`);
  const user = firebaseAuth.currentUser;
  const handler = onValue(vpRef, (snapshot) => {
    if (!snapshot.exists()) { onUpdate([]); return; }
    const data = snapshot.val();
    const viewports: SharedViewport[] = [];
    for (const [uid, val] of Object.entries(data)) {
      if (user && uid === user.uid) continue;
      if (val && typeof val === 'object') viewports.push(val as SharedViewport);
    }
    onUpdate(viewports);
  });
  return () => off(vpRef, 'value', handler);
};

// --- Sticky note sync ---

export const broadcastStickyNote = async (
  roomId: string, stickyNote: StickyNoteData, layerId: number, userName: string, action: 'add' | 'update' | 'delete',
): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const stickyRef = ref(firebaseDb, `${getRoomPath(roomId)}/stickyNotes/${stickyNote.id}`);
  if (action === 'delete') {
    await remove(stickyRef);
  } else {
    await set(stickyRef, {
      id: `${stickyNote.id}`,
      stickyNote,
      layerId,
      userId: user.uid,
      userName,
      timestamp: Date.now(),
      action,
    });
  }
};

export const listenToStickyNotes = (
  roomId: string, onUpdate: (notes: RemoteStickyNote[]) => void,
): UnsubFn => {
  const stickyRef = ref(firebaseDb, `${getRoomPath(roomId)}/stickyNotes`);
  const user = firebaseAuth.currentUser;
  const handler = onValue(stickyRef, (snapshot) => {
    if (!snapshot.exists()) { onUpdate([]); return; }
    const data = snapshot.val();
    const notes: RemoteStickyNote[] = [];
    for (const val of Object.values(data)) {
      const item = val as RemoteStickyNote;
      if (user && item.userId === user.uid) continue;
      notes.push(item);
    }
    onUpdate(notes);
  });
  return () => off(stickyRef, 'value', handler);
};

// --- Image element sync ---

export const broadcastImageElement = async (
  roomId: string, image: CanvasImageData, layerId: number, userName: string, action: 'add' | 'update' | 'delete',
): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const imgRef = ref(firebaseDb, `${getRoomPath(roomId)}/imageElements/${image.id}`);
  if (action === 'delete') {
    await remove(imgRef);
  } else {
    await set(imgRef, {
      id: `${image.id}`,
      image,
      layerId,
      userId: user.uid,
      userName,
      timestamp: Date.now(),
      action,
    });
  }
};

export const listenToImageElements = (
  roomId: string, onUpdate: (images: RemoteImageElement[]) => void,
): UnsubFn => {
  const imgRef = ref(firebaseDb, `${getRoomPath(roomId)}/imageElements`);
  const user = firebaseAuth.currentUser;
  const handler = onValue(imgRef, (snapshot) => {
    if (!snapshot.exists()) { onUpdate([]); return; }
    const data = snapshot.val();
    const images: RemoteImageElement[] = [];
    for (const val of Object.values(data)) {
      const item = val as RemoteImageElement;
      if (user && item.userId === user.uid) continue;
      images.push(item);
    }
    onUpdate(images);
  });
  return () => off(imgRef, 'value', handler);
};

// --- Follow user sync ---

export const broadcastFollowRequest = (
  roomId: string, targetUserId: string,
): void => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const followRef = ref(firebaseDb, `${getRoomPath(roomId)}/following/${user.uid}`);
  set(followRef, { targetUserId, timestamp: Date.now() });
};

export const clearFollowRequest = (roomId: string): void => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  remove(ref(firebaseDb, `${getRoomPath(roomId)}/following/${user.uid}`));
};

// --- Layer management sync ---

export const broadcastLayerEvent = async (
  roomId: string, event: Omit<RemoteLayerEvent, 'userId' | 'timestamp'>,
): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const layerRef = push(ref(firebaseDb, `${getRoomPath(roomId)}/layerEvents`));
  await set(layerRef, { ...event, userId: user.uid, timestamp: Date.now() });
};

export const listenToLayerEvents = (
  roomId: string, onEvent: (event: RemoteLayerEvent) => void,
): UnsubFn => {
  const layerRef = ref(firebaseDb, `${getRoomPath(roomId)}/layerEvents`);
  const user = firebaseAuth.currentUser;
  const handler = onChildAdded(layerRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.val() as RemoteLayerEvent;
    if (user && data.userId === user.uid) return;
    onEvent(data);
    remove(snapshot.ref).catch(() => {});
  });
  return () => off(layerRef, 'child_added', handler);
};

// --- Page/notebook switching sync ---

export const broadcastPageSwitch = (
  roomId: string, pageIndex: number, userName: string,
): void => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const pageRef = ref(firebaseDb, `${getRoomPath(roomId)}/pageSwitch/${user.uid}`);
  set(pageRef, { userId: user.uid, userName, pageIndex, timestamp: Date.now() });
};

export const listenToPageSwitches = (
  roomId: string, onUpdate: (switches: RemotePageSwitch[]) => void,
): UnsubFn => {
  const pageRef = ref(firebaseDb, `${getRoomPath(roomId)}/pageSwitch`);
  const user = firebaseAuth.currentUser;
  const handler = onValue(pageRef, (snapshot) => {
    if (!snapshot.exists()) { onUpdate([]); return; }
    const data = snapshot.val();
    const switches: RemotePageSwitch[] = [];
    for (const [uid, val] of Object.entries(data)) {
      if (user && uid === user.uid) continue;
      if (val && typeof val === 'object') switches.push(val as RemotePageSwitch);
    }
    onUpdate(switches);
  });
  return () => off(pageRef, 'value', handler);
};

// --- Permission management ---

export const setUserRole = async (
  roomId: string, targetUserId: string, role: CollabRole,
): Promise<void> => {
  const roleRef = ref(firebaseDb, `${getRoomPath(roomId)}/users/${targetUserId}/role`);
  await set(roleRef, role);
};

export const getRoomCreator = async (roomId: string): Promise<string | null> => {
  const snapshot = await get(ref(firebaseDb, `${getRoomPath(roomId)}/createdBy`));
  return snapshot.exists() ? snapshot.val() : null;
};

// --- Generate share link / code ---

export const generateShareLink = (roomId: string): string => {
  return `${window.location.origin}?collab=${roomId}`;
};

export const getRoomCode = (roomId: string): string => roomId;

// --- Chat messaging ---

export const broadcastChatMessage = async (
  roomId: string, text: string, userName: string, userColor: string,
): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const chatRef = push(ref(firebaseDb, `${getRoomPath(roomId)}/chat`));
  await set(chatRef, {
    id: chatRef.key,
    userId: user.uid,
    userName,
    userColor,
    text,
    timestamp: Date.now(),
  });
};

export const listenToChat = (
  roomId: string, onMessage: (msg: CollabChatMessage) => void,
): UnsubFn => {
  const chatRef = ref(firebaseDb, `${getRoomPath(roomId)}/chat`);
  const handler = onChildAdded(chatRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.val() as CollabChatMessage;
    onMessage(data);
  });
  return () => off(chatRef, 'child_added', handler);
};
