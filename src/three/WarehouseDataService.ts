import { apiFetch } from '../lib/api';
import type { SceneSearchResult, Warehouse3DSceneResponse } from '../types/wms';

/**
 * Module 10: WarehouseDataService
 * Fetches real PostgreSQL warehouse structure, locations, active inventory,
 * reservations, and layout objects via authenticated API endpoints.
 * Never returns mock data on failure.
 */
export class WarehouseDataService {
  static async fetchScene(options: { zoneId?: number; doorId?: number } = {}): Promise<Warehouse3DSceneResponse> {
    const params = new URLSearchParams();
    if (options.zoneId) params.set('zoneId', String(options.zoneId));
    if (options.doorId) params.set('doorId', String(options.doorId));
    const qs = params.toString();
    return apiFetch<Warehouse3DSceneResponse>(`/api/warehouse/3d-scene${qs ? `?${qs}` : ''}`);
  }

  static async search(query: string): Promise<SceneSearchResult> {
    const params = new URLSearchParams({ q: query.trim() });
    return apiFetch<SceneSearchResult>(`/api/warehouse/3d-search?${params.toString()}`);
  }
}
