import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { createServer as createViteServer } from 'vite';
import { requireAuth, requireRole, type AuthRequest } from './src/middleware/auth.ts';
import {
  batchGenerateLocations,
  createBuildingDoor,
  createLayoutObject,
  createStorageLocation,
  createWarehouseLevel,
  createWarehouseRow,
  expandRowSlots,
  getWarehouse3DScene,
  getWarehouseSummary,
  listLayoutObjects,
  listStorageLocations,
  listUsersAndRoles,
  listWarehouseHierarchy,
  searchWarehouse3D,
  updateBuildingDoor,
  updateLayoutObject,
  updateStorageLocation,
  updateUserAccess,
} from './src/db/warehouse.ts';
import {
  cancelImportBatch,
  confirmImportBatch,
  createMappingTemplate,
  createUploadBatch,
  deleteMappingTemplate,
  exportBatchErrorReport,
  getBatchErrors,
  getBatchPreview,
  getBatchSummaryById,
  getMaxImportFileBytes,
  getSapImportDashboard,
  inspectBatchWorksheet,
  listMappingTemplates,
  listSapReferenceCoils,
  selectBatchWorksheet,
  updateMappingTemplate,
  validateImportBatch,
} from './src/db/sapImport.ts';
import { SAP_TARGET_FIELDS } from './src/utils/sapImportEngine.ts';
import {
  confirmPhysicalPlacement,
  directPlaceCoilInSlot,
  getPlaceableSlotsForRow,
  listInboundHistory,
  listPendingSapBatches,
  recommendLocationsForBatch,
  releaseReservation,
  reserveBatchLocations,
  scanBatchReference,
} from './src/db/inbound.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// ============================================================================
// REALTIME SSE DISPATCHER (Post-Commit Broadcast Hub)
// ============================================================================
interface SseClient {
  id: string;
  res: Response;
  userId: number;
}

const sseClients = new Map<string, SseClient>();
const realtimeTickets = new Map<string, { userId: number; expiresAt: number }>();
let realtimeEventSeq = 0;

type RealtimeEventName =
  | 'location:updated'
  | 'location:reserved'
  | 'location:released'
  | 'inbound:confirmed'
  | 'outbound:confirmed'
  | 'transfer:confirmed'
  | 'layout:updated'
  | 'SAP_IMPORT_UPLOADED'
  | 'SAP_IMPORT_VALIDATION_STARTED'
  | 'SAP_IMPORT_VALIDATION_COMPLETED'
  | 'SAP_IMPORT_STARTED'
  | 'SAP_IMPORT_PROGRESS'
  | 'SAP_IMPORT_COMPLETED'
  | 'SAP_IMPORT_FAILED';

function broadcastRealtimeEvent(eventType: RealtimeEventName, payload: Record<string, unknown>) {
  const seq = ++realtimeEventSeq;
  const data = JSON.stringify({
    seq,
    type: eventType,
    payload,
    timestamp: new Date().toISOString(),
  });
  for (const [id, client] of sseClients.entries()) {
    try {
      client.res.write(`id: ${seq}\nevent: ${eventType}\ndata: ${data}\n\n`);
    } catch {
      sseClients.delete(id);
    }
  }
}

function getActor(req: AuthRequest) {
  return {
    userId: req.dbUser!.id,
    email: req.dbUser!.email,
    ip: req.ip || null,
  };
}

function getInboundActor(req: AuthRequest) {
  return {
    userId: req.dbUser!.id,
    email: req.dbUser!.email,
    roleCode: req.dbUser!.roleCode,
    ip: req.ip || null,
  };
}

// ============================================================================
// ZOD VALIDATION SCHEMAS
// ============================================================================
const createDoorSchema = z.object({
  zoneId: z.number().int().positive(),
  doorCode: z.string().trim().min(1).max(12),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(400).optional(),
  posX: z.number().finite(),
  posY: z.number().finite(),
  posZ: z.number().finite(),
  facingDirection: z.enum(['NORTH', 'SOUTH', 'EAST', 'WEST']).default('SOUTH'),
  sortOrder: z.number().int().min(1).max(999).optional(),
});

const updateDoorSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(400).nullable().optional(),
  posX: z.number().finite().optional(),
  posY: z.number().finite().optional(),
  posZ: z.number().finite().optional(),
  facingDirection: z.enum(['NORTH', 'SOUTH', 'EAST', 'WEST']).optional(),
  sortOrder: z.number().int().min(1).max(999).optional(),
  isActive: z.boolean().optional(),
});

const createRowSchema = z.object({
  doorId: z.number().int().positive(),
  rowNumber: z.number().int().positive(),
  label: z.string().trim().min(1).max(120),
  allocationPriority: z.number().int().min(1).max(10000).default(100),
  posX: z.number().finite(),
  posZ: z.number().finite(),
  orientationDeg: z.number().finite().optional(),
  slotSpacingM: z.number().positive().max(15),
  maxLevels: z.number().int().min(1).max(10).default(4),
});

const createLevelSchema = z.object({
  rowId: z.number().int().positive(),
  levelNumber: z.number().int().min(1).max(10),
  label: z.string().trim().min(1).max(120),
  elevationY: z.number().finite().optional(),
  maxWeightKg: z.number().positive().max(100000),
  maxSlots: z.number().int().min(1).max(100),
  stackingRule: z.enum(['FLOOR_SADDLE', 'PYRAMID_STACK', 'RACK_BAY']),
});

const createLocationSchema = z.object({
  levelId: z.number().int().positive(),
  slotNumber: z.number().int().positive().max(500),
  posX: z.number().finite().optional(),
  posY: z.number().finite().optional(),
  posZ: z.number().finite().optional(),
  widthM: z.number().positive().max(10).optional(),
  heightM: z.number().positive().max(10).optional(),
  depthM: z.number().positive().max(10).optional(),
  maxWeightKg: z.number().positive().max(100000).optional(),
  maxOuterDiameterMm: z.number().positive().max(5000).optional(),
  maxWidthMm: z.number().positive().max(5000).optional(),
  stackingGroup: z.string().trim().min(1).max(40).optional(),
  allocationPriority: z.number().int().min(1).max(100000).optional(),
  isEstimatedCoord: z.boolean().optional(),
  notes: z.string().max(400).optional(),
});

const updateLocationSchema = z.object({
  posX: z.number().finite().optional(),
  posY: z.number().finite().optional(),
  posZ: z.number().finite().optional(),
  widthM: z.number().positive().max(10).optional(),
  heightM: z.number().positive().max(10).optional(),
  depthM: z.number().positive().max(10).optional(),
  maxWeightKg: z.number().positive().max(100000).optional(),
  maxOuterDiameterMm: z.number().positive().max(5000).optional(),
  maxWidthMm: z.number().positive().max(5000).optional(),
  stackingGroup: z.string().trim().min(1).max(40).optional(),
  allocationPriority: z.number().int().min(1).max(100000).optional(),
  status: z.enum(['EMPTY', 'OCCUPIED', 'RESERVED', 'BLOCKED']).optional(),
  isActive: z.boolean().optional(),
  isEstimatedCoord: z.boolean().optional(),
  notes: z.string().max(400).nullable().optional(),
});

const batchGenerateSchema = z
  .object({
    levelId: z.number().int().positive(),
    startSlot: z.number().int().positive().max(500),
    endSlot: z.number().int().positive().max(500),
    maxWeightKg: z.number().positive().max(100000).optional(),
    widthM: z.number().positive().max(10).optional(),
    heightM: z.number().positive().max(10).optional(),
    depthM: z.number().positive().max(10).optional(),
    stackingGroup: z.string().trim().min(1).max(40).optional(),
    isEstimatedCoord: z.boolean().optional(),
  })
  .refine((v) => v.endSlot >= v.startSlot && v.endSlot - v.startSlot <= 100, {
    message: 'Slot range must be valid and at most 100 slots per batch.',
  });

const expandRowSlotsSchema = z
  .object({
    targetBaseSlots: z.number().int().min(1).max(100).optional(),
    addSlots: z.number().int().min(1).max(60).optional(),
    syncUpperPyramidLevels: z.boolean().optional(),
  })
  .refine((v) => v.targetBaseSlots !== undefined || v.addSlots !== undefined, {
    message: 'กรุณาระบุจำนวนช่องที่ต้องการเพิ่มหรือจำนวนช่องชั้น 1 เป้าหมาย',
  });

const createLayoutObjectSchema = z.object({
  zoneId: z.number().int().positive(),
  doorId: z.number().int().positive().nullable().optional(),
  objectCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(140),
  objectType: z.enum([
    'RECEIVING_AREA',
    'DISPATCH_AREA',
    'CRANE_RUNWAY',
    'CRANE_BRIDGE',
    'AISLE',
    'BLOCKED_AREA',
    'BUILDING_SHELL',
    'DOOR_GATE',
    'NAVIGATION_WAYPOINT',
  ]),
  posX: z.number().finite(),
  posY: z.number().finite(),
  posZ: z.number().finite(),
  widthM: z.number().positive().max(200),
  heightM: z.number().positive().max(50),
  depthM: z.number().positive().max(200),
  rotationYDeg: z.number().finite().optional(),
  colorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  isEstimated: z.boolean().optional(),
});

const updateLayoutObjectSchema = z.object({
  name: z.string().trim().min(1).max(140).optional(),
  posX: z.number().finite().optional(),
  posY: z.number().finite().optional(),
  posZ: z.number().finite().optional(),
  widthM: z.number().positive().max(200).optional(),
  heightM: z.number().positive().max(50).optional(),
  depthM: z.number().positive().max(200).optional(),
  rotationYDeg: z.number().finite().optional(),
  colorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  isEstimated: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const updateUserAccessSchema = z.object({
  roleId: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

// Phase 4: SAP Excel Import Validation Schemas
const sapWorksheetSelectSchema = z.object({
  sheetName: z.string().trim().min(1).max(120),
  headerRowIndex: z.number().int().min(1).max(100),
});

const sapValidateBatchSchema = z.object({
  mapping: z.record(z.string(), z.string().max(160)),
  mappingId: z.number().int().positive().nullable().optional(),
  dateFormat: z.enum(['AUTO', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).default('AUTO'),
  decimalSeparator: z.enum(['.', ',']).default('.'),
});

const sapConfirmBatchSchema = z.object({
  importMode: z.enum(['STRICT', 'PARTIAL']).default('STRICT'),
  idempotencyKey: z.string().trim().min(8).max(128),
});

const sapCreateMappingSchema = z.object({
  profileName: z.string().trim().min(2).max(120),
  description: z.string().max(400).nullable().optional(),
  sheetNameHint: z.string().max(120).nullable().optional(),
  headerRowIndex: z.number().int().min(1).max(100).default(1),
  mappingJson: z.record(z.string(), z.string().max(160)),
  dateFormat: z.enum(['AUTO', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).default('AUTO'),
  decimalSeparator: z.enum(['.', ',']).default('.'),
  leadingZeroRulesJson: z.record(z.string(), z.number().int().min(1).max(30)).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const sapUpdateMappingSchema = sapCreateMappingSchema.partial();

// Phase 5: Batch-First Inbound Receiving Validation Schemas
const inboundRecommendSchema = z.object({
  batchNo: z.string().trim().min(1).max(120),
  coilDbIds: z.array(z.number().int().positive()).max(500).optional(),
  preferredDoorId: z.number().int().positive().optional(),
  preferredRowId: z.number().int().positive().optional(),
  strictDoorFilter: z.boolean().optional(),
  strictRowFilter: z.boolean().optional(),
});

const inboundReserveSchema = z.object({
  batchNo: z.string().trim().min(1).max(120),
  allocations: z
    .array(
      z.object({
        coilDbId: z.number().int().positive(),
        locationId: z.number().int().positive(),
      })
    )
    .min(1)
    .max(200),
  ttlMinutes: z.number().int().min(5).max(120).optional(),
});

const inboundConfirmPlacementSchema = z.object({
  batchNo: z.string().trim().min(1).max(120),
  scannedCoilId: z.string().trim().min(1).max(120),
  scannedLocationCode: z.string().trim().min(3).max(60),
  idempotencyKey: z.string().trim().min(8).max(128),
  overrideReason: z.string().trim().max(400).optional(),
});

const inboundDirectPlaceSchema = z.object({
  batchNo: z.string().trim().min(1).max(120),
  locationId: z.number().int().positive(),
  coilDbId: z.number().int().positive().nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
});

// Per-user sliding window upload rate limiter (max 25 uploads per 10 minutes)
const uploadRateWindow = new Map<number, number[]>();
function checkUploadRateLimit(userId: number): boolean {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const recent = (uploadRateWindow.get(userId) ?? []).filter((ts) => now - ts < windowMs);
  if (recent.length >= 25) {
    uploadRateWindow.set(userId, recent);
    return false;
  }
  recent.push(now);
  uploadRateWindow.set(userId, recent);
  return true;
}

function sendSanitizedSapError(res: Response, error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : fallback;
  if (raw.startsWith('NOT_FOUND:')) {
    res.status(404).json({ error: raw.replace('NOT_FOUND:', '').trim() });
    return;
  }
  if (raw.startsWith('CONFLICT:')) {
    res.status(409).json({ error: raw.replace('CONFLICT:', '').trim() });
    return;
  }
  if (raw.startsWith('VALIDATION:')) {
    res.status(400).json({ error: raw.replace('VALIDATION:', '').trim() });
    return;
  }
  if (raw.startsWith('FORBIDDEN:')) {
    res.status(403).json({ error: raw.replace('FORBIDDEN:', '').trim() });
    return;
  }
  if (raw.startsWith('SECURITY:')) {
    res.status(403).json({ error: 'คำขอไม่ผ่านการตรวจสอบความปลอดภัย' });
    return;
  }
  console.error('[WMS API Error]:', raw);
  res.status(400).json({ error: fallback });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Public health check (no database exposure)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'tmt-steel-coil-wms', timestamp: new Date().toISOString() });
  });

  // Authenticated User Profile & RBAC Identity
  app.get('/api/me', requireAuth, (req: AuthRequest, res) => {
    res.json({ user: req.dbUser });
  });

  // Short-lived SSE ticket (allows EventSource authentication without storing tokens in localStorage)
  app.post('/api/realtime/ticket', requireAuth, (req: AuthRequest, res) => {
    const ticket = crypto.randomBytes(24).toString('hex');
    realtimeTickets.set(ticket, {
      userId: req.dbUser!.id,
      expiresAt: Date.now() + 30_000,
    });
    res.json({ ticket, expiresInSec: 30 });
  });

  app.get('/api/realtime/events', (req, res) => {
    const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
    const record = realtimeTickets.get(ticket);
    if (!record || record.expiresAt < Date.now()) {
      realtimeTickets.delete(ticket);
      res.status(401).json({ error: 'Invalid or expired realtime stream ticket' });
      return;
    }
    realtimeTickets.delete(ticket);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const clientId = crypto.randomUUID();
    sseClients.set(clientId, { id: clientId, res, userId: record.userId });

    res.write(
      `event: connected\ndata: ${JSON.stringify({ clientId, currentSeq: realtimeEventSeq, timestamp: new Date().toISOString() })}\n\n`
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(clientId);
      }
    }, 20_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(clientId);
    });
  });

  // ==========================================================================
  // PHASE 1 & 2 API: WAREHOUSE SUMMARY, MASTER HIERARCHY & LOCATIONS
  // ==========================================================================
  app.get('/api/warehouse/summary', requireAuth, async (_req, res) => {
    try {
      const summary = await getWarehouseSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
    }
  });

  app.get('/api/warehouse/hierarchy', requireAuth, async (_req, res) => {
    try {
      const hierarchy = await listWarehouseHierarchy();
      res.json(hierarchy);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
    }
  });

  // ==========================================================================
  // PHASE 3 API: INTERACTIVE 3D WAREHOUSE SCENE & SEARCH (REAL POSTGRESQL)
  // ==========================================================================
  app.get('/api/warehouse/3d-scene', requireAuth, async (req, res) => {
    try {
      const zoneId = req.query.zoneId ? Number(req.query.zoneId) : undefined;
      const doorId = req.query.doorId ? Number(req.query.doorId) : undefined;
      if (zoneId !== undefined && (!Number.isInteger(zoneId) || zoneId <= 0)) {
        res.status(400).json({ error: 'Invalid zoneId parameter' });
        return;
      }
      if (doorId !== undefined && (!Number.isInteger(doorId) || doorId <= 0)) {
        res.status(400).json({ error: 'Invalid doorId parameter' });
        return;
      }
      const scene = await getWarehouse3DScene({ zoneId, doorId });
      res.json(scene);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
    }
  });

  app.get('/api/warehouse/3d-search', requireAuth, async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
      const result = await searchWarehouse3D(q);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
    }
  });

  app.post('/api/warehouse/doors', requireAuth, requireRole('ADMIN'), async (req: AuthRequest, res) => {
    const parsed = createDoorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid door payload' });
      return;
    }
    try {
      const door = await createBuildingDoor(parsed.data, getActor(req));
      broadcastRealtimeEvent('layout:updated', { entity: 'building_doors', id: door.id });
      res.status(201).json({ door });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create door' });
    }
  });

  app.patch('/api/warehouse/doors/:id', requireAuth, requireRole('ADMIN'), async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid door ID' });
      return;
    }
    const parsed = updateDoorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update payload' });
      return;
    }
    try {
      const door = await updateBuildingDoor(id, parsed.data, getActor(req));
      broadcastRealtimeEvent('layout:updated', { entity: 'building_doors', id: door.id });
      res.json({ door });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update door' });
    }
  });

  app.post('/api/warehouse/rows', requireAuth, requireRole('ADMIN'), async (req: AuthRequest, res) => {
    const parsed = createRowSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid row payload' });
      return;
    }
    try {
      const row = await createWarehouseRow(parsed.data, getActor(req));
      broadcastRealtimeEvent('layout:updated', { entity: 'warehouse_rows', id: row.id });
      res.status(201).json({ row });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create row' });
    }
  });

  app.post('/api/warehouse/levels', requireAuth, requireRole('ADMIN'), async (req: AuthRequest, res) => {
    const parsed = createLevelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid level payload' });
      return;
    }
    try {
      const level = await createWarehouseLevel(parsed.data, getActor(req));
      broadcastRealtimeEvent('layout:updated', { entity: 'warehouse_levels', id: level.id });
      res.status(201).json({ level });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create level' });
    }
  });

  app.get('/api/warehouse/locations', requireAuth, async (req, res) => {
    try {
      const doorId = req.query.doorId ? Number(req.query.doorId) : undefined;
      const rowId = req.query.rowId ? Number(req.query.rowId) : undefined;
      const levelId = req.query.levelId ? Number(req.query.levelId) : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const isActive =
        req.query.isActive === 'true'
          ? true
          : req.query.isActive === 'false'
            ? false
            : undefined;
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 50;

      const data = await listStorageLocations({
        doorId: doorId && Number.isInteger(doorId) ? doorId : undefined,
        rowId: rowId && Number.isInteger(rowId) ? rowId : undefined,
        levelId: levelId && Number.isInteger(levelId) ? levelId : undefined,
        status,
        isActive,
        search,
        page: Number.isInteger(page) ? page : 1,
        pageSize: Number.isInteger(pageSize) ? pageSize : 50,
      });
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
    }
  });

  app.post(
    '/api/warehouse/locations',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (req: AuthRequest, res) => {
      const parsed = createLocationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid location payload' });
        return;
      }
      try {
        const location = await createStorageLocation(parsed.data, getActor(req));
        broadcastRealtimeEvent('layout:updated', {
          entity: 'storage_locations',
          locationCode: location.locationCode,
        });
        res.status(201).json({ location });
      } catch (error) {
        res
          .status(400)
          .json({ error: error instanceof Error ? error.message : 'Failed to create location' });
      }
    }
  );

  app.post(
    '/api/warehouse/locations/batch-generate',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthRequest, res) => {
      const parsed = batchGenerateSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: parsed.error.issues[0]?.message || 'Invalid batch generator payload' });
        return;
      }
      try {
        const result = await batchGenerateLocations(parsed.data, getActor(req));
        broadcastRealtimeEvent('layout:updated', {
          entity: 'storage_locations',
          createdCount: result.createdCount,
        });
        res.status(201).json(result);
      } catch (error) {
        res
          .status(400)
          .json({ error: error instanceof Error ? error.message : 'Batch generation failed' });
      }
    }
  );

  app.post(
    '/api/warehouse/rows/:id/expand-slots',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (req: AuthRequest, res) => {
      const rowId = Number(req.params.id);
      if (!Number.isInteger(rowId) || rowId <= 0) {
        res.status(400).json({ error: 'Invalid row ID' });
        return;
      }
      const parsed = expandRowSlotsSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: parsed.error.issues[0]?.message || 'Invalid row expansion payload' });
        return;
      }
      try {
        const result = await expandRowSlots(
          {
            rowId,
            targetBaseSlots: parsed.data.targetBaseSlots,
            addSlots: parsed.data.addSlots,
            syncUpperPyramidLevels: parsed.data.syncUpperPyramidLevels,
          },
          getActor(req)
        );
        broadcastRealtimeEvent('layout:updated', {
          entity: 'storage_locations',
          action: 'ROW_SLOTS_EXPANDED',
          rowId: result.rowId,
          doorCode: result.doorCode,
          rowNumber: result.rowNumber,
          newBaseSlots: result.newBaseSlots,
          createdCount: result.createdCount,
        });
        res.status(201).json(result);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Row slot expansion failed';
        const statusCode = msg.startsWith('NOT_FOUND:') ? 404 : 400;
        res.status(statusCode).json({ error: msg.replace(/^(NOT_FOUND|VALIDATION):\s*/, '') });
      }
    }
  );

  app.patch(
    '/api/warehouse/locations/:id',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (req: AuthRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid location ID' });
        return;
      }
      const parsed = updateLocationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update payload' });
        return;
      }
      try {
        const location = await updateStorageLocation(id, parsed.data, getActor(req));
        broadcastRealtimeEvent('location:updated', {
          entity: 'storage_locations',
          locationId: location.id,
          locationCode: location.locationCode,
          status: location.status,
          isActive: location.isActive,
        });
        res.json({ location });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to update location';
        if (msg.startsWith('NOT_FOUND:')) {
          res.status(404).json({ error: msg.replace('NOT_FOUND:', '').trim() });
          return;
        }
        if (msg.startsWith('VALIDATION:')) {
          res.status(409).json({ error: msg.replace('VALIDATION:', '').trim() });
          return;
        }
        res.status(400).json({ error: msg });
      }
    }
  );

  // Layout Objects (3D Architectural & Operational Zones)
  app.get('/api/warehouse/layout-objects', requireAuth, async (_req, res) => {
    try {
      const objects = await listLayoutObjects();
      res.json({ objects });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
    }
  });

  app.post(
    '/api/warehouse/layout-objects',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthRequest, res) => {
      const parsed = createLayoutObjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid object payload' });
        return;
      }
      try {
        const object = await createLayoutObject(parsed.data, getActor(req));
        broadcastRealtimeEvent('layout:updated', {
          entity: 'warehouse_layout_objects',
          objectCode: object.objectCode,
        });
        res.status(201).json({ object });
      } catch (error) {
        res
          .status(400)
          .json({ error: error instanceof Error ? error.message : 'Failed to create object' });
      }
    }
  );

  app.patch(
    '/api/warehouse/layout-objects/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid layout object ID' });
        return;
      }
      const parsed = updateLayoutObjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update payload' });
        return;
      }
      try {
        const object = await updateLayoutObject(id, parsed.data, getActor(req));
        broadcastRealtimeEvent('layout:updated', {
          entity: 'warehouse_layout_objects',
          objectCode: object.objectCode,
        });
        res.json({ object });
      } catch (error) {
        res
          .status(400)
          .json({ error: error instanceof Error ? error.message : 'Failed to update object' });
      }
    }
  );

  // User RBAC Administration
  app.get('/api/admin/users', requireAuth, requireRole('ADMIN'), async (_req, res) => {
    try {
      const result = await listUsersAndRoles();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
    }
  });

  app.patch('/api/admin/users/:id', requireAuth, requireRole('ADMIN'), async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const parsed = updateUserAccessSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user payload' });
      return;
    }
    try {
      const updated = await updateUserAccess(id, parsed.data, getActor(req));
      res.json({ user: updated });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update user';
      if (msg.startsWith('VALIDATION:')) {
        res.status(400).json({ error: msg.replace('VALIDATION:', '').trim() });
        return;
      }
      res.status(400).json({ error: msg });
    }
  });

  // ==========================================================================
  // PHASE 4 API: SAP EXCEL IMPORT CENTER (MANUAL EXCEL ONLY — ZERO SAP API)
  // ==========================================================================
  const sapUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: getMaxImportFileBytes(),
      files: 1,
    },
  });

  app.get(
    '/api/sap-import/dashboard',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (req, res) => {
      try {
        const page = req.query.page ? Number(req.query.page) : 1;
        const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
        const data = await getSapImportDashboard({
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          importedBy: typeof req.query.importedBy === 'string' ? req.query.importedBy : undefined,
          dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
          dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
          page: Number.isInteger(page) ? page : 1,
          pageSize: Number.isInteger(pageSize) ? pageSize : 20,
        });
        res.json({ ...data, targetFields: SAP_TARGET_FIELDS });
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถโหลดข้อมูล SAP Import Dashboard ได้');
      }
    }
  );

  app.post(
    '/api/sap-import/upload',
    requireAuth,
    requireRole('ADMIN'),
    (req: AuthRequest, res, next) => {
      if (!checkUploadRateLimit(req.dbUser!.id)) {
        res.status(429).json({
          error: 'อัปโหลดไฟล์ถี่เกินกำหนด (Rate limit) กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
        });
        return;
      }
      sapUpload.single('file')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({
              error: `ขนาดไฟล์เกินขีดจำกัดสูงสุด (${Math.round(getMaxImportFileBytes() / (1024 * 1024))} MB)`,
            });
            return;
          }
          res.status(400).json({ error: 'ไม่สามารถรับไฟล์ที่อัปโหลดได้' });
          return;
        }
        if (err) {
          res.status(400).json({ error: 'เกิดข้อผิดพลาดระหว่างอัปโหลดไฟล์' });
          return;
        }
        next();
      });
    },
    async (req: AuthRequest, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'กรุณาเลือกไฟล์ Excel (.xlsx, .xls) หรือ .csv ที่ต้องการนำเข้า' });
        return;
      }
      try {
        // Multer decodes originalname as latin1 by default; preserve UTF-8 Thai filenames safely
        const decodedName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const originalName = /[\u0E00-\u0E7F]/.test(decodedName) ? decodedName : req.file.originalname;
        const result = await createUploadBatch(
          {
            buffer: req.file.buffer,
            originalName,
            mimeType: req.file.mimetype,
          },
          getActor(req),
          broadcastRealtimeEvent
        );
        res.status(201).json(result);
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถประมวลผลไฟล์ Excel ที่อัปโหลดได้');
      }
    }
  );

  app.get(
    '/api/sap-import/batches/:id',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid import batch ID' });
        return;
      }
      try {
        const batch = await getBatchSummaryById(id);
        res.json({ batch });
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถโหลดข้อมูล Import Batch ได้');
      }
    }
  );

  app.get(
    '/api/sap-import/batches/:id/inspect',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid import batch ID' });
        return;
      }
      try {
        const sheetName = typeof req.query.sheetName === 'string' ? req.query.sheetName : undefined;
        const headerRowIndex = req.query.headerRowIndex ? Number(req.query.headerRowIndex) : undefined;
        const mappingId = req.query.mappingId ? Number(req.query.mappingId) : undefined;
        const result = await inspectBatchWorksheet(id, {
          sheetName,
          headerRowIndex:
            headerRowIndex && Number.isInteger(headerRowIndex) ? headerRowIndex : undefined,
          mappingId: mappingId && Number.isInteger(mappingId) ? mappingId : undefined,
        });
        res.json(result);
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถตรวจสอบโครงสร้าง Worksheet ได้');
      }
    }
  );

  app.patch(
    '/api/sap-import/batches/:id/worksheet',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid import batch ID' });
        return;
      }
      const parsed = sapWorksheetSelectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid worksheet payload' });
        return;
      }
      try {
        const result = await selectBatchWorksheet(id, parsed.data, getActor(req));
        res.json(result);
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถบันทึกการเลือก Worksheet ได้');
      }
    }
  );

  app.post(
    '/api/sap-import/batches/:id/validate',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid import batch ID' });
        return;
      }
      const parsed = sapValidateBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid validation payload' });
        return;
      }
      try {
        const result = await validateImportBatch(
          id,
          parsed.data,
          getActor(req),
          broadcastRealtimeEvent
        );
        res.json(result);
      } catch (error) {
        sendSanitizedSapError(res, error, 'การตรวจสอบข้อมูล (Validation) ไม่สำเร็จ');
      }
    }
  );

  app.get(
    '/api/sap-import/batches/:id/preview',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid import batch ID' });
        return;
      }
      try {
        const page = req.query.page ? Number(req.query.page) : 1;
        const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 50;
        const data = await getBatchPreview(id, {
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          validationStatus:
            typeof req.query.validationStatus === 'string' ? req.query.validationStatus : undefined,
          duplicateType:
            typeof req.query.duplicateType === 'string' ? req.query.duplicateType : undefined,
          importResultStatus:
            typeof req.query.importResultStatus === 'string'
              ? req.query.importResultStatus
              : undefined,
          page: Number.isInteger(page) ? page : 1,
          pageSize: Number.isInteger(pageSize) ? pageSize : 50,
        });
        res.json(data);
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถโหลดข้อมูล Preview ได้');
      }
    }
  );

  app.get(
    '/api/sap-import/batches/:id/errors',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid import batch ID' });
        return;
      }
      try {
        const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
        const errors = await getBatchErrors(id, severity);
        res.json({ errors });
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถโหลดรายการข้อผิดพลาดได้');
      }
    }
  );

  app.get(
    '/api/sap-import/batches/:id/error-report',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (req: AuthRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid import batch ID' });
        return;
      }
      const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
      try {
        const report = await exportBatchErrorReport(id, format, getActor(req));
        res.setHeader('Content-Type', report.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
        res.send(report.buffer);
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถสร้างไฟล์ Error Report ได้');
      }
    }
  );

  app.post(
    '/api/sap-import/batches/:id/confirm',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid import batch ID' });
        return;
      }
      const parsed = sapConfirmBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid confirm payload' });
        return;
      }
      try {
        const result = await confirmImportBatch(
          id,
          parsed.data,
          getActor(req),
          broadcastRealtimeEvent
        );
        if (!result.idempotentReplay && result.reconciledCount > 0) {
          broadcastRealtimeEvent('location:updated', {
            reason: 'PRE_SAP_RECONCILED',
            reconciledCount: result.reconciledCount,
            batchCode: result.batch.batchCode,
          });
        }
        res.json(result);
      } catch (error) {
        sendSanitizedSapError(res, error, 'การยืนยันนำเข้าข้อมูลไม่สำเร็จ');
      }
    }
  );

  app.post(
    '/api/sap-import/batches/:id/cancel',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid import batch ID' });
        return;
      }
      try {
        const batch = await cancelImportBatch(id, getActor(req));
        res.json({ batch });
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถยกเลิก Import Batch ได้');
      }
    }
  );

  app.get(
    '/api/sap-import/mappings',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (_req, res) => {
      try {
        const mappings = await listMappingTemplates();
        res.json({ mappings, targetFields: SAP_TARGET_FIELDS });
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถโหลด Mapping Templates ได้');
      }
    }
  );

  app.post(
    '/api/sap-import/mappings',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthRequest, res) => {
      const parsed = sapCreateMappingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid mapping template' });
        return;
      }
      try {
        const mapping = await createMappingTemplate(parsed.data, getActor(req));
        res.status(201).json({ mapping });
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถสร้าง Mapping Template ได้ (ชื่ออาจซ้ำ)');
      }
    }
  );

  app.patch(
    '/api/sap-import/mappings/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid mapping template ID' });
        return;
      }
      const parsed = sapUpdateMappingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid mapping update' });
        return;
      }
      try {
        const mapping = await updateMappingTemplate(id, parsed.data, getActor(req));
        res.json({ mapping });
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถแก้ไข Mapping Template ได้');
      }
    }
  );

  app.delete(
    '/api/sap-import/mappings/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid mapping template ID' });
        return;
      }
      try {
        await deleteMappingTemplate(id, getActor(req));
        res.json({ deleted: true });
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถลบ Mapping Template ได้');
      }
    }
  );

  app.get(
    '/api/sap-import/reference-coils',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR'),
    async (req, res) => {
      try {
        const batchId = req.query.batchId ? Number(req.query.batchId) : undefined;
        const page = req.query.page ? Number(req.query.page) : 1;
        const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 50;
        const data = await listSapReferenceCoils({
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          batchId: batchId && Number.isInteger(batchId) ? batchId : undefined,
          lifecycleStatus:
            typeof req.query.lifecycleStatus === 'string' ? req.query.lifecycleStatus : undefined,
          page: Number.isInteger(page) ? page : 1,
          pageSize: Number.isInteger(pageSize) ? pageSize : 50,
        });
        res.json(data);
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถโหลดรายการ SAP Reference Coils ได้');
      }
    }
  );

  // ==========================================================================
  // PHASE 5 API: BATCH-FIRST INBOUND RECEIVING & AUTO LOCATION ALLOCATION
  // ==========================================================================
  app.get('/api/inbound/pending-batches', requireAuth, async (req, res) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 120) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 30;
      const batches = await listPendingSapBatches(
        search,
        Number.isInteger(limit) ? limit : 30
      );
      res.json({ batches });
    } catch (error) {
      sendSanitizedSapError(res, error, 'ไม่สามารถโหลดรายการ Batch ที่รอรับเข้าได้');
    }
  });

  app.get('/api/inbound/batches/:batchNo', requireAuth, async (req: AuthRequest, res) => {
    try {
      const batchNo = decodeURIComponent(String(req.params.batchNo ?? '')).slice(0, 120);
      const result = await scanBatchReference(batchNo, getInboundActor(req));
      res.json(result);
    } catch (error) {
      sendSanitizedSapError(res, error, 'ไม่สามารถค้นหาข้อมูล Batch จาก SAP Reference ได้');
    }
  });

  app.get('/api/inbound/row-slots', requireAuth, async (req, res) => {
    const rowId = Number(req.query.rowId);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      res.status(400).json({ error: 'กรุณาระบุรหัสแถว (rowId) ที่ถูกต้อง' });
      return;
    }
    const coilDbIdRaw = req.query.coilDbId !== undefined && req.query.coilDbId !== '' ? Number(req.query.coilDbId) : undefined;
    if (coilDbIdRaw !== undefined && (!Number.isInteger(coilDbIdRaw) || coilDbIdRaw <= 0)) {
      res.status(400).json({ error: 'รหัสคอยล์ (coilDbId) ไม่ถูกต้อง' });
      return;
    }
    try {
      const result = await getPlaceableSlotsForRow({
        rowId,
        coilDbId: coilDbIdRaw,
      });
      res.json(result);
    } catch (error) {
      sendSanitizedSapError(res, error, 'ไม่สามารถโหลดพื้นที่ที่สามารถวางได้ของแถวที่เลือกได้');
    }
  });

  app.post(
    '/api/inbound/recommend-locations',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR', 'OPERATOR'),
    async (req: AuthRequest, res) => {
      const parsed = inboundRecommendSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'ข้อมูลสำหรับคำนวณตำแหน่งแนะนำไม่ถูกต้อง',
        });
        return;
      }
      try {
        const result = await recommendLocationsForBatch(parsed.data, getInboundActor(req));
        res.json(result);
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถคำนวณตำแหน่งจัดเก็บแนะนำได้');
      }
    }
  );

  app.post(
    '/api/inbound/reserve',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR', 'OPERATOR'),
    async (req: AuthRequest, res) => {
      const parsed = inboundReserveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'ข้อมูลคำขอจองตำแหน่งไม่ถูกต้อง',
        });
        return;
      }
      try {
        const result = await reserveBatchLocations(
          parsed.data,
          getInboundActor(req),
          broadcastRealtimeEvent
        );
        res.status(201).json(result);
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถจองตำแหน่งจัดเก็บได้');
      }
    }
  );

  app.delete(
    '/api/inbound/reservations/:id',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR', 'OPERATOR'),
    async (req: AuthRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid reservation ID' });
        return;
      }
      try {
        const result = await releaseReservation(id, getInboundActor(req), broadcastRealtimeEvent);
        res.json(result);
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถยกเลิกการจองตำแหน่งได้');
      }
    }
  );

  app.post(
    '/api/inbound/confirm-placement',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR', 'OPERATOR'),
    async (req: AuthRequest, res) => {
      const parsed = inboundConfirmPlacementSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'ข้อมูลการสแกนยืนยันวางสินค้าไม่ถูกต้อง',
        });
        return;
      }
      try {
        const result = await confirmPhysicalPlacement(
          parsed.data,
          getInboundActor(req),
          broadcastRealtimeEvent
        );
        res.json(result);
      } catch (error) {
        sendSanitizedSapError(res, error, 'การยืนยันวางสินค้าเข้าคลังไม่สำเร็จ');
      }
    }
  );

  app.post(
    '/api/inbound/direct-place',
    requireAuth,
    requireRole('ADMIN', 'SUPERVISOR', 'OPERATOR'),
    async (req: AuthRequest, res) => {
      const parsed = inboundDirectPlaceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'ข้อมูลสำหรับวางสินค้าลงตำแหน่งไม่ถูกต้อง',
        });
        return;
      }
      try {
        const result = await directPlaceCoilInSlot(
          parsed.data,
          getInboundActor(req),
          broadcastRealtimeEvent
        );
        res.status(201).json(result);
      } catch (error) {
        sendSanitizedSapError(res, error, 'ไม่สามารถวางสินค้าลงคลัง 3D ได้');
      }
    }
  );

  app.get('/api/inbound/history', requireAuth, async (req, res) => {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
      const data = await listInboundHistory({
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        page: Number.isInteger(page) ? page : 1,
        pageSize: Number.isInteger(pageSize) ? pageSize : 20,
      });
      res.json(data);
    } catch (error) {
      sendSanitizedSapError(res, error, 'ไม่สามารถโหลดประวัติการรับสินค้าเข้าคลังได้');
    }
  });

  // Catch-all 404 for unknown API routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Vite middleware in dev / static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TMT Steel Coil WMS server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
