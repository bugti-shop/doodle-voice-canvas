import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { migrateLocalStorageToIndexedDB, getSetting } from "./utils/settingsStorage";
import { migrateNotesToIndexedDB } from "./utils/noteStorage";
import { initializeProtectionSettings } from "./utils/noteProtection";
import { configureStatusBar } from "./utils/statusBar";
import { initializeTaskOrder } from "./utils/taskOrderStorage";

// One-time cache clear
const CACHE_CLEAR_KEY = 'nota_cache_cleared_v3';
const CACHE_CLEAR_DONE_VALUE = 'true';

const hasCacheBeenCleared = (() => {
  try {
    return localStorage.getItem(CACHE_CLEAR_KEY) === CACHE_CLEAR_DONE_VALUE;
  } catch {
    return true;
  }
})();

if (!hasCacheBeenCleared) {
  // Write flag first so a crash/reload won't re-trigger the wipe.
  try { localStorage.setItem(CACHE_CLEAR_KEY, CACHE_CLEAR_DONE_VALUE); } catch {}

  const dbNames = [
    'nota-settings-db', 'nota-notes-db', 'nota-task-db', 'nota-task-media-db',
    'nota-media-db', 'nota-tags-db', 'nota-habits-db', 'nota-receipts-db'
  ];

  // Wait for all database deletions to complete before reloading
  const deletePromises = dbNames.map(name => new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve(); // resolve even on error
      req.onblocked = () => resolve(); // resolve even if blocked
      // Safety timeout in case callbacks never fire (Android WebView edge case)
      setTimeout(resolve, 2000);
    } catch {
      resolve();
    }
  }));

  // Preserve the clear-marker key only.
  try {
    Object.keys(localStorage).forEach((key) => {
      if (key !== CACHE_CLEAR_KEY) {
        try { localStorage.removeItem(key); } catch {}
      }
    });
  } catch {}

  Promise.all(deletePromises).then(() => {
    window.location.reload();
  }).catch(() => {
    window.location.reload();
  });
}

// No loading screen - render nothing during suspense for instant feel
const EmptyFallback = () => null;

// Schedule non-critical work after first paint
const scheduleDeferred = (fn: () => void) => {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(fn, { timeout: 3000 });
  } else {
    setTimeout(fn, 100);
  }
};

// Render immediately — no blocking initializations
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<EmptyFallback />}>
      <App />
    </Suspense>
  </React.StrictMode>
);

// Defer ALL non-critical initialization until after first paint
scheduleDeferred(async () => {
  try {
    const [
      { startBackgroundScheduler },
      { initializeReminders },
      { initializeStreakNotifications },
      { initializeSmartNotifications },
    ] = await Promise.all([
      import("./utils/backgroundScheduler"),
      import("./utils/reminderScheduler"),
      import("./utils/streakNotifications"),
      import("./utils/smartNotifications"),
    ]);

    // Run migrations in parallel
    await Promise.all([
      migrateLocalStorageToIndexedDB(),
      migrateNotesToIndexedDB(),
      initializeTaskOrder(),
      initializeProtectionSettings(),
    ]);

    // Start background scheduler
    startBackgroundScheduler();

    // Fire-and-forget notification initializations
    initializeReminders().catch(console.warn);
    initializeStreakNotifications().catch(console.warn);
    initializeSmartNotifications().catch(console.warn);
    

    // Configure status bar
    const theme = await getSetting<string>('theme', 'light');
    await configureStatusBar(theme !== 'light');
  } catch (error) {
    console.error('Deferred initialization error:', error);
  }
});
