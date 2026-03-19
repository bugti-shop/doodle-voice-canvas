/**
 * useFirebaseSync — Bridges local IndexedDB/state with Firebase Realtime Database.
 *
 * Syncs: notes, tasks, folders, note folders, sections, tags, habits,
 * app settings (priorities, streaks, gamification, themes, app lock, task order,
 * sketch notebooks, challenges, daily rewards, smart views, note type visibility,
 * weekly goals), and virtual journey.
 */

import { useEffect, useRef, useCallback } from 'react';
import { addToQueue, processOfflineQueue, getQueueSize } from '@/utils/offlineSyncQueue';
import { queueSyncNotification, showQueueProcessedNotification } from '@/utils/smartSyncNotifications';
import { useGoogleAuth } from '@/contexts/GoogleAuthContext';
import {
  syncNotesToFirebase,
  syncTasksToFirebase,
  syncFoldersToFirebase,
  syncNoteFoldersToFirebase,
  syncSectionsToFirebase,
  syncTagsToFirebase,
  syncHabitsToFirebase,
  syncAppSettingsToFirebase,
  syncVirtualJourneyToFirebase,
  updateSyncTimestamp,
  loadNotesFromFirebase,
  loadTasksFromFirebase,
  loadFoldersFromFirebase,
  loadNoteFoldersFromFirebase,
  loadSectionsFromFirebase,
  loadTagsFromFirebase,
  loadHabitsFromFirebase,
  loadAppSettingsFromFirebase,
  loadVirtualJourneyFromFirebase,
  onNotesChanged,
  onTasksChanged,
  onFoldersChanged,
  onNoteFoldersChanged,
  onSectionsChanged,
  onTagsChanged,
  onHabitsChanged,
  onAppSettingsChanged,
  onVirtualJourneyChanged,
} from '@/utils/firebaseSync';
import { loadNotesFromDB, saveNotesToDB } from '@/utils/noteStorage';
import { loadTasksFromDB, saveTasksToDB } from '@/utils/taskStorage';
import { getSetting, setSetting, getAllSettings } from '@/utils/settingsStorage';
import { getAllTags, saveAllTags } from '@/utils/tagStorage';
import { loadHabits, saveHabit } from '@/utils/habitStorage';
import { loadJourneyData, saveJourneyData, sanitizeJourneyData, VirtualJourneyData } from '@/utils/virtualJourneyStorage';
import { Folder, TaskSection } from '@/types/note';

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

const setSyncStatus = (status: SyncStatus) => {
  window.dispatchEvent(new CustomEvent('syncStatusChanged', { detail: { status, timestamp: Date.now() } }));
};

// Settings keys that should be synced across devices
const SYNCED_SETTINGS_KEYS = [
  'customPriorities',
  'flowist_task_streak',
  'flowist_notes_streak',
  'flowist_habits_streak',
  'flowist_achievements',
  'flowist_daily_challenges',
  'flowist_weekly_challenges',
  'flowist_monthly_challenges',
  'flowist_monthly_badges',
  'flowist_weekly_goals',
  'flowist_daily_login_reward',
  'custom_themes',
  'active_custom_theme',
  'appLockSettings',
  'taskCustomOrder',
  'sketch_notebooks',
  'sketch_folders',
  'customSmartViews',
  'visible_note_types',
  'visible_features',
  'todoViewMode',
  'todoSortBy',
  'todoShowCompleted',
  'todoCompactMode',
  'todoGroupByOption',
  'todoSmartList',
  'todoSelectedFolder',
  'todoDefaultSectionId',
  'todoTaskAddPosition',
  'todoShowStatusBadge',
  'todoHideDetailsOptions',
  'flowist_language',
  'theme',
  'darkMode',
  'haptic_intensity',
  // Note protection/passwords
  'flowist_hidden_notes_password',
  'flowist_hidden_notes_salt',
  'flowist_hidden_notes_use_biometric',
  'flowist_security_question',
  'flowist_security_answer',
  'flowist_security_answer_salt',
  // Note version history
  'note_versions',
  // Widget settings
  'widget_configs',
  // Toolbar order preferences
  'wordToolbarOrder',
  'wordToolbarVisibility',
  // Folder structure (nota_folders)
  'nota_folders',
];

// Flag to prevent sync loops when restoring from cloud
let isRestoringAppSettings = false;

export function useFirebaseSync() {
  const { user } = useGoogleAuth();
  const uid = user?.uid;

  const initialRestoreDone = useRef(false);
  const listenersAttached = useRef(false);
  const uploadTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const uploadInProgress = useRef<Set<string>>(new Set());
  const unsubscribers = useRef<Array<() => void>>([]);

  // ── Collect syncable settings ────────────────────────────

  const collectSyncedSettings = useCallback(async (): Promise<Record<string, any>> => {
    const all = await getAllSettings();
    const filtered: Record<string, any> = {};
    for (const key of SYNCED_SETTINGS_KEYS) {
      if (key === 'nota_folders') {
        // nota_folders is stored in localStorage directly by folderStorage.ts
        try {
          const raw = localStorage.getItem('nota_folders');
          if (raw) filtered['nota_folders'] = JSON.parse(raw);
        } catch {}
        continue;
      }
      if (key in all) {
        filtered[key] = all[key];
      }
    }
    return filtered;
  }, []);

  const restoreSyncedSettings = useCallback(async (cloudSettings: Record<string, any>) => {
    isRestoringAppSettings = true;
    try {
      for (const [key, value] of Object.entries(cloudSettings)) {
        if (SYNCED_SETTINGS_KEYS.includes(key) && value !== null && value !== undefined) {
          if (key === 'nota_folders') {
            // nota_folders goes to localStorage directly
            localStorage.setItem('nota_folders', JSON.stringify(value));
            window.dispatchEvent(new Event('foldersUpdated'));
            continue;
          }
          await setSetting(key, value);
        }
      }
    } finally {
      // Delay reset long enough for all async event handlers to settle.
      // 500ms was too short — settings writes + event propagation can take longer.
      setTimeout(() => { isRestoringAppSettings = false; }, 3000);
    }
  }, []);

  // ── Initial restore (cloud → local) ──────────────────────

  const performInitialRestore = useCallback(async (userId: string) => {
    if (initialRestoreDone.current) return;
    console.log('[Sync] Starting initial cloud → local restore...');
    setSyncStatus('syncing');

    try {
      const [cloudNotes, cloudTasks, cloudFolders, cloudNoteFolders, cloudSections, cloudTags, cloudHabits, cloudAppSettings, cloudJourney] = await Promise.all([
        loadNotesFromFirebase(userId),
        loadTasksFromFirebase(userId),
        loadFoldersFromFirebase(userId),
        loadNoteFoldersFromFirebase(userId),
        loadSectionsFromFirebase(userId),
        loadTagsFromFirebase(userId),
        loadHabitsFromFirebase(userId),
        loadAppSettingsFromFirebase(userId),
        loadVirtualJourneyFromFirebase(userId),
      ]);

      if (cloudNotes && cloudNotes.length > 0) {
        const hydrated = cloudNotes.map((n: any) => ({
          ...n,
          createdAt: new Date(n.createdAt),
          updatedAt: new Date(n.updatedAt),
          archivedAt: n.archivedAt ? new Date(n.archivedAt) : undefined,
          deletedAt: n.deletedAt ? new Date(n.deletedAt) : undefined,
          reminderTime: n.reminderTime ? new Date(n.reminderTime) : undefined,
          voiceRecordings: n.voiceRecordings?.map((r: any) => ({
            ...r,
            timestamp: new Date(r.timestamp),
          })) || [],
        }));
        await saveNotesToDB(hydrated, true);
        window.dispatchEvent(new Event('notesRestored'));
      }

      if (cloudTasks && cloudTasks.length > 0) {
        const hydrated = cloudTasks.map((t: any) => ({
          ...t,
          dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
          reminderTime: t.reminderTime ? new Date(t.reminderTime) : undefined,
          createdAt: t.createdAt ? new Date(t.createdAt) : undefined,
          modifiedAt: t.modifiedAt ? new Date(t.modifiedAt) : undefined,
          completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
          voiceRecording: t.voiceRecording ? {
            ...t.voiceRecording,
            timestamp: new Date(t.voiceRecording.timestamp),
          } : undefined,
          subtasks: t.subtasks?.map((s: any) => ({
            ...s,
            dueDate: s.dueDate ? new Date(s.dueDate) : undefined,
            reminderTime: s.reminderTime ? new Date(s.reminderTime) : undefined,
            createdAt: s.createdAt ? new Date(s.createdAt) : undefined,
          })),
        }));
        await saveTasksToDB(hydrated, true);
        window.dispatchEvent(new Event('tasksRestored'));
      }

      if (cloudFolders && cloudFolders.length > 0) {
        const hydrated = cloudFolders.map((f: any) => ({
          ...f,
          createdAt: new Date(f.createdAt),
        }));
        await setSetting('todoFolders', hydrated);
        window.dispatchEvent(new Event('foldersRestored'));
      }

      if (cloudNoteFolders && cloudNoteFolders.length > 0) {
        const hydrated = cloudNoteFolders.map((f: any) => ({
          ...f,
          createdAt: new Date(f.createdAt),
          updatedAt: f.updatedAt ? new Date(f.updatedAt) : new Date(f.createdAt),
        }));
        await setSetting('folders', hydrated);
        window.dispatchEvent(new Event('foldersUpdated'));
      }

      if (cloudSections && cloudSections.length > 0) {
        await setSetting('todoSections', cloudSections);
        window.dispatchEvent(new Event('sectionsRestored'));
      }

      if (cloudTags && cloudTags.length > 0) {
        const hydrated = cloudTags.map((t: any) => ({
          ...t,
          createdAt: new Date(t.createdAt),
        }));
        await saveAllTags(hydrated);
        window.dispatchEvent(new Event('tagsRestored'));
      }

      // Restore habits
      if (cloudHabits && cloudHabits.length > 0) {
        for (const habit of cloudHabits) {
          await saveHabit(habit);
        }
        window.dispatchEvent(new Event('habitsRestored'));
      }

      // Restore app settings (priorities, streaks, themes, etc.)
      if (cloudAppSettings && Object.keys(cloudAppSettings).length > 0) {
        await restoreSyncedSettings(cloudAppSettings);
        window.dispatchEvent(new Event('appSettingsRestored'));
        window.dispatchEvent(new Event('prioritiesChanged'));
        window.dispatchEvent(new Event('weeklyGoalsUpdated'));
      }

      // Restore virtual journey
      if (cloudJourney) {
        saveJourneyData(cloudJourney as VirtualJourneyData);
        window.dispatchEvent(new Event('journeyRestored'));
      }

      initialRestoreDone.current = true;
      setSyncStatus('synced');
      console.log('[Sync] Initial restore complete.');
    } catch (err) {
      console.error('[Sync] Initial restore failed:', err);
      setSyncStatus('error');
      initialRestoreDone.current = true;
    }
  }, [restoreSyncedSettings]);

  // ── Manual full sync (push all local → cloud) ────────────

  const performManualSync = useCallback(async (userId: string) => {
    console.log('[Sync] Manual sync triggered...');
    setSyncStatus('syncing');
    try {
      const [notes, tasks, folders, noteFolders, sections, tags, habits, appSettings] = await Promise.all([
        loadNotesFromDB(),
        loadTasksFromDB(),
        getSetting<Folder[]>('todoFolders', []),
        getSetting<any[]>('folders', []),
        getSetting<TaskSection[]>('todoSections', []),
        getAllTags(),
        loadHabits(),
        collectSyncedSettings(),
      ]);

      const journeyData = loadJourneyData();

      await Promise.all([
        syncNotesToFirebase(userId, notes),
        syncTasksToFirebase(userId, tasks),
        syncFoldersToFirebase(userId, folders),
        syncNoteFoldersToFirebase(userId, noteFolders),
        syncSectionsToFirebase(userId, sections),
        syncTagsToFirebase(userId, tags),
        syncHabitsToFirebase(userId, habits),
        syncAppSettingsToFirebase(userId, appSettings),
        syncVirtualJourneyToFirebase(userId, journeyData),
        updateSyncTimestamp(userId),
      ]);

      setSyncStatus('synced');
      console.log('[Sync] Manual sync complete.');
    } catch (err) {
      console.error('[Sync] Manual sync failed:', err);
      setSyncStatus('error');
    }
  }, [collectSyncedSettings]);

  // ── Debounced upload helper ──────────────────────────────

  const scheduleUpload = useCallback((key: string, uploadFn: () => Promise<void>, delayMs = 1500) => {
    if (!initialRestoreDone.current) {
      console.log(`[Sync] Skipping upload for "${key}" — initial restore not done`);
      return;
    }
    if (uploadTimers.current[key]) clearTimeout(uploadTimers.current[key]);
    uploadTimers.current[key] = setTimeout(async () => {
      try {
        setSyncStatus('syncing');
        uploadInProgress.current.add(key);
        await uploadFn();
        setSyncStatus('synced');
      } catch (err) {
        console.error(`[Sync] Upload "${key}" failed:`, err);
        setSyncStatus('error');
      } finally {
        uploadInProgress.current.delete(key);
      }
    }, delayMs);
  }, []);

  // ── Attach real-time listeners ───────────────────────────

  const attachListeners = useCallback((userId: string) => {
    if (listenersAttached.current) return;
    listenersAttached.current = true;

    const unsubNotes = onNotesChanged(userId, (cloudNotes) => {
      if (uploadInProgress.current.has('notes')) return;
      const hydrated = cloudNotes.map((n: any) => ({
        ...n,
        createdAt: new Date(n.createdAt),
        updatedAt: new Date(n.updatedAt),
        archivedAt: n.archivedAt ? new Date(n.archivedAt) : undefined,
        deletedAt: n.deletedAt ? new Date(n.deletedAt) : undefined,
        reminderTime: n.reminderTime ? new Date(n.reminderTime) : undefined,
        voiceRecordings: n.voiceRecordings?.map((r: any) => ({
          ...r,
          timestamp: new Date(r.timestamp),
        })) || [],
      }));
      saveNotesToDB(hydrated, true).then(() => {
        window.dispatchEvent(new Event('notesRestored'));
        queueSyncNotification('notes');
      });
    });

    const unsubTasks = onTasksChanged(userId, (cloudTasks) => {
      if (uploadInProgress.current.has('tasks')) return;
      const hydrated = cloudTasks.map((t: any) => ({
        ...t,
        dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
        reminderTime: t.reminderTime ? new Date(t.reminderTime) : undefined,
        createdAt: t.createdAt ? new Date(t.createdAt) : undefined,
        modifiedAt: t.modifiedAt ? new Date(t.modifiedAt) : undefined,
        completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
        voiceRecording: t.voiceRecording
          ? {
              ...t.voiceRecording,
              timestamp: new Date(t.voiceRecording.timestamp),
            }
          : undefined,
      }));
      saveTasksToDB(hydrated, true).then(() => {
        window.dispatchEvent(new Event('tasksRestored'));
        queueSyncNotification('tasks');
      });
    });

    const unsubFolders = onFoldersChanged(userId, (cloudFolders) => {
      if (uploadInProgress.current.has('folders')) return;
      const hydrated = cloudFolders.map((f: any) => ({
        ...f,
        createdAt: new Date(f.createdAt),
      }));
      setSetting('todoFolders', hydrated).then(() => {
        window.dispatchEvent(new Event('foldersRestored'));
      });
    });

    const unsubNoteFolders = onNoteFoldersChanged(userId, (cloudNoteFolders) => {
      if (uploadInProgress.current.has('folders')) return;
      const hydrated = cloudNoteFolders.map((f: any) => ({
        ...f,
        createdAt: new Date(f.createdAt),
        updatedAt: f.updatedAt ? new Date(f.updatedAt) : new Date(f.createdAt),
      }));
      setSetting('folders', hydrated).then(() => {
        window.dispatchEvent(new Event('foldersRestored'));
      });
    });

    const unsubSections = onSectionsChanged(userId, (cloudSections) => {
      setSetting('todoSections', cloudSections).then(() => {
        window.dispatchEvent(new Event('sectionsRestored'));
      });
    });

    const unsubTags = onTagsChanged(userId, (cloudTags) => {
      const hydrated = cloudTags.map((t: any) => ({
        ...t,
        createdAt: new Date(t.createdAt),
      }));
      saveAllTags(hydrated).then(() => {
        window.dispatchEvent(new Event('tagsRestored'));
      });
    });

    const unsubHabits = onHabitsChanged(userId, (cloudHabits) => {
      if (uploadInProgress.current.has('habits')) return;
      (async () => {
        for (const habit of cloudHabits) {
          await saveHabit(habit);
        }
        window.dispatchEvent(new Event('habitsRestored'));
      })();
    });

    const unsubAppSettings = onAppSettingsChanged(userId, (cloudSettings) => {
      if (uploadInProgress.current.has('appSettings')) return;
      restoreSyncedSettings(cloudSettings).then(() => {
        window.dispatchEvent(new Event('appSettingsRestored'));
        window.dispatchEvent(new Event('prioritiesChanged'));
        window.dispatchEvent(new Event('weeklyGoalsUpdated'));
      });
    });

    const unsubJourney = onVirtualJourneyChanged(userId, (cloudJourney) => {
      if (uploadInProgress.current.has('virtualJourney') || !cloudJourney) return;
      const sanitized = sanitizeJourneyData(cloudJourney);
      saveJourneyData(sanitized);
      window.dispatchEvent(new Event('journeyRestored'));
    });

    unsubscribers.current = [unsubNotes, unsubTasks, unsubFolders, unsubNoteFolders, unsubSections, unsubTags, unsubHabits, unsubAppSettings, unsubJourney];
  }, [restoreSyncedSettings]);

  // ── Listen for local changes → upload ────────────────────

  useEffect(() => {
    if (!uid) return;

    const handleNotesUpdated = () => {
      scheduleUpload('notes', async () => {
        const notes = await loadNotesFromDB();
        await syncNotesToFirebase(uid, notes);
        await updateSyncTimestamp(uid);
      });
    };

    const handleTasksUpdated = () => {
      scheduleUpload('tasks', async () => {
        const tasks = await loadTasksFromDB();
        await syncTasksToFirebase(uid, tasks);
        await updateSyncTimestamp(uid);
      });
    };

    const handleSectionsUpdated = () => {
      scheduleUpload('sections', async () => {
        const sections = await getSetting<TaskSection[]>('todoSections', []);
        await syncSectionsToFirebase(uid, sections);
      });
    };

    const handleFoldersUpdated = () => {
      scheduleUpload('folders', async () => {
        const [todoFolders, noteFolders] = await Promise.all([
          getSetting<Folder[]>('todoFolders', []),
          getSetting<any[]>('folders', []),
        ]);

        await Promise.all([
          syncFoldersToFirebase(uid, todoFolders),
          syncNoteFoldersToFirebase(uid, noteFolders),
        ]);
      });
    };

    const handleTagsUpdated = () => {
      scheduleUpload('tags', async () => {
        const tags = await getAllTags();
        await syncTagsToFirebase(uid, tags);
      });
    };

    const handleHabitsUpdated = () => {
      scheduleUpload('habits', async () => {
        const habits = await loadHabits();
        await syncHabitsToFirebase(uid, habits);
      });
    };

    const handleAppSettingsUpdated = () => {
      if (isRestoringAppSettings) return;
      scheduleUpload('appSettings', async () => {
        const settings = await collectSyncedSettings();
        await syncAppSettingsToFirebase(uid, settings);
      });
    };

    const handleVirtualJourneyUpdated = () => {
      scheduleUpload('virtualJourney', async () => {
        const data = loadJourneyData();
        await syncVirtualJourneyToFirebase(uid, data);
      });
    };

    window.addEventListener('notesUpdated', handleNotesUpdated);
    window.addEventListener('tasksUpdated', handleTasksUpdated);
    window.addEventListener('sectionsUpdated', handleSectionsUpdated);
    window.addEventListener('foldersUpdated', handleFoldersUpdated);
    window.addEventListener('tagsUpdated', handleTagsUpdated);
    window.addEventListener('habitsUpdated', handleHabitsUpdated);
    // App settings change events
    window.addEventListener('prioritiesChanged', handleAppSettingsUpdated);
    window.addEventListener('weeklyGoalsUpdated', handleAppSettingsUpdated);
    window.addEventListener('achievementUnlocked', handleAppSettingsUpdated);
    window.addEventListener('challengeCompleted', handleAppSettingsUpdated);
    window.addEventListener('weeklyChallengesUpdated', handleAppSettingsUpdated);
    window.addEventListener('monthlyChallengesUpdated', handleAppSettingsUpdated);
    window.addEventListener('appLockUpdated', handleAppSettingsUpdated);
    window.addEventListener('noteTypesVisibilityChanged', handleAppSettingsUpdated);
    window.addEventListener('featureVisibilityChanged', handleAppSettingsUpdated);
    window.addEventListener('customThemeChanged', handleAppSettingsUpdated);
    window.addEventListener('taskOrderChanged', handleAppSettingsUpdated);
    window.addEventListener('sketchNotebooksUpdated', handleAppSettingsUpdated);
    window.addEventListener('smartViewsUpdated', handleAppSettingsUpdated);
    window.addEventListener('dailyRewardClaimed', handleAppSettingsUpdated);
    window.addEventListener('settingsUpdated', handleAppSettingsUpdated);
    // Toolbar order & visibility
    window.addEventListener('toolbarOrderChanged', handleAppSettingsUpdated);
    window.addEventListener('toolbarVisibilityChanged', handleAppSettingsUpdated);
    // Note version history
    window.addEventListener('noteVersionsUpdated', handleAppSettingsUpdated);
    // Note protection changes (via settingsUpdated)
    // Widget config changes (via settingsUpdated)
    // Virtual journey
    window.addEventListener('journeyUpdated', handleVirtualJourneyUpdated);

    return () => {
      window.removeEventListener('notesUpdated', handleNotesUpdated);
      window.removeEventListener('tasksUpdated', handleTasksUpdated);
      window.removeEventListener('sectionsUpdated', handleSectionsUpdated);
      window.removeEventListener('foldersUpdated', handleFoldersUpdated);
      window.removeEventListener('tagsUpdated', handleTagsUpdated);
      window.removeEventListener('habitsUpdated', handleHabitsUpdated);
      window.removeEventListener('prioritiesChanged', handleAppSettingsUpdated);
      window.removeEventListener('weeklyGoalsUpdated', handleAppSettingsUpdated);
      window.removeEventListener('achievementUnlocked', handleAppSettingsUpdated);
      window.removeEventListener('challengeCompleted', handleAppSettingsUpdated);
      window.removeEventListener('weeklyChallengesUpdated', handleAppSettingsUpdated);
      window.removeEventListener('monthlyChallengesUpdated', handleAppSettingsUpdated);
      window.removeEventListener('appLockUpdated', handleAppSettingsUpdated);
      window.removeEventListener('noteTypesVisibilityChanged', handleAppSettingsUpdated);
      window.removeEventListener('featureVisibilityChanged', handleAppSettingsUpdated);
      window.removeEventListener('customThemeChanged', handleAppSettingsUpdated);
      window.removeEventListener('taskOrderChanged', handleAppSettingsUpdated);
      window.removeEventListener('sketchNotebooksUpdated', handleAppSettingsUpdated);
      window.removeEventListener('smartViewsUpdated', handleAppSettingsUpdated);
      window.removeEventListener('dailyRewardClaimed', handleAppSettingsUpdated);
      window.removeEventListener('settingsUpdated', handleAppSettingsUpdated);
      window.removeEventListener('toolbarOrderChanged', handleAppSettingsUpdated);
      window.removeEventListener('toolbarVisibilityChanged', handleAppSettingsUpdated);
      window.removeEventListener('noteVersionsUpdated', handleAppSettingsUpdated);
      window.removeEventListener('journeyUpdated', handleVirtualJourneyUpdated);
    };
  }, [uid, scheduleUpload, collectSyncedSettings]);

  // ── Manual sync listener ─────────────────────────────────

  useEffect(() => {
    if (!uid) return;
    const handler = () => performManualSync(uid);
    window.addEventListener('triggerManualSync', handler);
    return () => window.removeEventListener('triggerManualSync', handler);
  }, [uid, performManualSync]);

  // ── Main effect: restore + listen ────────────────────────

  useEffect(() => {
    if (!uid) {
      initialRestoreDone.current = false;
      listenersAttached.current = false;
      unsubscribers.current.forEach(unsub => unsub());
      unsubscribers.current = [];
      Object.values(uploadTimers.current).forEach(clearTimeout);
      uploadTimers.current = {};
      setSyncStatus('idle');
      return;
    }

    const goOnline = () => {
      setSyncStatus(initialRestoreDone.current ? 'synced' : 'syncing');
      // Process any queued offline operations
      if (getQueueSize() > 0) {
        processOfflineQueue({
          notes: async () => { const n = await loadNotesFromDB(); await syncNotesToFirebase(uid, n); },
          tasks: async () => { const t = await loadTasksFromDB(); await syncTasksToFirebase(uid, t); },
          folders: async () => { const f = await getSetting<Folder[]>('todoFolders', []); await syncFoldersToFirebase(uid, f); },
          tags: async () => { const t = await getAllTags(); await syncTagsToFirebase(uid, t); },
          habits: async () => { const h = await loadHabits(); await syncHabitsToFirebase(uid, h); },
          settings: async () => { const s = await collectSyncedSettings(); await syncAppSettingsToFirebase(uid, s); },
          journey: async () => { const j = loadJourneyData(); await syncVirtualJourneyToFirebase(uid, j); },
        }).then(({ processed, failed }) => {
          showQueueProcessedNotification(processed, failed);
        });
      }
    };
    const goOffline = () => setSyncStatus('offline');
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    if (!navigator.onLine) {
      setSyncStatus('offline');
    } else {
      performInitialRestore(uid).then(() => {
        attachListeners(uid);
      });
    }

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      unsubscribers.current.forEach(unsub => unsub());
      unsubscribers.current = [];
      listenersAttached.current = false;
      Object.values(uploadTimers.current).forEach(clearTimeout);
      uploadTimers.current = {};
    };
  }, [uid, performInitialRestore, attachListeners]);
}
