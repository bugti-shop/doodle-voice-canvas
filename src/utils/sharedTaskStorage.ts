/**
 * Shared Team Tasks — Firebase Realtime Database layer.
 *
 * Data lives under:
 *   teams/{teamId}/sharedTasks/{taskId}  — the shared task objects
 *   teams/{teamId}/taskLists/{listId}    — named task list metadata
 */

import { ref, set, get, push, update, onValue, off, remove } from 'firebase/database';
import { firebaseDb } from '@/lib/firebase';

// ── Types ──────────────────────────────────────────────────

export type SharedTaskPriority = 'high' | 'medium' | 'low' | 'none';
export type SharedTaskStatus = 'todo' | 'in_progress' | 'done';

export interface SharedTask {
  id: string;
  teamId: string;
  listId: string;
  title: string;
  description?: string;
  priority: SharedTaskPriority;
  status: SharedTaskStatus;
  completed: boolean;
  assigneeUid?: string;
  assigneeName?: string;
  assigneePhoto?: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
  completedAt?: string;
  completedBy?: string;
  order: number;
}

export interface TaskList {
  id: string;
  teamId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  taskCount: number;
}

// ── Task List CRUD ─────────────────────────────────────────

export const createTaskList = async (
  teamId: string,
  name: string,
  createdBy: string,
): Promise<TaskList> => {
  const listRef = push(ref(firebaseDb, `teams/${teamId}/taskLists`));
  const listId = listRef.key!;
  const now = new Date().toISOString();

  const list: TaskList = {
    id: listId,
    teamId,
    name: name.trim(),
    createdBy,
    createdAt: now,
    taskCount: 0,
  };

  await set(listRef, list);
  return list;
};

export const getTaskLists = async (teamId: string): Promise<TaskList[]> => {
  const snap = await get(ref(firebaseDb, `teams/${teamId}/taskLists`));
  if (!snap.exists()) return [];
  return Object.values(snap.val() as Record<string, TaskList>);
};

export const deleteTaskList = async (teamId: string, listId: string): Promise<void> => {
  // Delete all tasks in the list
  const tasksSnap = await get(ref(firebaseDb, `teams/${teamId}/sharedTasks`));
  const updates: Record<string, any> = {
    [`teams/${teamId}/taskLists/${listId}`]: null,
  };

  if (tasksSnap.exists()) {
    const tasks = tasksSnap.val() as Record<string, SharedTask>;
    Object.entries(tasks).forEach(([taskId, task]) => {
      if (task.listId === listId) {
        updates[`teams/${teamId}/sharedTasks/${taskId}`] = null;
      }
    });
  }

  await update(ref(firebaseDb), updates);
};

export const renameTaskList = async (teamId: string, listId: string, name: string): Promise<void> => {
  await update(ref(firebaseDb, `teams/${teamId}/taskLists/${listId}`), { name: name.trim() });
};

// ── Shared Task CRUD ───────────────────────────────────────

export const addSharedTask = async (
  teamId: string,
  listId: string,
  title: string,
  createdBy: string,
  createdByName: string,
  options?: {
    description?: string;
    priority?: SharedTaskPriority;
    assigneeUid?: string;
    assigneeName?: string;
    assigneePhoto?: string;
    dueDate?: string;
  },
): Promise<SharedTask> => {
  const taskRef = push(ref(firebaseDb, `teams/${teamId}/sharedTasks`));
  const taskId = taskRef.key!;
  const now = new Date().toISOString();

  // Get current task count for ordering
  const listSnap = await get(ref(firebaseDb, `teams/${teamId}/taskLists/${listId}`));
  const currentCount = listSnap.exists() ? (listSnap.val() as TaskList).taskCount : 0;

  const task: SharedTask = {
    id: taskId,
    teamId,
    listId,
    title: title.trim(),
    description: options?.description || '',
    priority: options?.priority || 'none',
    status: 'todo',
    completed: false,
    assigneeUid: options?.assigneeUid,
    assigneeName: options?.assigneeName,
    assigneePhoto: options?.assigneePhoto,
    createdBy,
    createdByName,
    createdAt: now,
    updatedAt: now,
    dueDate: options?.dueDate,
    order: currentCount,
  };

  await update(ref(firebaseDb), {
    [`teams/${teamId}/sharedTasks/${taskId}`]: task,
    [`teams/${teamId}/taskLists/${listId}/taskCount`]: currentCount + 1,
  });

  return task;
};

export const updateSharedTask = async (
  teamId: string,
  taskId: string,
  updates: Partial<Pick<SharedTask, 'title' | 'description' | 'priority' | 'status' | 'assigneeUid' | 'assigneeName' | 'assigneePhoto' | 'dueDate' | 'completed' | 'completedAt' | 'completedBy' | 'order'>>,
): Promise<void> => {
  await update(ref(firebaseDb, `teams/${teamId}/sharedTasks/${taskId}`), {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
};

export const toggleSharedTaskComplete = async (
  teamId: string,
  taskId: string,
  completed: boolean,
  completedByName?: string,
): Promise<void> => {
  const now = new Date().toISOString();
  await update(ref(firebaseDb, `teams/${teamId}/sharedTasks/${taskId}`), {
    completed,
    status: completed ? 'done' : 'todo',
    completedAt: completed ? now : null,
    completedBy: completed ? completedByName : null,
    updatedAt: now,
  });
};

export const deleteSharedTask = async (teamId: string, taskId: string, listId: string): Promise<void> => {
  const listSnap = await get(ref(firebaseDb, `teams/${teamId}/taskLists/${listId}`));
  const currentCount = listSnap.exists() ? (listSnap.val() as TaskList).taskCount : 1;

  await update(ref(firebaseDb), {
    [`teams/${teamId}/sharedTasks/${taskId}`]: null,
    [`teams/${teamId}/taskLists/${listId}/taskCount`]: Math.max(0, currentCount - 1),
  });
};

export const assignTask = async (
  teamId: string,
  taskId: string,
  assigneeUid: string,
  assigneeName: string,
  assigneePhoto?: string,
): Promise<void> => {
  await update(ref(firebaseDb, `teams/${teamId}/sharedTasks/${taskId}`), {
    assigneeUid,
    assigneeName,
    assigneePhoto: assigneePhoto || null,
    updatedAt: new Date().toISOString(),
  });
};

export const unassignTask = async (teamId: string, taskId: string): Promise<void> => {
  await update(ref(firebaseDb, `teams/${teamId}/sharedTasks/${taskId}`), {
    assigneeUid: null,
    assigneeName: null,
    assigneePhoto: null,
    updatedAt: new Date().toISOString(),
  });
};

// ── Queries ────────────────────────────────────────────────

export const getSharedTasks = async (teamId: string, listId?: string): Promise<SharedTask[]> => {
  const snap = await get(ref(firebaseDb, `teams/${teamId}/sharedTasks`));
  if (!snap.exists()) return [];

  const all = Object.values(snap.val() as Record<string, SharedTask>);
  const filtered = listId ? all.filter(t => t.listId === listId) : all;
  return filtered.sort((a, b) => a.order - b.order);
};

// ── Real-time Listeners ────────────────────────────────────

export const onSharedTasksChanged = (
  teamId: string,
  listId: string,
  callback: (tasks: SharedTask[]) => void,
) => {
  const dbRef = ref(firebaseDb, `teams/${teamId}/sharedTasks`);
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) {
      callback([]);
      return;
    }
    const all = Object.values(snap.val() as Record<string, SharedTask>);
    const filtered = all.filter(t => t.listId === listId).sort((a, b) => a.order - b.order);
    callback(filtered);
  });
  return () => off(dbRef, 'value', unsub as any);
};

export const onTaskListsChanged = (
  teamId: string,
  callback: (lists: TaskList[]) => void,
) => {
  const dbRef = ref(firebaseDb, `teams/${teamId}/taskLists`);
  const unsub = onValue(dbRef, (snap) => {
    if (!snap.exists()) {
      callback([]);
      return;
    }
    callback(Object.values(snap.val() as Record<string, TaskList>));
  });
  return () => off(dbRef, 'value', unsub as any);
};
