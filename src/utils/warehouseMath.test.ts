import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSlotCoordinates,
  formatLocationCode,
  parseLocationCode,
  validateCoilCapacityFit,
  validateLocationModificationSafety,
} from './warehouseMath';

test('formatLocationCode builds canonical Door/Row/Level/Slot code', () => {
  assert.equal(formatLocationCode('e7', 1, 3, 9), 'E7/1/3/9');
  assert.equal(formatLocationCode(' E7 ', 2, 4, 1), 'E7/2/4/1');
  assert.throws(() => formatLocationCode('', 1, 1, 1));
  assert.throws(() => formatLocationCode('E7', 0, 1, 1));
  assert.throws(() => formatLocationCode('E7', 1, 1, -2));
});

test('parseLocationCode extracts hierarchy or rejects malformed codes', () => {
  assert.deepEqual(parseLocationCode('E7/1/3/9'), {
    doorCode: 'E7',
    rowNumber: 1,
    levelNumber: 3,
    slotNumber: 9,
  });
  assert.deepEqual(parseLocationCode(' e7/2/4/9 '), {
    doorCode: 'E7',
    rowNumber: 2,
    levelNumber: 4,
    slotNumber: 9,
  });
  assert.equal(parseLocationCode('E7-1-3-9'), null);
  assert.equal(parseLocationCode('E7/0/1/1'), null);
  assert.equal(parseLocationCode('E7/1/3'), null);
});

test('calculateSlotCoordinates computes Floor Saddle & Pyramid Stacking geometry', () => {
  const l1s1 = calculateSlotCoordinates({
    rowOriginX: 0,
    rowOriginZ: 4,
    slotSpacingM: 2.0,
    levelNumber: 1,
    slotNumber: 1,
    coilDiameterM: 1.6,
    stackingRule: 'FLOOR_SADDLE',
  });
  assert.deepEqual(l1s1, { posX: 0, posY: 0.18, posZ: 4 });

  const l2s1 = calculateSlotCoordinates({
    rowOriginX: 0,
    rowOriginZ: 4,
    slotSpacingM: 2.0,
    levelNumber: 2,
    slotNumber: 1,
    coilDiameterM: 1.6,
    stackingRule: 'PYRAMID_STACK',
  });
  // Level 2 nests half-slot over X (+1.0m) and rises 0.866 * 1.6 = 1.386m above saddle
  assert.equal(l2s1.posX, 1);
  assert.equal(l2s1.posZ, 4);
  assert.ok(Math.abs(l2s1.posY - (0.18 + 1.6 * 0.8660254)) < 0.002);
});

test('validateLocationModificationSafety protects occupied and reserved slots', () => {
  const occupiedDeactivate = validateLocationModificationSafety({
    currentStatus: 'OCCUPIED',
    hasActiveInventory: true,
    hasActiveReservation: false,
    requestedIsActive: false,
  });
  assert.equal(occupiedDeactivate.allowed, false);

  const manualOccupy = validateLocationModificationSafety({
    currentStatus: 'EMPTY',
    hasActiveInventory: false,
    hasActiveReservation: false,
    requestedStatus: 'OCCUPIED',
  });
  assert.equal(manualOccupy.allowed, false);

  const emptyBlock = validateLocationModificationSafety({
    currentStatus: 'EMPTY',
    hasActiveInventory: false,
    hasActiveReservation: false,
    requestedStatus: 'BLOCKED',
  });
  assert.equal(emptyBlock.allowed, true);
});

test('validateCoilCapacityFit enforces weight and dimensional safety rules', () => {
  const ok = validateCoilCapacityFit({
    coilWeightKg: 18500,
    coilOuterDiameterMm: 1650,
    coilWidthMm: 1250,
    locationMaxWeightKg: 25000,
    locationMaxOuterDiameterMm: 2000,
    locationMaxWidthMm: 1650,
    levelMaxWeightKg: 22000,
  });
  assert.equal(ok.valid, true);

  const overweight = validateCoilCapacityFit({
    coilWeightKg: 24000,
    coilOuterDiameterMm: 2100,
    coilWidthMm: 1250,
    locationMaxWeightKg: 25000,
    locationMaxOuterDiameterMm: 2000,
    locationMaxWidthMm: 1650,
    levelMaxWeightKg: 20000,
  });
  assert.equal(overweight.valid, false);
  assert.equal(overweight.errors.length, 2);
});
