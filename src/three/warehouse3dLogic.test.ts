import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocationInstanceBuffers,
  computeCameraPreset,
  computeEffectiveSceneBounds,
  computeLocationFocusPose,
  filterSceneLocations,
  getStatusVisualStyle,
  LOCATION_STATUS_STYLES,
  resolveCoilDimensionsMeters,
  resolveVisualStatus,
  shouldAcceptRealtimeSeq,
} from './warehouse3dLogic.ts';
import type { SceneLocationNode } from '../types/wms.ts';

describe('Phase 3 Warehouse 3D Pure Logic', () => {
  it('maps all 5 mandatory database & highlight statuses to exact hex colors', () => {
    assert.equal(LOCATION_STATUS_STYLES.EMPTY.hex, '#16A34A');
    assert.equal(LOCATION_STATUS_STYLES.OCCUPIED.hex, '#2563EB');
    assert.equal(LOCATION_STATUS_STYLES.RESERVED.hex, '#EA580C');
    assert.equal(LOCATION_STATUS_STYLES.BLOCKED.hex, '#DC2626');
    assert.equal(LOCATION_STATUS_STYLES.RECOMMENDED.hex, '#9333EA');

    assert.equal(resolveVisualStatus('EMPTY', false), 'EMPTY');
    assert.equal(resolveVisualStatus('EMPTY', true), 'RECOMMENDED');
    assert.equal(getStatusVisualStyle('RECOMMENDED').numericColor, 0x9333ea);
  });

  it('resolves coil physical dimensions from mm to meters and flags Estimated Model when null', () => {
    const exact = resolveCoilDimensionsMeters({
      outerDiameterMm: 1600,
      innerDiameterMm: 508,
      widthMm: 1200,
      renderOuterDiameterMm: 1600,
      renderInnerDiameterMm: 508,
      renderWidthMm: 1200,
      isEstimatedModel: false,
    });
    assert.equal(exact.outerRadiusM, 0.8);
    assert.equal(exact.innerRadiusM, 0.254);
    assert.equal(exact.widthM, 1.2);
    assert.equal(exact.isEstimatedModel, false);

    const estimated = resolveCoilDimensionsMeters({
      outerDiameterMm: null,
      innerDiameterMm: null,
      widthMm: null,
      renderOuterDiameterMm: 1550,
      renderInnerDiameterMm: 508,
      renderWidthMm: 1250,
      isEstimatedModel: true,
    });
    assert.equal(estimated.outerRadiusM, 0.775);
    assert.equal(estimated.innerRadiusM, 0.254);
    assert.equal(estimated.widthM, 1.25);
    assert.equal(estimated.isEstimatedModel, true);
  });

  it('calculates safe camera presets and keeps location focus above floor level', () => {
    const bounds = { centerX: 0, centerZ: 0, widthM: 64, depthM: 38, heightM: 14 };
    const iso = computeCameraPreset('isometric', bounds);
    const top = computeCameraPreset('top', bounds);
    const front = computeCameraPreset('front', bounds);
    const side = computeCameraPreset('side', bounds);

    assert.ok(iso.position.y > 15);
    assert.ok(top.position.y > 40);
    assert.ok(front.position.z > 20);
    assert.ok(side.position.x > 20);

    const floorFocus = computeLocationFocusPose({ x: -5.1, y: 0, z: -8 });
    assert.ok(floorFocus.position.y >= 4.5, 'Camera must remain safely above warehouse floor');
    assert.equal(floorFocus.target.x, -5.1);
    assert.equal(floorFocus.target.z, -8);
  });

  it('filters locations by door, row, and level accurately', () => {
    const sample = [
      { id: 1, doorId: 1, rowId: 10, levelNumber: 1 },
      { id: 2, doorId: 1, rowId: 10, levelNumber: 3 },
      { id: 3, doorId: 2, rowId: 20, levelNumber: 1 },
    ] as SceneLocationNode[];

    assert.equal(filterSceneLocations(sample, { doorId: 'ALL', rowId: 'ALL', levelNumber: 'ALL' }).length, 3);
    assert.equal(filterSceneLocations(sample, { doorId: 1, rowId: 'ALL', levelNumber: 'ALL' }).length, 2);
    assert.equal(filterSceneLocations(sample, { doorId: 1, rowId: 10, levelNumber: 3 }).length, 1);
  });

  it('deduplicates out-of-order realtime event sequence numbers', () => {
    assert.equal(shouldAcceptRealtimeSeq(0, 1), true);
    assert.equal(shouldAcceptRealtimeSeq(5, 5), false);
    assert.equal(shouldAcceptRealtimeSeq(5, 3), false);
    assert.equal(shouldAcceptRealtimeSeq(5, 6), true);
  });

  it('builds InstancedMesh buffers for 1,200 locations efficiently within budget', () => {
    const manySlots = Array.from({ length: 1200 }, (_, i) => ({
      id: i + 1,
      posX: (i % 40) * 2.1,
      posY: Math.floor(i / 400) * 1.4,
      posZ: Math.floor((i % 400) / 40) * 4.5,
      status: (i % 10 === 0 ? 'BLOCKED' : i % 3 === 0 ? 'OCCUPIED' : 'EMPTY') as
        | 'EMPTY'
        | 'OCCUPIED'
        | 'BLOCKED',
    }));
    const highlighted = new Set<number>([100, 250]);
    const start = performance.now();
    const buffers = buildLocationInstanceBuffers(manySlots, highlighted);
    const elapsedMs = performance.now() - start;

    assert.equal(buffers.count, 1200);
    assert.equal(buffers.positions.length, 3600);
    assert.equal(buffers.colorsHex[99], 0x9333ea); // id 100 highlighted purple
    assert.equal(buffers.colorsHex[0], 0xdc2626); // id 1 blocked red
    assert.ok(elapsedMs < 100, `Expected instancing buffer prep < 100ms, got ${elapsedMs}ms`);
  });

  it('dynamically expands 3D warehouse bounds when rows extend beyond default 12 slots', () => {
    const defaultBounds = computeEffectiveSceneBounds(
      [{ widthM: 64, depthM: 38, heightM: 14 }],
      [{ posX: -11, posY: 0, posZ: -8 }, { posX: 12.65, posY: 0, posZ: -8 }]
    );
    assert.equal(defaultBounds.widthM, 64);
    assert.equal(defaultBounds.centerX, 0);

    // Row expanded to 30 coils -> slot 30 at posX = -11 + 29*2.15 = 51.35m (past default +32m edge)
    const expandedBounds = computeEffectiveSceneBounds(
      [{ widthM: 64, depthM: 38, heightM: 14 }],
      [{ posX: -11, posY: 0, posZ: -8 }, { posX: 51.35, posY: 0, posZ: -8 }]
    );
    assert.ok(expandedBounds.maxX >= 58.85);
    assert.ok(expandedBounds.widthM > 90);
    assert.ok(expandedBounds.centerX > 10);
  });
});
