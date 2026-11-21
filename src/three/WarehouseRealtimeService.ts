import type { WarehouseRealtimeEvent } from '../types/wms';
import { shouldAcceptRealtimeSeq } from './warehouse3dLogic';

export type RealtimeSyncCallback = (reason: {
  source: 'event' | 'reconnect' | 'manual';
  event?: WarehouseRealtimeEvent | null;
}) => void;

/**
 * Module 11: WarehouseRealtimeService
 * Coordinates real-time synchronization for the 3D Warehouse scene:
 * - Deduplicates out-of-order SSE events by monotonic sequence ID
 * - Debounces burst updates into clean PostgreSQL reconciliations
 * - Triggers full scene re-sync on connection recovery after network loss
 */
export class WarehouseRealtimeService {
  private lastAcceptedSeq = 0;
  private wasDisconnected = false;
  private pendingTimer: number | null = null;
  private onSync: RealtimeSyncCallback;
  private debounceMs: number;

  constructor(onSync: RealtimeSyncCallback, debounceMs = 220) {
    this.onSync = onSync;
    this.debounceMs = debounceMs;
  }

  handleConnectionChange(isConnected: boolean): void {
    if (!isConnected) {
      this.wasDisconnected = true;
      return;
    }
    if (this.wasDisconnected) {
      this.wasDisconnected = false;
      this.scheduleSync('reconnect', null);
    }
  }

  handleRealtimeEvent(event: WarehouseRealtimeEvent | null): void {
    if (!event) return;
    if (!shouldAcceptRealtimeSeq(this.lastAcceptedSeq, event.seq)) {
      return;
    }
    this.lastAcceptedSeq = event.seq;
    this.scheduleSync('event', event);
  }

  requestManualSync(): void {
    this.scheduleSync('manual', null);
  }

  private scheduleSync(
    source: 'event' | 'reconnect' | 'manual',
    event: WarehouseRealtimeEvent | null
  ): void {
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = null;
      this.onSync({ source, event });
    }, this.debounceMs);
  }

  dispose(): void {
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }
}
