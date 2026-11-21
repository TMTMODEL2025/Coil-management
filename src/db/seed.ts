import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  buildingDoors,
  excelColumnMappings,
  roles,
  storageLocations,
  warehouseLayoutObjects,
  warehouseLevels,
  warehouseRows,
  zones,
} from './schema.ts';
import { calculateSlotCoordinates, formatLocationCode } from '../utils/warehouseMath.ts';

let seedPromise: Promise<void> | null = null;
let seeded = false;

/**
 * Lazily ensures foundational master data (roles, Estimated Layout for Door E7 & E8,
 * and default SAP Excel mapping profile) exists in PostgreSQL.
 * Safe to invoke concurrently; executes at most once per server process lifecycle
 * and uses idempotent checks so existing production modifications are never overwritten.
 */
export async function ensureMasterSeedData(): Promise<void> {
  if (seeded) return;
  if (seedPromise) return seedPromise;

  seedPromise = runSeed()
    .then(() => {
      seeded = true;
    })
    .finally(() => {
      seedPromise = null;
    });

  return seedPromise;
}

async function runSeed(): Promise<void> {
  // 1. Seed RBAC Roles (idempotent upsert)
  const roleSeeds = [
    {
      code: 'ADMIN',
      name: 'ผู้ดูแลระบบ (Warehouse Admin)',
      description: 'Full access to warehouse layout, master data, RBAC, settings, and all WMS operations.',
      permissionsJson: ['*'],
    },
    {
      code: 'SUPERVISOR',
      name: 'หัวหน้าคลังสินค้า (Supervisor)',
      description: 'Manage SAP Excel import, outbound orders, transfers, location blocking, and reports.',
      permissionsJson: [
        'warehouse:read',
        'warehouse:manage_locations',
        'excel:import',
        'inbound:operate',
        'outbound:manage',
        'transfer:operate',
        'reports:read',
      ],
    },
    {
      code: 'OPERATOR',
      name: 'พนักงานคลังสินค้า (Floor Operator)',
      description: 'Execute mobile barcode scanning for Inbound putaway, Outbound picking, and Transfers.',
      permissionsJson: ['warehouse:read', 'inbound:operate', 'outbound:pick', 'transfer:operate'],
    },
    {
      code: 'VIEWER',
      name: 'ผู้ตรวจสอบข้อมูล (Viewer)',
      description: 'Read-only access to 3D Warehouse, inventory status, coil tracking, and reports.',
      permissionsJson: ['warehouse:read', 'reports:read'],
    },
  ];

  for (const r of roleSeeds) {
    await db.insert(roles).values(r).onConflictDoNothing({ target: roles.code });
  }

  // 2. Seed Default SAP Excel Column Mapping Profiles (reference only — zero inventory mutation)
  await db
    .insert(excelColumnMappings)
    .values({
      profileName: 'TMT SAP Steel Coil Export (Thai/EN)',
      description:
        'Default TMT factory SAP export template (หมายเลขคอยล์, Batch No., Material No., น้ำหนัก (Unrestr.), นน. ชั่งจริง, HEAT NO., text สภาพ) — preserves all leading zeros as TEXT.',
      sheetNameHint: 'Sheet1',
      headerRowIndex: 1,
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: '.',
      isActive: true,
      isDefault: true,
      mappingJson: {
        coil_id: 'หมายเลขคอยล์',
        batch_number: 'Batch No.',
        material_code: 'Material No.',
        material_description: 'Description',
        thickness: 'ความหนา',
        target_thickness: 'ความหนาเป้าหมาย',
        width: 'กว้าง',
        grade: 'Grade',
        vendor_code: 'ผู้ผลิต',
        skinpass: 'Skinpass',
        storage_location: 'Storage Location',
        net_weight: 'น้ำหนัก (Unrestr.)',
        gross_weight: 'นน. ชั่งจริง',
        reference_text: 'text สภาพ',
        heat_no: 'HEAT NO.',
        scanned_location_ref: 'ตำแหน่งที่สแกน',
      },
    })
    .onConflictDoNothing({ target: excelColumnMappings.profileName });

  await db
    .insert(excelColumnMappings)
    .values({
      profileName: 'SAP S/4HANA Standard Coil Export',
      description:
        'Standard English SAP S/4HANA Steel Coil reference export template (preserves leading zeros as TEXT).',
      sheetNameHint: 'Sheet1',
      headerRowIndex: 1,
      dateFormat: 'AUTO',
      decimalSeparator: '.',
      isActive: true,
      isDefault: false,
      mappingJson: {
        coil_id: 'Coil ID',
        batch_number: 'Batch',
        material_code: 'Material',
        material_description: 'Material Description',
        plant: 'Plant',
        storage_location: 'Storage Location',
        document_number: 'Material Document',
        document_item: 'Item',
        net_weight: 'Weight (KG)',
        thickness: 'Thickness (mm)',
        width: 'Width (mm)',
        outer_diameter: 'Outer Diameter (mm)',
        inner_diameter: 'Inner Diameter (mm)',
        posting_date: 'Posting Date',
        document_date: 'Document Date',
      },
    })
    .onConflictDoNothing({ target: excelColumnMappings.profileName });

  // 3. Check if any Zone already exists — if so, do NOT touch existing warehouse master layout
  const existingZones = await db.select({ id: zones.id }).from(zones).limit(1);
  if (existingZones.length > 0) {
    return;
  }

  // 4. Create initial Estimated Layout Zone (Floor Saddle & Pyramid Stacking + Overhead Crane)
  const [mainZone] = await db
    .insert(zones)
    .values({
      code: 'TMT-BAY-1',
      name: 'อาคารคลังเหล็กม้วนหลัก (Estimated Layout)',
      description:
        'โครงสร้างจัดเก็บแบบ Floor Saddle & Pyramid Stacking พร้อม Overhead Crane (สัดส่วนประมาณการ สามารถปรับแก้พิกัดจริงได้ในเมนู Location Management)',
      isEstimatedLayout: true,
      widthM: 64,
      depthM: 38,
      heightM: 14,
      isActive: true,
    })
    .returning();

  // 5. Create Building Doors E7 (South) and E8 (North) directly opposite along the cross-building road
  const [doorE7] = await db
    .insert(buildingDoors)
    .values({
      zoneId: mainZone.id,
      doorCode: 'E7',
      name: 'ประตูอาคาร E7 — โซนรับเข้าและจัดเก็บหลัก',
      description: 'Main coil receiving door aligned with South end of the cross-building road.',
      posX: -27.8,
      posY: 0,
      posZ: 15,
      facingDirection: 'SOUTH',
      sortOrder: 1,
      isActive: true,
    })
    .returning();

  const [doorE8] = await db
    .insert(buildingDoors)
    .values({
      zoneId: mainZone.id,
      doorCode: 'E8',
      name: 'ประตูอาคาร E8 — โซนจัดเก็บเสริมและจ่ายออก',
      description: 'Opposite coil building door aligned with North end of the cross-building road.',
      posX: -27.8,
      posY: 0,
      posZ: -15,
      facingDirection: 'NORTH',
      sortOrder: 2,
      isActive: true,
    })
    .returning();

  // 6. Create Rows, Levels (1–4 Pyramid Stacking), and Storage Locations under E7
  // Row 1..3 under E7: Level 1 (12 slots), Level 2 (11 slots), Level 3 (10 slots), Level 4 (9 slots)
  // This includes canonical codes like E7/1/1/1, E7/1/1/2, E7/1/2/1, E7/1/3/9, E7/2/1/1, E7/2/4/9
  const e7RowConfigs = [
    { rowNumber: 1, label: 'แถวที่ 1 (Row 1 — Heavy HR Floor Saddle)', posX: -24, posZ: -8, priority: 10 },
    { rowNumber: 2, label: 'แถวที่ 2 (Row 2 — Standard HR/CR)', posX: -24, posZ: -1.5, priority: 20 },
    { rowNumber: 3, label: 'แถวที่ 3 (Row 3 — Fast-Moving Staging)', posX: -24, posZ: 5.0, priority: 30 },
  ];

  const pyramidLevels = [
    { levelNumber: 1, label: 'ชั้น 1 (Floor Saddle)', maxSlots: 12, maxWeightKg: 28000, stackingRule: 'FLOOR_SADDLE' as const },
    { levelNumber: 2, label: 'ชั้น 2 (Pyramid Tier 2)', maxSlots: 11, maxWeightKg: 22000, stackingRule: 'PYRAMID_STACK' as const },
    { levelNumber: 3, label: 'ชั้น 3 (Pyramid Tier 3)', maxSlots: 10, maxWeightKg: 18000, stackingRule: 'PYRAMID_STACK' as const },
    { levelNumber: 4, label: 'ชั้น 4 (Pyramid Top)', maxSlots: 9, maxWeightKg: 14000, stackingRule: 'PYRAMID_STACK' as const },
  ];

  const locationInserts: Array<typeof storageLocations.$inferInsert> = [];

  for (const rc of e7RowConfigs) {
    const [row] = await db
      .insert(warehouseRows)
      .values({
        doorId: doorE7.id,
        rowNumber: rc.rowNumber,
        label: rc.label,
        allocationPriority: rc.priority,
        posX: rc.posX,
        posZ: rc.posZ,
        orientationDeg: 0,
        slotSpacingM: 2.1,
        maxLevels: 4,
        isActive: true,
      })
      .returning();

    for (const lc of pyramidLevels) {
      const sampleCoord = calculateSlotCoordinates({
        rowOriginX: rc.posX,
        rowOriginZ: rc.posZ,
        slotSpacingM: 2.1,
        levelNumber: lc.levelNumber,
        slotNumber: 1,
        coilDiameterM: 1.55,
        stackingRule: lc.stackingRule,
      });

      const [level] = await db
        .insert(warehouseLevels)
        .values({
          rowId: row.id,
          levelNumber: lc.levelNumber,
          label: lc.label,
          elevationY: sampleCoord.posY,
          maxWeightKg: lc.maxWeightKg,
          maxSlots: lc.maxSlots,
          stackingRule: lc.stackingRule,
          isActive: true,
        })
        .returning();

      for (let slot = 1; slot <= lc.maxSlots; slot++) {
        const coords = calculateSlotCoordinates({
          rowOriginX: rc.posX,
          rowOriginZ: rc.posZ,
          slotSpacingM: 2.1,
          levelNumber: lc.levelNumber,
          slotNumber: slot,
          coilDiameterM: 1.55,
          stackingRule: lc.stackingRule,
        });

        locationInserts.push({
          doorId: doorE7.id,
          rowId: row.id,
          levelId: level.id,
          slotNumber: slot,
          locationCode: formatLocationCode('E7', rc.rowNumber, lc.levelNumber, slot),
          posX: coords.posX,
          posY: coords.posY,
          posZ: coords.posZ,
          widthM: 1.85,
          heightM: 1.55,
          depthM: 1.85,
          maxWeightKg: lc.maxWeightKg,
          maxOuterDiameterMm: 2000,
          maxWidthMm: 1650,
          stackingGroup: lc.levelNumber === 1 ? 'HEAVY_BASE' : 'PYRAMID_UPPER',
          allocationPriority: rc.priority * 10 + lc.levelNumber * 10 + slot,
          status: 'EMPTY',
          isActive: true,
          isEstimatedCoord: true,
        });
      }
    }
  }

  // 7. Create 1 Row with 2 Levels (different slot counts: 8 & 7) under Door E8
  const [e8Row1] = await db
    .insert(warehouseRows)
    .values({
      doorId: doorE8.id,
      rowNumber: 1,
      label: 'แถวที่ 1 (Row 1 — Dispatch Staging Saddle)',
      allocationPriority: 50,
      posX: 8,
      posZ: -5,
      orientationDeg: 0,
      slotSpacingM: 2.2,
      maxLevels: 2,
      isActive: true,
    })
    .returning();

  const e8Levels = [
    { levelNumber: 1, label: 'ชั้น 1 (Floor Saddle)', maxSlots: 8, maxWeightKg: 26000, stackingRule: 'FLOOR_SADDLE' as const },
    { levelNumber: 2, label: 'ชั้น 2 (Pyramid Tier 2)', maxSlots: 7, maxWeightKg: 20000, stackingRule: 'PYRAMID_STACK' as const },
  ];

  for (const lc of e8Levels) {
    const sampleCoord = calculateSlotCoordinates({
      rowOriginX: 8,
      rowOriginZ: -5,
      slotSpacingM: 2.2,
      levelNumber: lc.levelNumber,
      slotNumber: 1,
      coilDiameterM: 1.55,
      stackingRule: lc.stackingRule,
    });

    const [level] = await db
      .insert(warehouseLevels)
      .values({
        rowId: e8Row1.id,
        levelNumber: lc.levelNumber,
        label: lc.label,
        elevationY: sampleCoord.posY,
        maxWeightKg: lc.maxWeightKg,
        maxSlots: lc.maxSlots,
        stackingRule: lc.stackingRule,
        isActive: true,
      })
      .returning();

    for (let slot = 1; slot <= lc.maxSlots; slot++) {
      const coords = calculateSlotCoordinates({
        rowOriginX: 8,
        rowOriginZ: -5,
        slotSpacingM: 2.2,
        levelNumber: lc.levelNumber,
        slotNumber: slot,
        coilDiameterM: 1.55,
        stackingRule: lc.stackingRule,
      });

      locationInserts.push({
        doorId: doorE8.id,
        rowId: e8Row1.id,
        levelId: level.id,
        slotNumber: slot,
        locationCode: formatLocationCode('E8', 1, lc.levelNumber, slot),
        posX: coords.posX,
        posY: coords.posY,
        posZ: coords.posZ,
        widthM: 1.9,
        heightM: 1.55,
        depthM: 1.9,
        maxWeightKg: lc.maxWeightKg,
        maxOuterDiameterMm: 2000,
        maxWidthMm: 1650,
        stackingGroup: lc.levelNumber === 1 ? 'HEAVY_BASE' : 'PYRAMID_UPPER',
        allocationPriority: 500 + lc.levelNumber * 10 + slot,
        status: 'EMPTY',
        isActive: true,
        isEstimatedCoord: true,
      });
    }
  }

  // Batch insert locations in chunks of 50
  for (let i = 0; i < locationInserts.length; i += 50) {
    await db
      .insert(storageLocations)
      .values(locationInserts.slice(i, i + 50))
      .onConflictDoNothing({ target: storageLocations.locationCode });
  }

  // 8. Seed Warehouse 3D Architectural & Functional Layout Objects
  const layoutObjectSeeds: Array<typeof warehouseLayoutObjects.$inferInsert> = [
    {
      zoneId: mainZone.id,
      doorId: doorE7.id,
      objectCode: 'OBJ-RCV-E7',
      name: 'Receiving Area — จุดรับเหล็กม้วนเข้าประตู E7',
      objectType: 'RECEIVING_AREA',
      posX: -14,
      posY: 0.02,
      posZ: 12,
      widthM: 14,
      heightM: 0.08,
      depthM: 6,
      colorHex: '#0EA5E9',
      metadataJson: { capacityTrucks: 2, notes: 'Disabled to maximize coil storage floor' },
      isActive: false,
      isEstimated: true,
    },
    {
      zoneId: mainZone.id,
      doorId: doorE8.id,
      objectCode: 'OBJ-DSP-E8',
      name: 'Dispatch Area — จุดจ่ายเหล็กม้วนประตู E8',
      objectType: 'DISPATCH_AREA',
      posX: 16,
      posY: 0.02,
      posZ: 12,
      widthM: 14,
      heightM: 0.08,
      depthM: 6,
      colorHex: '#6366F1',
      metadataJson: { capacityTrucks: 2, notes: 'Disabled to maximize coil storage floor' },
      isActive: false,
      isEstimated: true,
    },
    {
      zoneId: mainZone.id,
      doorId: null,
      objectCode: 'OBJ-AISLE-CROSS-W',
      name: 'Cross-Building Road — ถนนแนวขวางอาคาร (ฝั่งตะวันตก)',
      objectType: 'AISLE',
      posX: -27.8,
      posY: 0.02,
      posZ: 0,
      widthM: 37.4,
      heightM: 0.04,
      depthM: 4.6,
      rotationYDeg: 90,
      colorHex: '#F59E0B',
      metadataJson: {
        laneWidthM: 4.6,
        orientation: 'CROSS_BUILDING_NS',
        hazardStriped: true,
      },
      isActive: true,
      isEstimated: false,
    },
    {
      zoneId: mainZone.id,
      doorId: null,
      objectCode: 'OBJ-CRANE-RUNWAY-N',
      name: 'Overhead Crane Runway — North Girder',
      objectType: 'CRANE_RUNWAY',
      posX: 0,
      posY: 10.5,
      posZ: -15,
      widthM: 60,
      heightM: 1.0,
      depthM: 0.9,
      colorHex: '#EAB308',
      metadataJson: { ratedCapacityTon: 30 },
      isEstimated: true,
    },
    {
      zoneId: mainZone.id,
      doorId: null,
      objectCode: 'OBJ-CRANE-RUNWAY-S',
      name: 'Overhead Crane Runway — South Girder',
      objectType: 'CRANE_RUNWAY',
      posX: 0,
      posY: 10.5,
      posZ: 15,
      widthM: 60,
      heightM: 1.0,
      depthM: 0.9,
      colorHex: '#EAB308',
      metadataJson: { ratedCapacityTon: 30 },
      isEstimated: true,
    },
    {
      zoneId: mainZone.id,
      doorId: doorE7.id,
      objectCode: 'OBJ-CRANE-BRIDGE-1',
      name: 'Overhead Bridge Crane #1 (30T C-Hook)',
      objectType: 'CRANE_BRIDGE',
      posX: -12,
      posY: 11.2,
      posZ: 0,
      widthM: 2.2,
      heightM: 1.1,
      depthM: 30.8,
      colorHex: '#F59E0B',
      metadataJson: { hoistType: 'C-Hook Coil Lifter', capacityKg: 30000 },
      isEstimated: true,
    },
    {
      zoneId: mainZone.id,
      doorId: doorE7.id,
      objectCode: 'OBJ-DOOR-E7',
      name: 'Building Gate E7 (South — Cross-Building Road)',
      objectType: 'DOOR_GATE',
      posX: -27.8,
      posY: 3.5,
      posZ: 18.5,
      widthM: 5.2,
      heightM: 7.0,
      depthM: 0.6,
      rotationYDeg: 0,
      colorHex: '#1D4ED8',
      metadataJson: { doorCode: 'E7', alignedRoad: 'OBJ-AISLE-CROSS-W' },
      isEstimated: false,
    },
    {
      zoneId: mainZone.id,
      doorId: doorE8.id,
      objectCode: 'OBJ-DOOR-E8',
      name: 'Building Gate E8 (North — Opposite Cross-Building Road)',
      objectType: 'DOOR_GATE',
      posX: -27.8,
      posY: 3.5,
      posZ: -18.5,
      widthM: 5.2,
      heightM: 7.0,
      depthM: 0.6,
      rotationYDeg: 180,
      colorHex: '#1D4ED8',
      metadataJson: { doorCode: 'E8', alignedRoad: 'OBJ-AISLE-CROSS-W' },
      isEstimated: false,
    },
    {
      zoneId: mainZone.id,
      doorId: null,
      objectCode: 'OBJ-BLOCKED-SAFETY',
      name: 'Safety Inspection & Coil Strapping Hold Zone',
      objectType: 'BLOCKED_AREA',
      posX: 25,
      posY: 0.02,
      posZ: -12,
      widthM: 6,
      heightM: 0.1,
      depthM: 6,
      colorHex: '#DC2626',
      metadataJson: { reason: 'Disabled to maximize coil storage floor' },
      isActive: false,
      isEstimated: true,
    },
  ];

  for (const obj of layoutObjectSeeds) {
    await db
      .insert(warehouseLayoutObjects)
      .values(obj)
      .onConflictDoNothing({ target: warehouseLayoutObjects.objectCode });
  }
}

export async function getRoleByCode(code: string) {
  const [role] = await db.select().from(roles).where(eq(roles.code, code)).limit(1);
  return role ?? null;
}
