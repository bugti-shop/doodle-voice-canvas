/**
 * React hook for Sketch real-time collaboration
 * Manages room lifecycle, cursor sync, live stroke sync, stroke sync, user presence,
 * per-user undo, text annotations, washi tapes, sticky notes, transforms, clear events,
 * viewport sharing, permission levels, session persistence, and page switching
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGoogleAuth } from '@/contexts/GoogleAuthContext';

import {
  CollabUser,
  CollabRole,
  CollabChatMessage,
  RemoteStroke,
  LiveStroke,
  RemoteTextAnnotation,
  RemoteWashiTape,
  RemoteStickyNote,
  RemoteImageElement,
  RemoteTransform,
  RemoteClear,
  SharedViewport,
  RemotePageSwitch,
  RemoteLayerEvent,
  LayerAction,
  joinRoom,
  leaveRoom,
  broadcastCursor,
  broadcastStroke,
  broadcastLiveStroke,
  clearLiveStroke,
  removeRemoteStroke,
  broadcastStrokesDeletion,
  broadcastTextAnnotation,
  broadcastWashiTape,
  broadcastStickyNote,
  broadcastImageElement,
  broadcastTransform,
  clearTransform,
  broadcastClearLayer,
  broadcastViewport,
  broadcastPageSwitch,
  broadcastLayerEvent,
  broadcastChatMessage,
  broadcastFollowRequest,
  clearFollowRequest,
  setUserRole,
  getRoomCreator,
  listenToUsers,
  listenToStrokes,
  listenToLiveStrokes,
  listenToTextAnnotations,
  listenToWashiTapes,
  listenToStickyNotes,
  listenToImageElements,
  listenToTransforms,
  listenToClearEvents,
  listenToViewports,
  listenToPageSwitches,
  listenToLayerEvents,
  listenToChat,
  createCollabRoom,
  generateShareLink,
  getCollabColor,
  doesRoomExist,
  saveCollabSession,
  loadCollabSession,
  clearCollabSession,
} from '@/utils/sketchCollaboration';
import type { Stroke, TextAnnotation, WashiTapeData, StickyNoteData, CanvasImageData } from '@/components/sketch/SketchTypes';

export interface UseSketchCollaborationReturn {
  // State
  isConnected: boolean;
  roomId: string | null;
  users: CollabUser[];
  remoteStrokes: RemoteStroke[];
  remoteLiveStrokes: LiveStroke[];
  remoteTextAnnotations: RemoteTextAnnotation[];
  remoteWashiTapes: RemoteWashiTape[];
  remoteStickyNotes: RemoteStickyNote[];
  remoteImageElements: RemoteImageElement[];
  remoteTransforms: RemoteTransform[];
  remoteViewports: SharedViewport[];
  remotePageSwitches: RemotePageSwitch[];
  followingUserId: string | null;
  myColor: string;
  myName: string;
  myUserId: string | null;
  myRole: CollabRole;
  isRoomCreator: boolean;
  chatMessages: CollabChatMessage[];
  unreadCount: number;

  // Actions
  createRoom: (name?: string) => Promise<string>;
  joinExistingRoom: (roomId: string, role?: CollabRole) => Promise<void>;
  leave: () => Promise<void>;
  sendCursor: (x: number, y: number, tool?: string, isDrawing?: boolean) => void;
  sendLiveStroke: (stroke: Stroke, layerId: number) => void;
  finishLiveStroke: () => void;
  sendStroke: (stroke: Stroke, layerId: number) => Promise<string | null>;
  undoMyLastStroke: () => Promise<void>;
  deleteRemoteStrokes: (strokeIds: string[]) => Promise<void>;
  getShareLink: () => string | null;
  sendTextAnnotation: (annotation: TextAnnotation, layerId: number, action: 'add' | 'update' | 'delete') => void;
  sendWashiTape: (tape: WashiTapeData, layerId: number, action: 'add' | 'update' | 'delete') => void;
  sendStickyNote: (note: StickyNoteData, layerId: number, action: 'add' | 'update' | 'delete') => void;
  sendImageElement: (image: CanvasImageData, layerId: number, action: 'add' | 'update' | 'delete') => void;
  sendTransform: (layerId: number, collabStrokeIds: string[], transformedStrokes: Stroke[]) => void;
  finishTransform: () => void;
  sendClearLayer: (layerId: number | 'all') => void;
  sendViewport: (zoom: number, panX: number, panY: number) => void;
  sendPageSwitch: (pageIndex: number) => void;
  sendLayerEvent: (action: LayerAction, data?: Partial<RemoteLayerEvent>) => void;
  sendChatMessage: (text: string) => void;
  markChatRead: () => void;
  followUser: (userId: string | null) => void;
  changeUserRole: (targetUserId: string, role: CollabRole) => Promise<void>;
}

export const useSketchCollaboration = (): UseSketchCollaborationReturn => {
  const { user } = useGoogleAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [users, setUsers] = useState<CollabUser[]>([]);
  const [remoteStrokes, setRemoteStrokes] = useState<RemoteStroke[]>([]);
  const [remoteLiveStrokes, setRemoteLiveStrokes] = useState<LiveStroke[]>([]);
  const [remoteTextAnnotations, setRemoteTextAnnotations] = useState<RemoteTextAnnotation[]>([]);
  const [remoteWashiTapes, setRemoteWashiTapes] = useState<RemoteWashiTape[]>([]);
  const [remoteStickyNotes, setRemoteStickyNotes] = useState<RemoteStickyNote[]>([]);
  const [remoteImageElements, setRemoteImageElements] = useState<RemoteImageElement[]>([]);
  const [remoteTransforms, setRemoteTransforms] = useState<RemoteTransform[]>([]);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const [remoteViewports, setRemoteViewports] = useState<SharedViewport[]>([]);
  const [remotePageSwitches, setRemotePageSwitches] = useState<RemotePageSwitch[]>([]);
  const [myColor, setMyColor] = useState('#3b82f6');
  const [myRole, setMyRole] = useState<CollabRole>('editor');
  const [isRoomCreator, setIsRoomCreator] = useState(false);
  const [chatMessages, setChatMessages] = useState<CollabChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatOpenRef = useRef(false);
  const unsubsRef = useRef<Array<() => void>>([]);
  const roomIdRef = useRef<string | null>(null);
  const myStrokeIdsRef = useRef<string[]>([]);
  const prevUserIdsRef = useRef<Set<string>>(new Set());
  const isInitialUsersLoadRef = useRef(true);

  const myName = user?.name || user?.email?.split('@')[0] || 'Anonymous';

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomIdRef.current) {
        leaveRoom(roomIdRef.current).catch(() => {});
      }
      unsubsRef.current.forEach(fn => fn());
    };
  }, []);

  // Auto-rejoin session on mount
  useEffect(() => {
    if (!user || isConnected) return;
    const session = loadCollabSession();
    if (session) {
      doesRoomExist(session.roomId).then(exists => {
        if (exists && !roomIdRef.current) {
          const color = session.userColor;
          setMyColor(color);
          setMyRole(session.role);
          joinRoom(session.roomId, myName, color, session.role).then(() => {
            roomIdRef.current = session.roomId;
            setRoomId(session.roomId);
            setIsConnected(true);
            resetState();
            setupListeners(session.roomId);
            getRoomCreator(session.roomId).then(creatorId => {
              setIsRoomCreator(creatorId === user.uid);
            });
            // Reconnected silently
          }).catch(() => {
            clearCollabSession();
          });
        } else {
          clearCollabSession();
        }
      }).catch(() => clearCollabSession());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const setupListeners = useCallback((rid: string) => {
    isInitialUsersLoadRef.current = true;

    // Users
    const unsubUsers = listenToUsers(rid, (allUsers) => {
      setUsers(allUsers);
      if (user) {
        const myIdx = allUsers.findIndex(u => u.id === user.uid);
        if (myIdx >= 0) {
          setMyColor(getCollabColor(myIdx));
          if (allUsers[myIdx].role) setMyRole(allUsers[myIdx].role!);
        }
      }
      const currentIds = new Set(allUsers.map(u => u.id));
      const prevIds = prevUserIdsRef.current;
      if (!isInitialUsersLoadRef.current) {
        for (const u of allUsers) {
          if (!prevIds.has(u.id) && u.id !== user?.uid) {
            // Notification suppressed (toasts disabled)
          }
        }
        for (const oldId of prevIds) {
          if (!currentIds.has(oldId) && oldId !== user?.uid) {
            // Notification suppressed (toasts disabled)
          }
        }
      }
      prevUserIdsRef.current = currentIds;
      isInitialUsersLoadRef.current = false;
    });

    // Strokes
    const unsubStrokes = listenToStrokes(rid,
      (stroke) => setRemoteStrokes(prev => [...prev, stroke]),
      (strokeId) => setRemoteStrokes(prev => {
        const removed = prev.find(s => s.id === strokeId);
        return prev.filter(s => s.id !== strokeId);
      }),
    );

    // Live strokes
    const unsubLive = listenToLiveStrokes(rid, setRemoteLiveStrokes);

    // Text annotations
    const unsubText = listenToTextAnnotations(rid, setRemoteTextAnnotations);

    // Washi tapes
    const unsubWashi = listenToWashiTapes(rid, setRemoteWashiTapes);

    // Sticky notes
    const unsubSticky = listenToStickyNotes(rid, setRemoteStickyNotes);

    // Image elements
    const unsubImages = listenToImageElements(rid, setRemoteImageElements);

    // Transforms
    const unsubTransforms = listenToTransforms(rid, setRemoteTransforms);

    // Clear events
    const unsubClear = listenToClearEvents(rid, (event) => {
      window.dispatchEvent(new CustomEvent('collabClearLayer', { detail: event }));
    });

    // Viewports
    const unsubViewports = listenToViewports(rid, setRemoteViewports);

    // Page switches
    const unsubPages = listenToPageSwitches(rid, setRemotePageSwitches);

    // Layer events
    const unsubLayers = listenToLayerEvents(rid, (event) => {
      window.dispatchEvent(new CustomEvent('collabLayerEvent', { detail: event }));
    });

    // Chat messages
    const unsubChat = listenToChat(rid, (msg) => {
      setChatMessages(prev => [...prev.slice(-99), msg]);
      if (!chatOpenRef.current) setUnreadCount(prev => prev + 1);
    });

    unsubsRef.current = [unsubUsers, unsubStrokes, unsubLive, unsubText, unsubWashi, unsubSticky, unsubImages, unsubTransforms, unsubClear, unsubViewports, unsubPages, unsubLayers, unsubChat];
  }, [user]);

  const resetState = useCallback(() => {
    setRemoteStrokes([]);
    setRemoteLiveStrokes([]);
    setRemoteTextAnnotations([]);
    setRemoteWashiTapes([]);
    setRemoteStickyNotes([]);
    setRemoteImageElements([]);
    setRemoteTransforms([]);
    setFollowingUserId(null);
    setRemoteViewports([]);
    setRemotePageSwitches([]);
    setChatMessages([]);
    setUnreadCount(0);
    myStrokeIdsRef.current = [];
    prevUserIdsRef.current = new Set();
    isInitialUsersLoadRef.current = true;
  }, []);

  const createRoom = useCallback(async (name?: string): Promise<string> => {
    if (!user) throw new Error('Must be signed in');
    const rid = await createCollabRoom(name);
    const color = getCollabColor(0);
    setMyColor(color);
    setMyRole('editor');
    setIsRoomCreator(true);
    await joinRoom(rid, myName, color, 'editor');
    roomIdRef.current = rid;
    setRoomId(rid);
    setIsConnected(true);
    resetState();
    setupListeners(rid);
    saveCollabSession({ roomId: rid, userName: myName, userColor: color, role: 'editor', timestamp: Date.now() });
    return rid;
  }, [user, myName, setupListeners, resetState]);

  const joinExistingRoom = useCallback(async (rid: string, role: CollabRole = 'editor'): Promise<void> => {
    if (!user) throw new Error('Must be signed in');
    const exists = await doesRoomExist(rid);
    if (!exists) throw new Error('Room not found');
    const color = getCollabColor(Math.floor(Math.random() * 10));
    setMyColor(color);
    setMyRole(role);
    await joinRoom(rid, myName, color, role);
    roomIdRef.current = rid;
    setRoomId(rid);
    setIsConnected(true);
    resetState();
    setupListeners(rid);
    const creatorId = await getRoomCreator(rid);
    setIsRoomCreator(creatorId === user.uid);
    saveCollabSession({ roomId: rid, userName: myName, userColor: color, role, timestamp: Date.now() });
  }, [user, myName, setupListeners, resetState]);

  const leave = useCallback(async (): Promise<void> => {
    if (roomIdRef.current) {
      unsubsRef.current.forEach(fn => fn());
      unsubsRef.current = [];
      await leaveRoom(roomIdRef.current);
      roomIdRef.current = null;
      setRoomId(null);
      setIsConnected(false);
      setUsers([]);
      setIsRoomCreator(false);
      resetState();
      clearCollabSession();
    }
  }, [resetState]);

  // Helper to check if the user can edit
  const canEdit = useCallback((): boolean => {
    return myRole !== 'viewer';
  }, [myRole]);

  const sendCursor = useCallback((x: number, y: number, tool?: string, isDrawing?: boolean) => {
    if (!roomIdRef.current) return;
    broadcastCursor(roomIdRef.current, x, y, tool, isDrawing);
  }, []);

  const sendLiveStroke = useCallback((stroke: Stroke, layerId: number) => {
    if (!roomIdRef.current || !canEdit()) return;
    broadcastLiveStroke(roomIdRef.current, stroke, layerId, myName, myColor);
  }, [myName, myColor, canEdit]);

  const finishLiveStroke = useCallback(() => {
    if (!roomIdRef.current) return;
    clearLiveStroke(roomIdRef.current);
  }, []);

  const sendStroke = useCallback(async (stroke: Stroke, layerId: number): Promise<string | null> => {
    if (!roomIdRef.current || !canEdit()) return null;
    try {
      const strokeId = await broadcastStroke(roomIdRef.current, stroke, layerId, myName, myColor);
      myStrokeIdsRef.current.push(strokeId);
      return strokeId;
    } catch (e) {
      console.warn('Failed to broadcast stroke:', e);
      return null;
    }
  }, [myName, myColor, canEdit]);

  const undoMyLastStroke = useCallback(async (): Promise<void> => {
    if (!roomIdRef.current || myStrokeIdsRef.current.length === 0) return;
    const lastId = myStrokeIdsRef.current.pop()!;
    await removeRemoteStroke(roomIdRef.current, lastId);
  }, []);

  const deleteRemoteStrokes = useCallback(async (strokeIds: string[]): Promise<void> => {
    if (!roomIdRef.current || strokeIds.length === 0 || !canEdit()) return;
    await broadcastStrokesDeletion(roomIdRef.current, strokeIds);
  }, [canEdit]);

  const getShareLink = useCallback((): string | null => {
    if (!roomIdRef.current) return null;
    return generateShareLink(roomIdRef.current);
  }, []);

  const sendTextAnnotation = useCallback((annotation: TextAnnotation, layerId: number, action: 'add' | 'update' | 'delete') => {
    if (!roomIdRef.current || !canEdit()) return;
    broadcastTextAnnotation(roomIdRef.current, annotation, layerId, myName, action);
  }, [myName, canEdit]);

  const sendWashiTape = useCallback((tape: WashiTapeData, layerId: number, action: 'add' | 'update' | 'delete') => {
    if (!roomIdRef.current || !canEdit()) return;
    broadcastWashiTape(roomIdRef.current, tape, layerId, myName, action);
  }, [myName, canEdit]);

  const sendStickyNote = useCallback((note: StickyNoteData, layerId: number, action: 'add' | 'update' | 'delete') => {
    if (!roomIdRef.current || !canEdit()) return;
    broadcastStickyNote(roomIdRef.current, note, layerId, myName, action);
  }, [myName, canEdit]);

  const sendImageElement = useCallback((image: CanvasImageData, layerId: number, action: 'add' | 'update' | 'delete') => {
    if (!roomIdRef.current || !canEdit()) return;
    broadcastImageElement(roomIdRef.current, image, layerId, myName, action);
  }, [myName, canEdit]);

  const sendTransform = useCallback((layerId: number, collabStrokeIds: string[], transformedStrokes: Stroke[]) => {
    if (!roomIdRef.current || !canEdit()) return;
    broadcastTransform(roomIdRef.current, layerId, collabStrokeIds, transformedStrokes, myName);
  }, [myName, canEdit]);

  const finishTransform = useCallback(() => {
    if (!roomIdRef.current) return;
    clearTransform(roomIdRef.current);
  }, []);

  const sendClearLayer = useCallback((layerId: number | 'all') => {
    if (!roomIdRef.current || !canEdit()) return;
    broadcastClearLayer(roomIdRef.current, layerId, myName);
  }, [myName, canEdit]);

  const sendViewport = useCallback((zoom: number, panX: number, panY: number) => {
    if (!roomIdRef.current) return;
    broadcastViewport(roomIdRef.current, zoom, panX, panY);
  }, []);

  const sendPageSwitch = useCallback((pageIndex: number) => {
    if (!roomIdRef.current) return;
    broadcastPageSwitch(roomIdRef.current, pageIndex, myName);
  }, [myName]);

  const changeUserRole = useCallback(async (targetUserId: string, role: CollabRole): Promise<void> => {
    if (!roomIdRef.current || !isRoomCreator) return;
    await setUserRole(roomIdRef.current, targetUserId, role);
    // Role changed silently
  }, [isRoomCreator]);

  const sendLayerEvent = useCallback((action: LayerAction, data?: Partial<RemoteLayerEvent>) => {
    if (!roomIdRef.current || !canEdit()) return;
    broadcastLayerEvent(roomIdRef.current, { action, userName: myName, ...data });
  }, [myName, canEdit]);

  const sendChatMessage = useCallback((text: string) => {
    if (!roomIdRef.current || !text.trim()) return;
    broadcastChatMessage(roomIdRef.current, text.trim(), myName, myColor);
    // Add own message locally
    setChatMessages(prev => [...prev.slice(-99), {
      id: Date.now().toString(),
      userId: user?.uid || '',
      userName: myName,
      userColor: myColor,
      text: text.trim(),
      timestamp: Date.now(),
    }]);
  }, [myName, myColor, user]);

  const markChatRead = useCallback(() => {
    chatOpenRef.current = true;
    setUnreadCount(0);
  }, []);

  // Track when chat is closed
  const setChatClosed = useCallback(() => {
    chatOpenRef.current = false;
  }, []);

  const followUser = useCallback((userId: string | null) => {
    if (!roomIdRef.current) return;
    setFollowingUserId(userId);
    if (userId) {
      broadcastFollowRequest(roomIdRef.current, userId);
    } else {
      clearFollowRequest(roomIdRef.current);
    }
  }, []);

  return {
    isConnected,
    roomId,
    users,
    remoteStrokes,
    remoteLiveStrokes,
    remoteTextAnnotations,
    remoteWashiTapes,
    remoteStickyNotes,
    remoteImageElements,
    remoteTransforms,
    remoteViewports,
    remotePageSwitches,
    followingUserId,
    myColor,
    myName,
    myUserId: user?.uid || null,
    myRole,
    isRoomCreator,
    chatMessages,
    unreadCount,
    createRoom,
    joinExistingRoom,
    leave,
    sendCursor,
    sendLiveStroke,
    finishLiveStroke,
    sendStroke,
    undoMyLastStroke,
    deleteRemoteStrokes,
    getShareLink,
    sendTextAnnotation,
    sendWashiTape,
    sendStickyNote,
    sendImageElement,
    sendTransform,
    finishTransform,
    sendClearLayer,
    sendViewport,
    sendPageSwitch,
    sendLayerEvent,
    sendChatMessage,
    markChatRead,
    followUser,
    changeUserRole,
  };
};
