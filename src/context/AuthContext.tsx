import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { apiFetch, resolveApiUrl } from '../lib/api';
import type {
  WarehouseRealtimeEvent,
  WarehouseRealtimeEventName,
  WmsUserProfile,
} from '../types/wms';

const REALTIME_EVENT_TYPES: readonly WarehouseRealtimeEventName[] = [
  'location:updated',
  'location:reserved',
  'location:released',
  'inbound:confirmed',
  'outbound:confirmed',
  'transfer:confirmed',
  'layout:updated',
  'SAP_IMPORT_UPLOADED',
  'SAP_IMPORT_VALIDATION_STARTED',
  'SAP_IMPORT_VALIDATION_COMPLETED',
  'SAP_IMPORT_STARTED',
  'SAP_IMPORT_PROGRESS',
  'SAP_IMPORT_COMPLETED',
  'SAP_IMPORT_FAILED',
];

interface AuthContextValue {
  firebaseUser: User | null;
  profile: WmsUserProfile | null;
  loading: boolean;
  authError: string | null;
  realtimeConnected: boolean;
  lastSyncedAt: string | null;
  realtimeRevision: number;
  lastRealtimeEvent: WarehouseRealtimeEvent | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  triggerManualSync: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<WmsUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [realtimeRevision, setRealtimeRevision] = useState(0);
  const [lastRealtimeEvent, setLastRealtimeEvent] = useState<WarehouseRealtimeEvent | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const lastEventSeqRef = useRef<number>(0);
  const hadConnectedOnceRef = useRef<boolean>(false);

  const loadProfile = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: WmsUserProfile }>('/api/me');
      setProfile(data.user);
      setAuthError(null);
      setLastSyncedAt(new Date().toISOString());
    } catch (err) {
      console.error('Failed to sync WMS profile:', err);
      setProfile(null);
      setAuthError(
        err instanceof Error
          ? err.message
          : 'ไม่สามารถเชื่อมต่อข้อมูลผู้ใช้งานจากฐานข้อมูลได้'
      );
    }
  }, []);

  const connectRealtime = useCallback(async () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (!auth.currentUser) return;

    try {
      const { ticket } = await apiFetch<{ ticket: string }>('/api/realtime/ticket', {
        method: 'POST',
      });
      const es = new EventSource(
        resolveApiUrl(`/api/realtime/events?ticket=${encodeURIComponent(ticket)}`)
      );
      eventSourceRef.current = es;

      es.addEventListener('connected', (evt) => {
        setRealtimeConnected(true);
        setLastSyncedAt(new Date().toISOString());
        try {
          const parsed = JSON.parse((evt as MessageEvent).data) as { currentSeq?: number };
          const serverSeq = typeof parsed.currentSeq === 'number' ? parsed.currentSeq : 0;
          // Reconcile state with DB after a reconnect or missed events
          if (hadConnectedOnceRef.current && serverSeq !== lastEventSeqRef.current) {
            setRealtimeRevision((v) => v + 1);
          }
          if (serverSeq > lastEventSeqRef.current) {
            lastEventSeqRef.current = serverSeq;
          }
        } catch {
          if (hadConnectedOnceRef.current) {
            setRealtimeRevision((v) => v + 1);
          }
        }
        hadConnectedOnceRef.current = true;
      });

      es.addEventListener('heartbeat', () => {
        setRealtimeConnected(true);
      });

      for (const eventName of REALTIME_EVENT_TYPES) {
        es.addEventListener(eventName, (evt) => {
          try {
            const parsed = JSON.parse((evt as MessageEvent).data) as WarehouseRealtimeEvent;
            if (typeof parsed.seq === 'number' && parsed.seq <= lastEventSeqRef.current) {
              return; // Deduplicate / guard out-of-order events
            }
            if (typeof parsed.seq === 'number') {
              lastEventSeqRef.current = parsed.seq;
            }
            setLastRealtimeEvent(parsed);
          } catch {
            // Fallback: still trigger full reconciliation
          }
          setLastSyncedAt(new Date().toISOString());
          setRealtimeRevision((v) => v + 1);
        });
      }

      es.onerror = () => {
        setRealtimeConnected(false);
        es.close();
        eventSourceRef.current = null;
        if (reconnectTimerRef.current) {
          window.clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = window.setTimeout(() => {
          if (auth.currentUser) {
            void connectRealtime();
          }
        }, 5000);
      };
    } catch {
      setRealtimeConnected(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await loadProfile();
        await connectRealtime();
      } else {
        setProfile(null);
        setRealtimeConnected(false);
        hadConnectedOnceRef.current = false;
        lastEventSeqRef.current = 0;
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [loadProfile, connectRealtime]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
      if (code === 'auth/unauthorized-domain') {
        setAuthError(
          `โดเมน ${window.location.hostname} ยังไม่ได้รับอนุญาตใน Firebase Authentication (กรุณาเพิ่มโดเมนนี้ใน Firebase Console → Authentication → Settings → Authorized domains)`
        );
      } else {
        const msg =
          err instanceof Error
            ? err.message
            : 'การเข้าสู่ระบบด้วย Google ถูกยกเลิกหรือไม่สำเร็จ';
        setAuthError(msg);
      }
    }
  }, []);

  const logout = useCallback(async () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setRealtimeConnected(false);
    await signOut(auth);
  }, []);

  const triggerManualSync = useCallback(() => {
    setLastSyncedAt(new Date().toISOString());
    setRealtimeRevision((v) => v + 1);
    if (!realtimeConnected && auth.currentUser) {
      void connectRealtime();
    }
  }, [realtimeConnected, connectRealtime]);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        loading,
        authError,
        realtimeConnected,
        lastSyncedAt,
        realtimeRevision,
        lastRealtimeEvent,
        signInWithGoogle,
        logout,
        refreshProfile: loadProfile,
        triggerManualSync,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}

