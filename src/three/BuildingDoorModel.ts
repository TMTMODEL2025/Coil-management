import * as THREE from 'three';
import type { BuildingDoor, LayoutObjectItem } from '../types/wms';
import { createDoorSignTexture, type ProceduralTextureBundle } from './textures';

/**
 * Module 3: BuildingDoorModel
 * Builds industrial steel building door gates (e.g. E7, E8) directly from PostgreSQL
 * `building_doors` and `DOOR_GATE` layout objects, complete with jamb columns,
 * rolled shutter header, yellow/black safety bollards, and high-contrast signage.
 */
export class BuildingDoorModel {
  readonly group = new THREE.Group();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private disposableMaterials: THREE.Material[] = [];
  private disposableTextures: THREE.Texture[] = [];

  constructor() {
    this.group.name = 'BuildingDoorModel';
  }

  build(
    doors: BuildingDoor[],
    layoutObjects: LayoutObjectItem[],
    textures: ProceduralTextureBundle
  ): void {
    this.clear();

    const gateObjByDoorId = new Map<number, LayoutObjectItem>();
    for (const obj of layoutObjects) {
      if (obj.objectType === 'DOOR_GATE' && obj.doorId !== null && obj.isActive) {
        gateObjByDoorId.set(obj.doorId, obj);
      }
    }

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a8a,
      roughness: 0.42,
      metalness: 0.65,
    });
    const shutterMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.52,
      metalness: 0.72,
    });
    const bollardMat = new THREE.MeshStandardMaterial({
      map: textures.hazardStripe,
      roughness: 0.5,
      metalness: 0.3,
    });
    this.disposableMaterials.push(frameMat, shutterMat, bollardMat);

    for (const door of doors) {
      if (!door.isActive) continue;
      const gateObj = gateObjByDoorId.get(door.id);

      const widthM = gateObj?.widthM ?? 5.4;
      const heightM = gateObj?.heightM ?? 6.8;
      const posX = gateObj?.posX ?? door.posX;
      const fallbackZOffset = door.facingDirection === 'NORTH' ? -3.2 : 3.2;
      const posZ = gateObj?.posZ ?? door.posZ + fallbackZOffset;

      const facingToDeg: Record<string, number> = {
        SOUTH: 0,
        NORTH: 180,
        EAST: 90,
        WEST: -90,
      };
      const rotDeg =
        gateObj && typeof gateObj.rotationYDeg === 'number' && gateObj.rotationYDeg !== 0
          ? gateObj.rotationYDeg
          : facingToDeg[door.facingDirection] ?? 0;

      const doorGroup = new THREE.Group();
      doorGroup.name = `BuildingDoor_${door.doorCode}`;
      doorGroup.position.set(posX, 0, posZ);
      doorGroup.rotation.y = THREE.MathUtils.degToRad(rotDeg);

      // Left & Right heavy jamb columns
      const jambGeo = new THREE.BoxGeometry(0.45, heightM, 0.55);
      this.disposableGeometries.push(jambGeo);
      const leftJamb = new THREE.Mesh(jambGeo, frameMat);
      leftJamb.position.set(-widthM / 2, heightM / 2, 0);
      leftJamb.castShadow = true;
      doorGroup.add(leftJamb);

      const rightJamb = new THREE.Mesh(jambGeo, frameMat);
      rightJamb.position.set(widthM / 2, heightM / 2, 0);
      rightJamb.castShadow = true;
      doorGroup.add(rightJamb);

      // Overhead steel lintel header
      const lintelGeo = new THREE.BoxGeometry(widthM + 0.9, 0.85, 0.65);
      this.disposableGeometries.push(lintelGeo);
      const lintel = new THREE.Mesh(lintelGeo, frameMat);
      lintel.position.set(0, heightM + 0.35, 0);
      lintel.castShadow = true;
      doorGroup.add(lintel);

      // Rolled industrial shutter drum (partially open bay)
      const shutterGeo = new THREE.BoxGeometry(widthM - 0.4, 1.35, 0.32);
      this.disposableGeometries.push(shutterGeo);
      const shutter = new THREE.Mesh(shutterGeo, shutterMat);
      shutter.position.set(0, heightM - 0.72, 0);
      doorGroup.add(shutter);

      // Protective hazard bollards flanking the exterior gate opening (clear of bay columns)
      const bollardGeo = new THREE.CylinderGeometry(0.14, 0.16, 1.25, 12);
      this.disposableGeometries.push(bollardGeo);
      for (const side of [-1, 1]) {
        const bollard = new THREE.Mesh(bollardGeo, bollardMat);
        bollard.position.set(side * (widthM / 2 + 0.35), 0.625, 0.48);
        bollard.castShadow = true;
        doorGroup.add(bollard);
      }

      // High-contrast Building Door Signage (visible from both inside & outside)
      const signTex = createDoorSignTexture(door.doorCode, 'TMT COIL BAY');
      this.disposableTextures.push(signTex);
      const signGeo = new THREE.BoxGeometry(Math.min(widthM * 0.8, 5.4), 1.65, 0.14);
      const signFaceMat = new THREE.MeshBasicMaterial({ map: signTex });
      const signSideMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.6,
        metalness: 0.4,
      });
      this.disposableGeometries.push(signGeo);
      this.disposableMaterials.push(signFaceMat, signSideMat);

      const signMesh = new THREE.Mesh(signGeo, [
        signSideMat,
        signSideMat,
        signSideMat,
        signSideMat,
        signFaceMat,
        signFaceMat,
      ]);
      signMesh.position.set(0, heightM + 1.55, 0);
      doorGroup.add(signMesh);

      this.group.add(doorGroup);
    }
  }

  clear(): void {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    for (const g of this.disposableGeometries) g.dispose();
    for (const m of this.disposableMaterials) m.dispose();
    for (const t of this.disposableTextures) t.dispose();
    this.disposableGeometries = [];
    this.disposableMaterials = [];
    this.disposableTextures = [];
  }

  dispose(): void {
    this.clear();
  }
}
