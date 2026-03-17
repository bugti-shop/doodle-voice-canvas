/**
 * Shared Task Comments — Firebase Realtime Database layer.
 *
 * Data: teams/{teamId}/taskComments/{taskId}/{commentId}
 */

import { ref, push, get, update, onValue, off } from 'firebase/database';
import { firebaseDb } from '@/lib/firebase';

export interface TaskComment {
  id: string;
  taskId: string;
  teamId: string;
  authorUid: string;
  authorName: string;
  authorPhoto?: string;
  text: string;
  createdAt: string;
  editedAt?: string;
}

// ── Write ──────────────────────────────────────────────────

export const addTaskComment = async (
  teamId: string,
  taskId: string,
  authorUid: string,
  authorName: string,
  text: string,
  authorPhoto?: string,
): Promise<TaskComment> => {
  const commentRef = push(ref(firebaseDb, `teams/${teamId}/taskComments/${taskId}`));
  const now = new Date().toISOString();

  const comment: TaskComment = {
    id: commentRef.key!,
    taskId,
    teamId,
    authorUid,
    authorName,
    authorPhoto: authorPhoto || undefined,
    text: text.trim(),
    createdAt: now,
  };

  await update(ref(firebaseDb), {
    [`teams/${teamId}/taskComments/${taskId}/${commentRef.key}`]: comment,
  });

  return comment;
};

export const deleteTaskComment = async (
  teamId: string,
  taskId: string,
  commentId: string,
): Promise<void> => {
  await update(ref(firebaseDb), {
    [`teams/${teamId}/taskComments/${taskId}/${commentId}`]: null,
  });
};

export const editTaskComment = async (
  teamId: string,
  taskId: string,
  commentId: string,
  newText: string,
): Promise<void> => {
  await update(ref(firebaseDb, `teams/${teamId}/taskComments/${taskId}/${commentId}`), {
    text: newText.trim(),
    editedAt: new Date().toISOString(),
  });
};

// ── Read ───────────────────────────────────────────────────

export const getTaskComments = async (
  teamId: string,
  taskId: string,
): Promise<TaskComment[]> => {
  const snap = await get(ref(firebaseDb, `teams/${teamId}/taskComments/${taskId}`));
  if (!snap.exists()) return [];
  const items = Object.values(snap.val() as Record<string, TaskComment>);
  return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
};

// ── Real-time listener ─────────────────────────────────────

export const onTaskCommentsChanged = (
  teamId: string,
  taskId: string,
  callback: (comments: TaskComment[]) => void,
) => {
  const dbRef = ref(firebaseDb, `teams/${teamId}/taskComments/${taskId}`);

  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) {
      callback([]);
      return;
    }
    const items = Object.values(snap.val() as Record<string, TaskComment>);
    callback(items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  });

  return () => off(dbRef, 'value', unsub as any);
};

// ── Comment count (for badge) ──────────────────────────────

export const getCommentCount = async (
  teamId: string,
  taskId: string,
): Promise<number> => {
  const snap = await get(ref(firebaseDb, `teams/${teamId}/taskComments/${taskId}`));
  if (!snap.exists()) return 0;
  return Object.keys(snap.val()).length;
};
