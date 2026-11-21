import * as THREE from 'three';
import type { LayoutObjectItem } from '../types/wms';
import type { ProceduralTextureBundle } from './textures';

import type { EffectiveSceneBounds } from './warehouse3dLogic';

/**
 * Module 6: OverheadCraneModel
 * Builds Demag-style double-girder bright safety-yellow Overhead Bridge Crane,
 * Crane Runways, Hoist Trolley, and Hazard-Striped C-Hook Coil Lifter directly
 * from PostgreSQL `warehouse_layout_objects`.
 *
 * Includes opt-in Visual Demonstration travel along the runway (strictly cosmetic:
 * never lifts fake coils or mutates database/inventory state).
 */
export class OverheadCraneModel {
  readonly group = new THREE.Group();
  private bridgeGroup: THREE.Group | null = null;
  private trolleyGroup: THREE.Group | null = null;

  private bridgeHomeX = -12;
  private trolleyHomeZ = 0;
  private runwayMinX = -24;
  private runwayMaxX = 22;
  private bridgeHalfSpanZ = 12;

  private disposableGeometries: THREE.BufferGeometry[] = [];
  private disposableMaterials: THREE.Material[] = [];

  constructor() {
    this.group.name = 'OverheadCraneModel';
  }

  build(
    layoutObjects: LayoutObjectItem[],
    textures: ProceduralTextureBundle,
    effectiveBounds?: EffectiveSceneBounds
  ): void {
    this.clear();

    const craneYellowMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.34,
      metalness: 0.58,
    });
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.45,
      metalness: 0.72,
    });
    const cableMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.4,
      metalness: 0.85,
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      map: textures.hazardStripe,
      roughness: 0.48,
      metalness: 0.35,
    });
    this.disposableMaterials.push(craneYellowMat, darkSteelMat, cableMat, hazardMat);

    const runways = layoutObjects.filter((o) => o.objectType === 'CRANE_RUNWAY' && o.isActive);
    const bridges = layoutObjects.filter((o) => o.objectType === 'CRANE_BRIDGE' && o.isActive);

    // 1. Crane Runway Girders (North & South I-beams, automatically extended for expanded rows)
    if (runways.length > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      for (const rw of runways) {
        const origLeft = rw.posX - rw.widthM / 2;
        const origRight = rw.posX + rw.widthM / 2;
        const spanLeft = effectiveBounds ? Math.min(origLeft, effectiveBounds.minX + 1.5) : origLeft;
        const spanRight = effectiveBounds ? Math.max(origRight, effectiveBounds.maxX - 1.5) : origRight;
        const effectiveWidth = Math.max(rw.widthM, spanRight - spanLeft);
        const effectivePosX = (spanLeft + spanRight) / 2;

        const beamGeo = new THREE.BoxGeometry(effectiveWidth, rw.heightM, rw.depthM);
        const railTopGeo = new THREE.BoxGeometry(effectiveWidth, 0.14, 0.24);
        this.disposableGeometries.push(beamGeo, railTopGeo);

        const beam = new THREE.Mesh(beamGeo, craneYellowMat);
        beam.position.set(effectivePosX, rw.posY, rw.posZ);
        beam.castShadow = true;
        this.group.add(beam);

        const railTop = new THREE.Mesh(railTopGeo, darkSteelMat);
        railTop.position.set(effectivePosX, rw.posY + rw.heightM / 2 + 0.07, rw.posZ);
        this.group.add(railTop);

        minX = Math.min(minX, spanLeft + 5);
        maxX = Math.max(maxX, spanRight - 5);
      }
      if (Number.isFinite(minX) && Number.isFinite(maxX)) {
        this.runwayMinX = minX;
        this.runwayMaxX = maxX;
      }
    }

    // 2. Double-Girder Overhead Bridge Crane + Trolley + C-Hook Coil Lifter
    const primaryBridge = bridges[0];
    if (!primaryBridge) return;

    this.bridgeHomeX = primaryBridge.posX;
    this.trolleyHomeZ = primaryBridge.posZ;
    const spanZ = primaryBridge.depthM;
    this.bridgeHalfSpanZ = Math.max(4, spanZ / 2 - 3.5);

    const bridgeGroup = new THREE.Group();
    bridgeGroup.name = primaryBridge.objectCode;
    bridgeGroup.position.set(primaryBridge.posX, primaryBridge.posY, primaryBridge.posZ);

    // Twin main box girders (Demag double-girder silhouette)
    const girderGeo = new THREE.BoxGeometry(0.72, primaryBridge.heightM, spanZ);
    const endTruckGeo = new THREE.BoxGeometry(3.2, 0.65, 0.85);
    const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.22, 14);
    this.disposableGeometries.push(girderGeo, endTruckGeo, wheelGeo);

    for (const gx of [-0.88, 0.88]) {
      const girder = new THREE.Mesh(girderGeo, craneYellowMat);
      girder.position.set(gx, 0, 0);
      girder.castShadow = true;
      bridgeGroup.add(girder);
    }

    // End trucks riding on North & South runway rails
    for (const endZ of [-spanZ / 2, spanZ / 2]) {
      const truck = new THREE.Mesh(endTruckGeo, darkSteelMat);
      truck.position.set(0, -0.32, endZ);
      bridgeGroup.add(truck);

      for (const wx of [-1.0, 1.0]) {
        const wheel = new THREE.Mesh(wheelGeo, craneYellowMat);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(wx, -0.62, endZ);
        bridgeGroup.add(wheel);
      }
    }

    // Hoist Trolley + Wire Ropes + C-Hook Coil Lifter
    const trolleyGroup = new THREE.Group();
    trolleyGroup.position.set(0, 0, 0);

    const trolleyFrameGeo = new THREE.BoxGeometry(2.3, 0.62, 2.2);
    const drumGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.25, 16);
    const cableGeo = new THREE.CylinderGeometry(0.035, 0.035, 3.6, 8);
    const spreaderBlockGeo = new THREE.BoxGeometry(1.15, 0.58, 1.45);
    const hookVerticalGeo = new THREE.BoxGeometry(0.28, 1.35, 0.45);
    const hookTongueGeo = new THREE.BoxGeometry(0.34, 0.3, 1.45);
    this.disposableGeometries.push(
      trolleyFrameGeo,
      drumGeo,
      cableGeo,
      spreaderBlockGeo,
      hookVerticalGeo,
      hookTongueGeo
    );

    const trolleyFrame = new THREE.Mesh(trolleyFrameGeo, darkSteelMat);
    trolleyFrame.position.set(0, 0.72, 0);
    trolleyGroup.add(trolleyFrame);

    const drum = new THREE.Mesh(drumGeo, craneYellowMat);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, 1.05, 0);
    trolleyGroup.add(drum);

    // Four steel hoist wire ropes
    for (const [cx, cz] of [
      [-0.38, -0.45],
      [0.38, -0.45],
      [-0.38, 0.45],
      [0.38, 0.45],
    ]) {
      const cable = new THREE.Mesh(cableGeo, cableMat);
      cable.position.set(cx, -1.55, cz);
      trolleyGroup.add(cable);
    }

    // Hazard-striped hoist head block (matching Demag reference photo 3)
    const spreader = new THREE.Mesh(spreaderBlockGeo, hazardMat);
    spreader.position.set(0, -3.55, 0);
    spreader.castShadow = true;
    trolleyGroup.add(spreader);

    // Heavy C-Hook Coil Lifter arm below head block (empty — never carries fake coil!)
    const hookBack = new THREE.Mesh(hookVerticalGeo, craneYellowMat);
    hookBack.position.set(0, -4.45, -0.58);
    trolleyGroup.add(hookBack);

    const hookTongue = new THREE.Mesh(hookTongueGeo, craneYellowMat);
    hookTongue.position.set(0, -5.05, 0.02);
    trolleyGroup.add(hookTongue);

    bridgeGroup.add(trolleyGroup);
    this.group.add(bridgeGroup);

    this.bridgeGroup = bridgeGroup;
    this.trolleyGroup = trolleyGroup;
  }

  /**
   * Cosmetic Visual Demonstration travel (opt-in toggle only).
   */
  updateVisualDemo(elapsedSec: number): void {
    if (!this.bridgeGroup || !this.trolleyGroup) return;
    const travelRangeX = (this.runwayMaxX - this.runwayMinX) * 0.32;
    const centerX = (this.runwayMinX + this.runwayMaxX) / 2;
    this.bridgeGroup.position.x = centerX + Math.sin(elapsedSec * 0.28) * travelRangeX;
    this.trolleyGroup.position.z =
      Math.cos(elapsedSec * 0.42) * (this.bridgeHalfSpanZ * 0.62);
  }

  resetToHomePose(): void {
    if (this.bridgeGroup) {
      this.bridgeGroup.position.x = this.bridgeHomeX;
    }
    if (this.trolleyGroup) {
      this.trolleyGroup.position.z = this.trolleyHomeZ;
    }
  }

  clear(): void {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    for (const g of this.disposableGeometries) g.dispose();
    for (const m of this.disposableMaterials) m.dispose();
    this.disposableGeometries = [];
    this.disposableMaterials = [];
    this.bridgeGroup = null;
    this.trolleyGroup = null;
  }

  dispose(): void {
    this.clear();
  }
}
