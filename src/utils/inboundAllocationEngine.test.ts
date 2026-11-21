import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateLocationsForCoils,
  analyzeCoilMissingData,
  buildSlotSupportKey,
  checkPyramidStackingSupport,
  computeBatchSummaryStatus,
  evaluateRowSlotsForCoil,
  normalizeScannedIdentifier,
  resolveEffectiveCoilWeightKg,
  validatePhysicalPlacementScan,
  type CoilReferenceForAllocation,
  type LocationCandidateForAllocation,
  type OccupiedSlotSupportInfo,
} from './inboundAllocationEngine.ts';

function makeLocation(overrides: Partial<LocationCandidateForAllocation> = {}): LocationCandidateForAllocation {
  return {
    id: 1,
    locationCode: 'E7/1/1/1',
    doorId: 1,
    doorCode: 'E7',
    doorSortOrder: 1,
    rowId: 1,
    rowNumber: 1,
    rowMaxLevels: 4,
    rowAllocationPriority: 100,
    levelId: 1,
    levelNumber: 1,
    levelMaxWeightKg: 28000,
    stackingRule: 'FLOOR_SADDLE',
    slotNumber: 1,
    maxWeightKg: 28000,
    maxOuterDiameterMm: 2000,
    maxWidthMm: 1650,
    stackingGroup: 'STANDARD_HR',
    allocationPriority: 100,
    status: 'EMPTY',
    isActive: true,
    hasActiveInventory: false,
    hasActiveReservation: false,
    ...overrides,
  };
}

function makeCoil(overrides: Partial<CoilReferenceForAllocation> = {}): CoilReferenceForAllocation {
  return {
    coilDbId: 10,
    coilId: 'HB02189481',
    batchNo: '011P066118',
    materialCode: '1HC10000-0003F',
    materialDescription: 'เหล็กม้วนดำ A36 หนาxกว้างใดๆxC -Flat',
    thicknessMm: 20,
    widthMm: 1524,
    outerDiameterMm: 1550,
    grade: 'SS400/A36',
    weightKg: 24755,
    grossWeightKg: 24755,
    netWeightKg: 24740,
    lifecycleStatus: 'PENDING_INBOUND',
    ...overrides,
  };
}

test('normalizeScannedIdentifier strictly preserves leading zeros', () => {
  assert.equal(normalizeScannedIdentifier('  011P066118  '), '011P066118');
  assert.equal(normalizeScannedIdentifier('000012345'), '000012345');
});

test('resolveEffectiveCoilWeightKg uses conservative max positive weight and returns null when missing', () => {
  assert.equal(
    resolveEffectiveCoilWeightKg({ grossWeightKg: 24755, netWeightKg: 24740, weightKg: 24740 }),
    24755
  );
  assert.equal(
    resolveEffectiveCoilWeightKg({ grossWeightKg: null, netWeightKg: 18280, weightKg: null }),
    18280
  );
  assert.equal(
    resolveEffectiveCoilWeightKg({ grossWeightKg: null, netWeightKg: null, weightKg: 0 }),
    null
  );
});

test('analyzeCoilMissingData flags missing fields honestly without fabricating values', () => {
  const incomplete = analyzeCoilMissingData({
    materialCode: '',
    materialDescription: null,
    thicknessMm: null,
    widthMm: 1200,
    grade: null,
    weightKg: null,
    grossWeightKg: null,
    netWeightKg: null,
  });

  assert.equal(incomplete.effectiveWeightKg, null);
  assert.equal(incomplete.canAutoAllocate, false);
  assert.equal(incomplete.hasMissingData, true);
  assert.deepEqual(incomplete.criticalMissingFields, ['weight']);
  assert.ok(incomplete.missingFields.includes('thicknessMm'));
  assert.ok(incomplete.missingFields.includes('grade'));
  assert.ok(incomplete.missingFields.includes('materialCode'));
});

test('computeBatchSummaryStatus accurately distinguishes READY, RESERVED, PARTIAL, and COMPLETED', () => {
  const ready = computeBatchSummaryStatus([
    { isReceived: false, hasActiveReservation: false, hasMissingData: false, effectiveWeightKg: 20000 },
    { isReceived: false, hasActiveReservation: false, hasMissingData: true, effectiveWeightKg: null },
  ]);
  assert.equal(ready.batchStatus, 'READY_TO_RECEIVE');
  assert.equal(ready.missingDataCoils, 1);
  assert.equal(ready.totalWeightKg, 20000);

  const reserved = computeBatchSummaryStatus([
    { isReceived: false, hasActiveReservation: true, hasMissingData: false, effectiveWeightKg: 20000 },
    { isReceived: false, hasActiveReservation: false, hasMissingData: false, effectiveWeightKg: 15000 },
  ]);
  assert.equal(reserved.batchStatus, 'RESERVED_IN_PROGRESS');

  const partial = computeBatchSummaryStatus([
    { isReceived: true, hasActiveReservation: false, hasMissingData: false, effectiveWeightKg: 20000 },
    { isReceived: false, hasActiveReservation: false, hasMissingData: false, effectiveWeightKg: 15000 },
  ]);
  assert.equal(partial.batchStatus, 'PARTIALLY_RECEIVED');
  assert.equal(partial.receivedCoils, 1);
  assert.equal(partial.pendingCoils, 1);

  const completed = computeBatchSummaryStatus([
    { isReceived: true, hasActiveReservation: false, hasMissingData: false, effectiveWeightKg: 20000 },
    { isReceived: true, hasActiveReservation: false, hasMissingData: false, effectiveWeightKg: 15000 },
  ]);
  assert.equal(completed.batchStatus, 'COMPLETED');
  assert.equal(completed.totalWeightKg, 35000);
});

test('checkPyramidStackingSupport requires both lower coils occupied and heavier or equal', () => {
  const occupied = new Map<string, OccupiedSlotSupportInfo>();
  occupied.set(buildSlotSupportKey(1, 1, 1), {
    rowId: 1,
    levelNumber: 1,
    slotNumber: 1,
    locationCode: 'E7/1/1/1',
    coilWeightKg: 24000,
  });

  // Missing right lower coil -> REJECT
  const missingRight = checkPyramidStackingSupport({
    rowId: 1,
    rowMaxLevels: 4,
    levelNumber: 2,
    slotNumber: 1,
    stackingRule: 'PYRAMID_STACK',
    coilWeightKg: 18000,
    occupiedByKey: occupied,
  });
  assert.equal(missingRight.valid, false);

  // Add right lower coil lighter than upper coil -> REJECT (weight stability)
  occupied.set(buildSlotSupportKey(1, 1, 2), {
    rowId: 1,
    levelNumber: 1,
    slotNumber: 2,
    locationCode: 'E7/1/1/2',
    coilWeightKg: 15000,
  });

  const tooHeavyUpper = checkPyramidStackingSupport({
    rowId: 1,
    rowMaxLevels: 4,
    levelNumber: 2,
    slotNumber: 1,
    stackingRule: 'PYRAMID_STACK',
    coilWeightKg: 18000,
    occupiedByKey: occupied,
  });
  assert.equal(tooHeavyUpper.valid, false);

  // Lighter upper coil on two heavier base coils -> ALLOW
  const safeUpper = checkPyramidStackingSupport({
    rowId: 1,
    rowMaxLevels: 4,
    levelNumber: 2,
    slotNumber: 1,
    stackingRule: 'PYRAMID_STACK',
    coilWeightKg: 14500,
    occupiedByKey: occupied,
  });
  assert.equal(safeUpper.valid, true);
});

test('allocateLocationsForCoils assigns unique slots, prioritizes floor saddles, and blocks missing-weight or overweight coils', () => {
  const locs: LocationCandidateForAllocation[] = [
    makeLocation({ id: 1, locationCode: 'E7/1/1/1', slotNumber: 1, maxWeightKg: 28000, levelMaxWeightKg: 28000 }),
    makeLocation({ id: 2, locationCode: 'E7/1/1/2', slotNumber: 2, maxWeightKg: 20000, levelMaxWeightKg: 28000 }),
    makeLocation({
      id: 3,
      locationCode: 'E7/1/2/1',
      levelId: 2,
      levelNumber: 2,
      slotNumber: 1,
      stackingRule: 'PYRAMID_STACK',
      maxWeightKg: 20000,
      levelMaxWeightKg: 20000,
    }),
    makeLocation({ id: 4, locationCode: 'E7/1/1/3', slotNumber: 3, status: 'BLOCKED' }),
  ];

  const batchCoils: CoilReferenceForAllocation[] = [
    makeCoil({ coilDbId: 1, coilId: '001-HEAVY', grossWeightKg: 25000, netWeightKg: 24900, weightKg: 25000 }),
    makeCoil({ coilDbId: 2, coilId: '002-LIGHT', grossWeightKg: 15000, netWeightKg: 14950, weightKg: 15000 }),
    makeCoil({
      coilDbId: 3,
      coilId: '003-MISSING',
      grossWeightKg: null,
      netWeightKg: null,
      weightKg: null,
    }),
    makeCoil({ coilDbId: 4, coilId: '004-OVERWEIGHT', grossWeightKg: 35000, netWeightKg: 35000, weightKg: 35000 }),
  ];

  const results = allocateLocationsForCoils(batchCoils, locs, []);
  assert.equal(results.length, 4);
  assert.equal(results[0].status, 'RECOMMENDED');
  assert.equal(results[0].recommendedLocation?.locationCode, 'E7/1/1/1');
  assert.equal(results[1].status, 'RECOMMENDED');
  assert.equal(results[1].recommendedLocation?.locationCode, 'E7/1/1/2');
  assert.equal(results[2].status, 'UNALLOCATABLE');
  assert.equal(results[2].recommendedLocation, null);
  assert.equal(results[3].status, 'UNALLOCATABLE');
  assert.equal(results[3].recommendedLocation, null);
});

test('validatePhysicalPlacementScan enforces batch match, reservation TTL, ownership, and authorized override', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  const future = new Date('2026-11-21T10:30:00Z');
  const past = new Date('2026-11-21T09:50:00Z');

  const baseCoil = {
    id: 10,
    coilId: 'HB02189481',
    batchNo: '011P066118',
    lifecycleStatus: 'PENDING_INBOUND',
    effectiveWeightKg: 24755,
    widthMm: 1524,
    outerDiameterMm: 1550,
    hasActiveInventory: false,
  };

  const baseLoc = {
    id: 100,
    locationCode: 'E7/1/1/1',
    rowId: 1,
    rowMaxLevels: 4,
    levelNumber: 1,
    slotNumber: 1,
    stackingRule: 'FLOOR_SADDLE' as const,
    maxWeightKg: 28000,
    levelMaxWeightKg: 28000,
    maxOuterDiameterMm: 2000,
    maxWidthMm: 1650,
    status: 'RESERVED' as const,
    isActive: true,
    hasActiveInventory: false,
  };

  // Valid exact scan
  const ok = validatePhysicalPlacementScan({
    batchNo: '011P066118',
    actorUserId: 5,
    actorRoleCode: 'OPERATOR',
    now,
    coil: baseCoil,
    targetLocation: baseLoc,
    coilActiveReservation: {
      id: 77,
      locationId: 100,
      locationCode: 'E7/1/1/1',
      reservedByUserId: 5,
      expiresAt: future,
      status: 'ACTIVE',
    },
    coilHadExpiredReservation: false,
    locationActiveReservation: {
      id: 77,
      coilId: 10,
      reservedByUserId: 5,
      expiresAt: future,
      status: 'ACTIVE',
    },
    occupiedByKey: new Map(),
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.overrideApplied, false);

  // Coil not in batch -> REJECT
  const wrongBatch = validatePhysicalPlacementScan({
    batchNo: '999OTHER',
    actorUserId: 5,
    actorRoleCode: 'OPERATOR',
    now,
    coil: baseCoil,
    targetLocation: baseLoc,
    coilActiveReservation: null,
    coilHadExpiredReservation: false,
    locationActiveReservation: null,
    occupiedByKey: new Map(),
  });
  assert.equal(wrongBatch.valid, false);
  assert.equal(wrongBatch.errorCode, 'COIL_NOT_IN_BATCH');

  // Expired reservation -> REJECT
  const expired = validatePhysicalPlacementScan({
    batchNo: '011P066118',
    actorUserId: 5,
    actorRoleCode: 'OPERATOR',
    now,
    coil: baseCoil,
    targetLocation: { ...baseLoc, status: 'EMPTY' },
    coilActiveReservation: {
      id: 77,
      locationId: 100,
      locationCode: 'E7/1/1/1',
      reservedByUserId: 5,
      expiresAt: past,
      status: 'ACTIVE',
    },
    coilHadExpiredReservation: true,
    locationActiveReservation: null,
    occupiedByKey: new Map(),
  });
  assert.equal(expired.valid, false);
  assert.equal(expired.errorCode, 'RESERVATION_EXPIRED');

  // Wrong location for OPERATOR -> REJECT
  const operatorMismatch = validatePhysicalPlacementScan({
    batchNo: '011P066118',
    actorUserId: 5,
    actorRoleCode: 'OPERATOR',
    now,
    overrideReason: 'Operator tried override',
    coil: baseCoil,
    targetLocation: { ...baseLoc, id: 101, locationCode: 'E7/1/1/2', status: 'EMPTY' },
    coilActiveReservation: {
      id: 77,
      locationId: 100,
      locationCode: 'E7/1/1/1',
      reservedByUserId: 5,
      expiresAt: future,
      status: 'ACTIVE',
    },
    coilHadExpiredReservation: false,
    locationActiveReservation: null,
    occupiedByKey: new Map(),
  });
  assert.equal(operatorMismatch.valid, false);
  assert.equal(operatorMismatch.errorCode, 'LOCATION_MISMATCH');

  // Wrong location for SUPERVISOR with reason -> ALLOW with overrideApplied=true
  const supervisorOverride = validatePhysicalPlacementScan({
    batchNo: '011P066118',
    actorUserId: 2,
    actorRoleCode: 'SUPERVISOR',
    now,
    overrideReason: 'Crane blocked aisle 1, relocated to slot 2',
    coil: baseCoil,
    targetLocation: { ...baseLoc, id: 101, locationCode: 'E7/1/1/2', status: 'EMPTY' },
    coilActiveReservation: {
      id: 77,
      locationId: 100,
      locationCode: 'E7/1/1/1',
      reservedByUserId: 5,
      expiresAt: future,
      status: 'ACTIVE',
    },
    coilHadExpiredReservation: false,
    locationActiveReservation: null,
    occupiedByKey: new Map(),
  });
  assert.equal(supervisorOverride.valid, true);
  assert.equal(supervisorOverride.overrideApplied, true);
});

test('evaluateRowSlotsForCoil accurately lists placeable slots, top recommendation, and pyramid/capacity rejections', () => {
  const rowLocs: LocationCandidateForAllocation[] = [
    makeLocation({ id: 1, locationCode: 'E7/1/1/1', levelNumber: 1, slotNumber: 1, status: 'OCCUPIED', hasActiveInventory: true }),
    makeLocation({ id: 2, locationCode: 'E7/1/1/2', levelNumber: 1, slotNumber: 2, status: 'OCCUPIED', hasActiveInventory: true }),
    makeLocation({ id: 3, locationCode: 'E7/1/1/3', levelNumber: 1, slotNumber: 3, status: 'EMPTY', maxWeightKg: 28000 }),
    makeLocation({ id: 4, locationCode: 'E7/1/1/4', levelNumber: 1, slotNumber: 4, status: 'RESERVED', hasActiveReservation: true }),
    makeLocation({ id: 5, locationCode: 'E7/1/1/5', levelNumber: 1, slotNumber: 5, status: 'EMPTY', maxWeightKg: 10000 }),
    makeLocation({
      id: 6,
      locationCode: 'E7/1/2/1',
      levelId: 2,
      levelNumber: 2,
      slotNumber: 1,
      stackingRule: 'PYRAMID_STACK',
      status: 'EMPTY',
      maxWeightKg: 20000,
      levelMaxWeightKg: 20000,
    }),
    makeLocation({
      id: 7,
      locationCode: 'E7/1/2/2',
      levelId: 2,
      levelNumber: 2,
      slotNumber: 2,
      stackingRule: 'PYRAMID_STACK',
      status: 'EMPTY',
      maxWeightKg: 20000,
      levelMaxWeightKg: 20000,
    }),
  ];

  const occupiedSupport: OccupiedSlotSupportInfo[] = [
    { rowId: 1, levelNumber: 1, slotNumber: 1, locationCode: 'E7/1/1/1', coilWeightKg: 22000 },
    { rowId: 1, levelNumber: 1, slotNumber: 2, locationCode: 'E7/1/1/2', coilWeightKg: 21000 },
  ];

  const coil = makeCoil({
    coilDbId: 99,
    coilId: '001-PYRAMID-OK',
    grossWeightKg: 15000,
    netWeightKg: 15000,
    weightKg: 15000,
  });

  const evals = evaluateRowSlotsForCoil(coil, rowLocs, occupiedSupport);
  const byCode = new Map(evals.map((e) => [e.locationCode, e]));

  assert.equal(byCode.get('E7/1/1/1')?.placeable, false);
  assert.equal(byCode.get('E7/1/1/3')?.placeable, true);
  assert.equal(byCode.get('E7/1/1/3')?.isTopRecommended, true); // Floor Saddle preferred #1
  assert.equal(byCode.get('E7/1/1/4')?.placeable, false); // RESERVED
  assert.equal(byCode.get('E7/1/1/5')?.placeable, false); // 15t > 10t maxWeightKg
  assert.equal(byCode.get('E7/1/2/1')?.placeable, true); // Supported by occupied 22t + 21t
  assert.equal(byCode.get('E7/1/2/1')?.isTopRecommended, false);
  assert.equal(byCode.get('E7/1/2/2')?.placeable, false); // Slot 3 below is EMPTY

  // Coil with missing weight -> 0 placeable slots
  const missingWeightCoil = makeCoil({ grossWeightKg: null, netWeightKg: null, weightKg: null });
  const missingEvals = evaluateRowSlotsForCoil(missingWeightCoil, rowLocs, occupiedSupport);
  assert.equal(missingEvals.filter((e) => e.placeable).length, 0);
});

test('Pre-SAP mode (coil === null) allows Floor Saddle and physically-supported Level 2+ slots with pendingSapWeightWarning', () => {
  const occupied = new Map<string, OccupiedSlotSupportInfo>([
    [
      buildSlotSupportKey(1, 1, 1),
      { rowId: 1, levelNumber: 1, slotNumber: 1, locationCode: 'E7/1/1/1', coilWeightKg: 24000 },
    ],
    [
      buildSlotSupportKey(1, 1, 2),
      { rowId: 1, levelNumber: 1, slotNumber: 2, locationCode: 'E7/1/1/2', coilWeightKg: 0 }, // Pre-SAP base coil
    ],
  ]);

  // Pre-SAP upper coil on 2 physically occupied base slots -> ALLOW with pendingSapWeightWarning
  const preSapUpper = checkPyramidStackingSupport({
    rowId: 1,
    rowMaxLevels: 4,
    levelNumber: 2,
    slotNumber: 1,
    stackingRule: 'PYRAMID_STACK',
    coilWeightKg: null,
    occupiedByKey: occupied,
  });
  assert.equal(preSapUpper.valid, true);
  assert.equal(preSapUpper.pendingSapWeightWarning, true);

  // Missing one lower support -> REJECT even in Pre-SAP mode
  const preSapUnsupported = checkPyramidStackingSupport({
    rowId: 1,
    rowMaxLevels: 4,
    levelNumber: 2,
    slotNumber: 2,
    stackingRule: 'PYRAMID_STACK',
    coilWeightKg: null,
    occupiedByKey: occupied,
  });
  assert.equal(preSapUnsupported.valid, false);

  const rowLocs: LocationCandidateForAllocation[] = [
    makeLocation({ id: 1, locationCode: 'E7/1/1/1', levelNumber: 1, slotNumber: 1, status: 'OCCUPIED', hasActiveInventory: true }),
    makeLocation({ id: 2, locationCode: 'E7/1/1/2', levelNumber: 1, slotNumber: 2, status: 'OCCUPIED', hasActiveInventory: true }),
    makeLocation({ id: 3, locationCode: 'E7/1/1/3', levelNumber: 1, slotNumber: 3, status: 'EMPTY', maxWeightKg: 28000 }),
    makeLocation({
      id: 4,
      locationCode: 'E7/1/2/1',
      levelId: 2,
      levelNumber: 2,
      slotNumber: 1,
      stackingRule: 'PYRAMID_STACK',
      status: 'EMPTY',
      maxWeightKg: 20000,
      levelMaxWeightKg: 20000,
    }),
    makeLocation({
      id: 5,
      locationCode: 'E7/1/2/2',
      levelId: 2,
      levelNumber: 2,
      slotNumber: 2,
      stackingRule: 'PYRAMID_STACK',
      status: 'EMPTY',
      maxWeightKg: 20000,
      levelMaxWeightKg: 20000,
    }),
  ];

  const evals = evaluateRowSlotsForCoil(null, rowLocs, Array.from(occupied.values()));
  const byCode = new Map(evals.map((e) => [e.locationCode, e]));

  assert.equal(byCode.get('E7/1/1/3')?.placeable, true);
  assert.equal(byCode.get('E7/1/1/3')?.isTopRecommended, true);
  assert.equal(byCode.get('E7/1/1/3')?.pendingSapWeightWarning, false);

  assert.equal(byCode.get('E7/1/2/1')?.placeable, true);
  assert.equal(byCode.get('E7/1/2/1')?.pendingSapWeightWarning, true);

  assert.equal(byCode.get('E7/1/2/2')?.placeable, false);
});


