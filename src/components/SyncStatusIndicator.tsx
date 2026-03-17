import { useState, useEffect } from 'react';
import { Cloud, CloudOff, Loader2, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGoogleAuth } from '@/contexts/GoogleAuthContext';

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

/** Compact dot indicator for headers — only shows when logged in */
export function SyncStatusDot({ className }: { className?: string }) {
  const { user } = useGoogleAuth();
  const [status, setStatus] = useState<SyncStatus>('idle');

  useEffect(() => {
    const handler = (e: CustomEvent<{ status: SyncStatus }>) => setStatus(e.detail.status);
    window.addEventListener('syncStatusChanged', handler as EventListener);
    return () => window.removeEventListener('syncStatusChanged', handler as EventListener);
  }, []);

  if (!user || status === 'idle') return null;

  const dotColor = {
    syncing: 'bg-primary animate-pulse',
    synced: 'bg-emerald-500',
    error: 'bg-destructive',
    offline: 'bg-muted-foreground',
  }[status];

  const title = {
    syncing: 'Syncing...',
    synced: 'Synced',
    error: 'Sync error',
    offline: 'Offline',
  }[status];

  return (
    <div className={cn('relative', className)} title={title}>
      <Cloud className="h-4 w-4 text-muted-foreground" />
      <span className={cn('absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-background', dotColor)} />
    </div>
  );
}

/** Full indicator with label — used on Profile page */
export function SyncStatusIndicator({ className }: { className?: string }) {
  const [status, setStatus] = useState<SyncStatus>('idle');

  useEffect(() => {
    const handler = (e: CustomEvent<{ status: SyncStatus }>) => setStatus(e.detail.status);
    window.addEventListener('syncStatusChanged', handler as EventListener);
    return () => window.removeEventListener('syncStatusChanged', handler as EventListener);
  }, []);

  if (status === 'idle') return null;

  const config = {
    syncing: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, label: 'Syncing...', color: 'text-primary' },
    synced: { icon: <Check className="h-3.5 w-3.5" />, label: 'Synced', color: 'text-emerald-500' },
    error: { icon: <AlertCircle className="h-3.5 w-3.5" />, label: 'Sync error', color: 'text-destructive' },
    offline: { icon: <CloudOff className="h-3.5 w-3.5" />, label: 'Offline', color: 'text-muted-foreground' },
  }[status] || { icon: <Cloud className="h-3.5 w-3.5" />, label: '', color: '' };

  return (
    <div className={cn('flex items-center gap-1.5 text-xs', config.color, className)}>
      {config.icon}
      <span>{config.label}</span>
    </div>
  );
}

/** Sync Now button for Profile */
export function SyncNowButton({ className }: { className?: string }) {
  const { user } = useGoogleAuth();
  const [status, setStatus] = useState<SyncStatus>('idle');

  useEffect(() => {
    const handler = (e: CustomEvent<{ status: SyncStatus }>) => setStatus(e.detail.status);
    window.addEventListener('syncStatusChanged', handler as EventListener);
    return () => window.removeEventListener('syncStatusChanged', handler as EventListener);
  }, []);

  if (!user) return null;

  const isSyncing = status === 'syncing';

  return (
    <button
      onClick={() => {
        if (!isSyncing) {
          window.dispatchEvent(new Event('triggerManualSync'));
        }
      }}
      disabled={isSyncing}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
        'bg-primary/10 text-primary hover:bg-primary/20 active:scale-95',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
    >
      <RefreshCw className={cn('h-4 w-4', isSyncing && 'animate-spin')} />
      {isSyncing ? 'Syncing...' : 'Sync Now'}
    </button>
  );
}
