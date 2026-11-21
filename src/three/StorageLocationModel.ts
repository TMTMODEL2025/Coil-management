import * as THREE from 'three';
import type { SceneLocationNode } from '../types/wms';
import { getStatusVisualStyle, resolveVisualStatus } from './warehouse3dLogic';

const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();

/**
 * Module 4: StorageLocationModel
 * High-performance InstancedMesh renderer for all Storage Locations (supports 1,000+ slots).
 * - Level 1 (FLOOR_SADDLE): Authentic yellow steel channel Floor Saddle + dark charcoal wedge chocks
 *   plus a crisp database-status color pad underneath.
 * - Levels 2–4 (PYRAMID_STACK): Clean chamfered pyramid nesting markers at exact DB coordinates.
 * - Temporary purple (#9333EA) focus halo beacon for selected/searched locations (never mutates DB).
 */
export class StorageLocationModel {
  readonly group = new THREE.Group();

  // Floor Saddle hardware (Level 1)
  private saddleRailMesh: THREE.InstancedMesh | null = null;
  private chockLeftMesh: THREE.InstancedMesh | null = null;
  private chockRightMesh: THREE.InstancedMesh | null = null;

  // Interactive status pads (All levels — clickable raycast target)
  private locationPadMesh: THREE.InstancedMesh | null = null;

  // Selection/Search highlight beacon (temporary visual focus)
  private focusBeaconGroup: THREE.Group;
  private focusRingMesh: THREE.Mesh;
  private focusPillarMesh: THREE.Mesh;

  private orderedLocations: SceneLocationNode[] = [];
  private indexByLocationId = new Map<number, number>();
  private highlightedIds = new Set<number>();
  private focusedLocationId: number | null = null;

  private sharedGeometries: THREE.BufferGeometry[] = [];
  private sharedMaterials: THREE.Material[] = [];

  constructor() {
    this.group.name = 'StorageLocationModel';

    // Reusable selection focus beacon (purple #9333EA)
    this.focusBeaconGroup = new THREE.Group();
    this.focusBeaconGroup.visible = false;

    const ringGeo = new THREE.RingGeometry(0.92, 1.12, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x9333ea,
      side: THREE.DoubleSide,
    });
    this.focusRingMesh = new THREE.Mesh(ringGeo, ringMat);
    this.focusRingMesh.rotation.x = -Math.PI / 2;
    this.focusBeaconGroup.add(this.focusRingMesh);

    const pillarGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.8, 12);
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.72,
    });
    this.focusPillarMesh = new THREE.Mesh(pillarGeo, pillarMat);
    this.focusPillarMesh.position.y = 1.4;
    this.focusBeaconGroup.add(this.focusPillarMesh);

    this.sharedGeometries.push(ringGeo, pillarGeo);
    this.sharedMaterials.push(ringMat, pillarMat);
    this.group.add(this.focusBeaconGroup);
  }

  /**
   * Builds/rebuilds instanced meshes for the current filtered list of real DB locations.
   */
  updateLocations(locations: SceneLocationNode[], highlightedIds: ReadonlySet<number>): void {
    this.disposeInstancedMeshes();

    this.orderedLocations = locations;
    this.indexByLocationId.clear();
    this.highlightedIds = new Set(highlightedIds);

    if (locations.length === 0) {
      this.focusBeaconGroup.visible = false;
      return;
    }

    const level1Locations: SceneLocationNode[] = [];
    for (let i = 0; i < locations.length; i++) {
      this.indexByLocationId.set(locations[i].id, i);
      if (locations[i].levelNumber === 1 || locations[i].stackingRule === 'FLOOR_SADDLE') {
        level1Locations.push(locations[i]);
      }
    }

    // 1. Level 1 Floor Saddle Hardware (Yellow Steel Channel Rails + Dark Charcoal Wedge Chocks)
    if (level1Locations.length > 0) {
      // Twin yellow base channel rails merged visually via instancing (2 rails per slot -> 2 * count)
      const railGeo = new THREE.BoxGeometry(1.72, 0.11, 0.16);
      const railMat = new THREE.MeshStandardMaterial({
        color: 0xeab308,
        roughness: 0.42,
        metalness: 0.55,
      });
      this.saddleRailMesh = new THREE.InstancedMesh(railGeo, railMat, level1Locations.length * 2);
      this.saddleRailMesh.name = 'FloorSaddleRails';
      this.saddleRailMesh.castShadow = true;
      this.saddleRailMesh.receiveShadow = true;

      // Triangular coil chock wedge geometry matching reference photo 1
      const chockShape = new THREE.Shape();
      chockShape.moveTo(-0.22, 0);
      chockShape.lineTo(0.22, 0);
      chockShape.lineTo(0.08, 0.24);
      chockShape.lineTo(-0.14, 0.16);
      chockShape.closePath();

      const chockGeo = new THREE.ExtrudeGeometry(chockShape, {
        depth: 1.44,
        bevelEnabled: true,
        bevelThickness: 0.015,
        bevelSize: 0.015,
        bevelSegments: 2,
      });
      chockGeo.translate(0, 0, -0.72);

      const chockMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.58,
        metalness: 0.45,
      });

      this.chockLeftMesh = new THREE.InstancedMesh(chockGeo, chockMat, level1Locations.length);
      this.chockLeftMesh.name = 'FloorSaddleChocksLeft';
      this.chockLeftMesh.castShadow = true;

      this.chockRightMesh = new THREE.InstancedMesh(chockGeo, chockMat, level1Locations.length);
      this.chockRightMesh.name = 'FloorSaddleChocksRight';
      this.chockRightMesh.castShadow = true;

      for (let i = 0; i < level1Locations.length; i++) {
        const loc = level1Locations[i];
        const baseY = Math.max(0, loc.posY);

        // Front & rear yellow steel channel beams
        DUMMY.position.set(loc.posX, baseY + 0.055, loc.posZ - 0.58);
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.scale.set(1, 1, 1);
        DUMMY.updateMatrix();
        this.saddleRailMesh.setMatrixAt(i * 2, DUMMY.matrix);

        DUMMY.position.set(loc.posX, baseY + 0.055, loc.posZ + 0.58);
        DUMMY.updateMatrix();
        this.saddleRailMesh.setMatrixAt(i * 2 + 1, DUMMY.matrix);

        // Left & right angled dark chocks cradling the coil
        DUMMY.position.set(loc.posX - 0.54, baseY + 0.08, loc.posZ);
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.updateMatrix();
        this.chockLeftMesh.setMatrixAt(i, DUMMY.matrix);

        DUMMY.position.set(loc.posX + 0.54, baseY + 0.08, loc.posZ);
        DUMMY.rotation.set(0, Math.PI, 0);
        DUMMY.updateMatrix();
        this.chockRightMesh.setMatrixAt(i, DUMMY.matrix);
      }

      this.saddleRailMesh.instanceMatrix.needsUpdate = true;
      this.chockLeftMesh.instanceMatrix.needsUpdate = true;
      this.chockRightMesh.instanceMatrix.needsUpdate = true;
      this.saddleRailMesh.computeBoundingSphere();
      this.chockLeftMesh.computeBoundingSphere();
      this.chockRightMesh.computeBoundingSphere();

      this.group.add(this.saddleRailMesh, this.chockLeftMesh, this.chockRightMesh);
    }

    // 2. Interactive Status Pads for ALL Levels (Level 1 base plates + Level 2–4 pyramid tier markers)
    // Using neutral white material color so per-instance DB status colors render accurately without tinting.
    const padGeo = new THREE.BoxGeometry(1, 1, 1);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.48,
      metalness: 0.22,
      transparent: true,
      opacity: 0.84,
    });

    this.locationPadMesh = new THREE.InstancedMesh(padGeo, padMat, locations.length);
    this.locationPadMesh.name = 'StorageLocationPads';
    this.locationPadMesh.receiveShadow = true;

    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      const isGround = loc.levelNumber === 1 || loc.stackingRule === 'FLOOR_SADDLE';

      if (isGround) {
        // Sleek colored floor bay pad directly underneath the Floor Saddle
        DUMMY.position.set(loc.posX, Math.max(0.025, loc.posY + 0.025), loc.posZ);
        DUMMY.scale.set(Math.min(loc.widthM * 0.94, 1.82), 0.045, Math.min(loc.depthM * 0.92, 1.72));
      } else {
        // Pyramid upper stacking slot indicator node (sleek slim nesting marker, NOT a rack)
        DUMMY.position.set(loc.posX, loc.posY + 0.04, loc.posZ);
        DUMMY.scale.set(Math.min(loc.widthM * 0.54, 1.0), 0.065, Math.min(loc.depthM * 0.58, 1.08));
      }
      DUMMY.rotation.set(0, 0, 0);
      DUMMY.updateMatrix();
      this.locationPadMesh.setMatrixAt(i, DUMMY.matrix);

      const visualStatus = resolveVisualStatus(loc.status, this.highlightedIds.has(loc.id));
      COLOR.setHex(getStatusVisualStyle(visualStatus).numericColor);
      this.locationPadMesh.setColorAt(i, COLOR);
    }

    this.locationPadMesh.instanceMatrix.needsUpdate = true;
    if (this.locationPadMesh.instanceColor) {
      this.locationPadMesh.instanceColor.needsUpdate = true;
    }
    this.locationPadMesh.computeBoundingSphere();

    this.group.add(this.locationPadMesh);
    this.refreshFocusBeacon();
  }

  /**
   * Fast per-instance color update when selection/search highlight changes without rebuilding geometry.
   */
  setHighlightState(highlightedIds: ReadonlySet<number>, focusedLocationId: number | null): void {
    this.highlightedIds = new Set(highlightedIds);
    this.focusedLocationId = focusedLocationId;

    if (this.locationPadMesh) {
      for (let i = 0; i < this.orderedLocations.length; i++) {
        const loc = this.orderedLocations[i];
        const visualStatus = resolveVisualStatus(loc.status, this.highlightedIds.has(loc.id));
        COLOR.setHex(getStatusVisualStyle(visualStatus).numericColor);
        this.locationPadMesh.setColorAt(i, COLOR);
      }
      if (this.locationPadMesh.instanceColor) {
        this.locationPadMesh.instanceColor.needsUpdate = true;
      }
    }

    this.refreshFocusBeacon();
  }

  private refreshFocusBeacon(): void {
    if (this.focusedLocationId === null) {
      this.focusBeaconGroup.visible = false;
      return;
    }
    const idx = this.indexByLocationId.get(this.focusedLocationId);
    if (idx === undefined) {
      this.focusBeaconGroup.visible = false;
      return;
    }
    const loc = this.orderedLocations[idx];
    this.focusBeaconGroup.position.set(loc.posX, Math.max(0.08, loc.posY + 0.08), loc.posZ);
    this.focusBeaconGroup.visible = true;
  }

  getRaycastTargets(): THREE.Object3D[] {
    return this.locationPadMesh ? [this.locationPadMesh] : [];
  }

  resolveLocationByInstanceId(instanceId: number): SceneLocationNode | null {
    return this.orderedLocations[instanceId] ?? null;
  }

  getLocationById(id: number): SceneLocationNode | null {
    const idx = this.indexByLocationId.get(id);
    return idx !== undefined ? this.orderedLocations[idx] : null;
  }

  private disposeInstancedMeshes(): void {
    const meshes = [
      this.saddleRailMesh,
      this.chockLeftMesh,
      this.chockRightMesh,
      this.locationPadMesh,
    ];
    for (const m of meshes) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
      if (Array.isArray(m.material)) {
        m.material.forEach((mat) => mat.dispose());
      } else {
        m.material.dispose();
      }
    }
    this.saddleRailMesh = null;
    this.chockLeftMesh = null;
    this.chockRightMesh = null;
    this.locationPadMesh = null;
  }

  dispose(): void {
    this.disposeInstancedMeshes();
    for (const g of this.sharedGeometries) g.dispose();
    for (const m of this.sharedMaterials) m.dispose();
    this.sharedGeometries = [];
    this.sharedMaterials = [];
  }
}
