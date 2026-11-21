import * as THREE from 'three';
import type { LayoutObjectItem, WarehouseZone } from '../types/wms';
import { createZoneFloorLabelTexture, type ProceduralTextureBundle } from './textures';

import type { EffectiveSceneBounds } from './warehouse3dLogic';

/**
 * Module 2: WarehouseStructure
 * Renders the industrial steel coil warehouse shell (concrete bay floor,
 * structural steel columns & roof trusses, main forklift/coil aisles,
 * Receiving Area, Dispatch Area, and Blocked Safety Zones) from PostgreSQL data.
 * Strictly Floor Saddle & Overhead Crane layout — NO pallet racks.
 */
export class WarehouseStructure {
  readonly group = new THREE.Group();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private disposableMaterials: THREE.Material[] = [];
  private disposableTextures: THREE.Texture[] = [];

  constructor() {
    this.group.name = 'WarehouseStructure';
  }

  build(
    zones: WarehouseZone[],
    layoutObjects: LayoutObjectItem[],
    textures: ProceduralTextureBundle,
    effectiveBounds?: EffectiveSceneBounds
  ): void {
    this.clear();

    const primaryZone = zones[0];
    const widthM = effectiveBounds?.widthM ?? primaryZone?.widthM ?? 64;
    const depthM = effectiveBounds?.depthM ?? primaryZone?.depthM ?? 38;
    const heightM = effectiveBounds?.heightM ?? primaryZone?.heightM ?? 14;
    const centerX = effectiveBounds?.centerX ?? 0;
    const centerZ = effectiveBounds?.centerZ ?? 0;

    // 1. Industrial Concrete Floor Slab (dynamically sized to cover expanded rows)
    const slabThickness = 0.35;
    const floorGeo = new THREE.BoxGeometry(widthM + 4, slabThickness, depthM + 4);
    const floorMat = new THREE.MeshStandardMaterial({
      map: textures.concreteFloor,
      roughness: 0.88,
      metalness: 0.08,
      color: 0x94a3b8,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(centerX, -slabThickness / 2, centerZ);
    floorMesh.receiveShadow = true;
    floorMesh.name = 'WarehouseFloorSlab';
    this.group.add(floorMesh);
    this.disposableGeometries.push(floorGeo);
    this.disposableMaterials.push(floorMat);

    // Subtle dark apron surrounding concrete slab
    const apronGeo = new THREE.PlaneGeometry(widthM + 110, depthM + 110);
    const apronMat = new THREE.MeshStandardMaterial({
      color: 0x0b1220,
      roughness: 0.96,
      metalness: 0.05,
    });
    const apronMesh = new THREE.Mesh(apronGeo, apronMat);
    apronMesh.rotation.x = -Math.PI / 2;
    apronMesh.position.set(centerX, -slabThickness - 0.02, centerZ);
    this.group.add(apronMesh);
    this.disposableGeometries.push(apronGeo);
    this.disposableMaterials.push(apronMat);

    // Safety yellow perimeter bay border lines on concrete floor
    this.addFloorPerimeterLines(widthM, depthM, centerX, centerZ);

    // 2. Industrial Steel Portal Frame Columns & Roof Trusses (Open isometric cutaway)
    this.addSteelPortalFrame(widthM, depthM, heightM, centerX, centerZ, layoutObjects);

    // 3. Functional Layout Objects from PostgreSQL (Receiving, Dispatch, Aisle, Blocked)
    for (const obj of layoutObjects) {
      if (!obj.isActive) continue;
      if (obj.objectType === 'RECEIVING_AREA' || obj.objectType === 'DISPATCH_AREA') {
        this.addOperationalZonePad(obj, textures);
      } else if (obj.objectType === 'AISLE') {
        this.addAisleLane(obj, textures, depthM, centerZ);
      } else if (obj.objectType === 'BLOCKED_AREA') {
        this.addBlockedSafetyZone(obj, textures);
      }
    }
  }

  private addFloorPerimeterLines(
    widthM: number,
    depthM: number,
    centerX: number,
    centerZ: number
  ): void {
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.65,
      metalness: 0.1,
    });
    this.disposableMaterials.push(lineMat);

    const hw = widthM / 2 - 0.8;
    const hd = depthM / 2 - 0.8;
    const stripeW = 0.16;

    const northSouthGeo = new THREE.PlaneGeometry(hw * 2, stripeW);
    const eastWestGeo = new THREE.PlaneGeometry(stripeW, hd * 2);
    this.disposableGeometries.push(northSouthGeo, eastWestGeo);

    const edges: Array<{ geo: THREE.BufferGeometry; x: number; z: number }> = [
      { geo: northSouthGeo, x: centerX, z: centerZ - hd },
      { geo: northSouthGeo, x: centerX, z: centerZ + hd },
      { geo: eastWestGeo, x: centerX - hw, z: centerZ },
      { geo: eastWestGeo, x: centerX + hw, z: centerZ },
    ];

    for (const e of edges) {
      const m = new THREE.Mesh(e.geo, lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(e.x, 0.012, e.z);
      this.group.add(m);
    }
  }

  private addSteelPortalFrame(
    widthM: number,
    depthM: number,
    heightM: number,
    centerX: number,
    centerZ: number,
    layoutObjects: LayoutObjectItem[]
  ): void {
    const columnMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.45,
      metalness: 0.72,
    });
    const basePlateMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.55,
      metalness: 0.4,
    });
    const backWallMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.72,
      metalness: 0.35,
      transparent: true,
      opacity: 0.55,
    });
    this.disposableMaterials.push(columnMat, basePlateMat, backWallMat);

    const colCount = Math.max(7, Math.min(25, Math.round(widthM / 10) + 1));
    const halfW = widthM / 2 - 1.2;
    const halfD = depthM / 2 - 1.4;
    const colGeo = new THREE.BoxGeometry(0.52, heightM, 0.52);
    const baseGeo = new THREE.BoxGeometry(0.9, 0.45, 0.9);
    const trussGeo = new THREE.BoxGeometry(0.28, 0.36, halfD * 2 + 0.5);
    const northBeamGeo = new THREE.BoxGeometry(halfW * 2 + 0.5, 0.4, 0.35);
    this.disposableGeometries.push(colGeo, baseGeo, trussGeo, northBeamGeo);

    for (let i = 0; i < colCount; i++) {
      const t = i / (colCount - 1);
      const x = centerX - halfW + t * (halfW * 2);

      // North column + yellow safety base
      const northCol = new THREE.Mesh(colGeo, columnMat);
      northCol.position.set(x, heightM / 2, centerZ - halfD);
      northCol.castShadow = true;
      this.group.add(northCol);

      const northBase = new THREE.Mesh(baseGeo, basePlateMat);
      northBase.position.set(x, 0.225, centerZ - halfD);
      this.group.add(northBase);

      // South column + yellow safety base
      const southCol = new THREE.Mesh(colGeo, columnMat);
      southCol.position.set(x, heightM / 2, centerZ + halfD);
      southCol.castShadow = true;
      this.group.add(southCol);

      const southBase = new THREE.Mesh(baseGeo, basePlateMat);
      southBase.position.set(x, 0.225, centerZ + halfD);
      this.group.add(southBase);

      // Subtle overhead roof purlin truss
      const truss = new THREE.Mesh(trussGeo, columnMat);
      truss.position.set(x, heightM - 0.2, centerZ);
      this.group.add(truss);
    }

    // North & South top eave beams
    const northBeam = new THREE.Mesh(northBeamGeo, columnMat);
    northBeam.position.set(centerX, heightM - 0.15, centerZ - halfD);
    this.group.add(northBeam);

    const southBeam = new THREE.Mesh(northBeamGeo, columnMat);
    southBeam.position.set(centerX, heightM - 0.15, centerZ + halfD);
    this.group.add(southBeam);

    // Low industrial dado wall along North back edge, automatically split around active North doors
    const wallMinX = centerX - (widthM - 1.5) / 2;
    const wallMaxX = centerX + (widthM - 1.5) / 2;
    const northOpenings = layoutObjects
      .filter(
        (obj) =>
          obj.isActive &&
          obj.objectType === 'DOOR_GATE' &&
          obj.posZ < centerZ - halfD + 2.0
      )
      .map((obj) => ({
        start: obj.posX - obj.widthM / 2 - 0.25,
        end: obj.posX + obj.widthM / 2 + 0.25,
      }))
      .sort((a, b) => a.start - b.start);

    const segments: Array<{ start: number; end: number }> = [];
    let cursor = wallMinX;
    for (const op of northOpenings) {
      const clampedStart = Math.max(wallMinX, op.start);
      const clampedEnd = Math.min(wallMaxX, op.end);
      if (clampedStart > cursor + 0.2) {
        segments.push({ start: cursor, end: clampedStart });
      }
      cursor = Math.max(cursor, clampedEnd);
    }
    if (wallMaxX > cursor + 0.2) {
      segments.push({ start: cursor, end: wallMaxX });
    }

    for (const seg of segments) {
      const segW = seg.end - seg.start;
      const dadoGeo = new THREE.BoxGeometry(segW, 2.4, 0.22);
      this.disposableGeometries.push(dadoGeo);
      const dado = new THREE.Mesh(dadoGeo, backWallMat);
      dado.position.set((seg.start + seg.end) / 2, 1.2, centerZ - halfD - 0.22);
      this.group.add(dado);
    }
  }

  private addOperationalZonePad(
    obj: LayoutObjectItem,
    textures: ProceduralTextureBundle
  ): void {
    const padGroup = new THREE.Group();
    padGroup.position.set(obj.posX, 0.02, obj.posZ);
    padGroup.rotation.y = THREE.MathUtils.degToRad(obj.rotationYDeg || 0);

    const padGeo = new THREE.BoxGeometry(obj.widthM, 0.05, obj.depthM);
    const padMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(obj.colorHex || '#0EA5E9'),
      roughness: 0.72,
      metalness: 0.15,
      transparent: true,
      opacity: 0.32,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.receiveShadow = true;
    padGroup.add(pad);
    this.disposableGeometries.push(padGeo);
    this.disposableMaterials.push(padMat);

    // Hazard trim bars along front & back edges
    const trimGeo = new THREE.PlaneGeometry(obj.widthM, 0.26);
    const trimMat = new THREE.MeshStandardMaterial({
      map: textures.hazardStripe,
      roughness: 0.6,
      metalness: 0.1,
    });
    this.disposableGeometries.push(trimGeo);
    this.disposableMaterials.push(trimMat);

    const frontTrim = new THREE.Mesh(trimGeo, trimMat);
    frontTrim.rotation.x = -Math.PI / 2;
    frontTrim.position.set(0, 0.032, obj.depthM / 2 - 0.13);
    padGroup.add(frontTrim);

    const backTrim = new THREE.Mesh(trimGeo, trimMat);
    backTrim.rotation.x = -Math.PI / 2;
    backTrim.position.set(0, 0.032, -obj.depthM / 2 + 0.13);
    padGroup.add(backTrim);

    // Crisp floor stencil label
    const labelText =
      obj.objectType === 'RECEIVING_AREA'
        ? `RECEIVING · ${obj.objectCode.replace('OBJ-RCV-', '')}`
        : `DISPATCH · ${obj.objectCode.replace('OBJ-DSP-', '')}`;
    const labelTex = createZoneFloorLabelTexture(labelText, obj.colorHex || '#0EA5E9');
    this.disposableTextures.push(labelTex);
    const labelW = Math.min(obj.widthM * 0.72, 7.2);
    const labelGeo = new THREE.PlaneGeometry(labelW, labelW * 0.24);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true });
    this.disposableGeometries.push(labelGeo);
    this.disposableMaterials.push(labelMat);

    const labelMesh = new THREE.Mesh(labelGeo, labelMat);
    labelMesh.rotation.x = -Math.PI / 2;
    labelMesh.position.set(0, 0.036, 0);
    padGroup.add(labelMesh);

    this.group.add(padGroup);
  }

  private addAisleLane(
    obj: LayoutObjectItem,
    textures: ProceduralTextureBundle,
    bayDepthM: number,
    bayCenterZ: number
  ): void {
    const rotDeg = obj.rotationYDeg || 0;
    const isCrossBuilding = Math.abs(Math.round(rotDeg) % 180) === 90;
    const roadLengthM = isCrossBuilding ? Math.max(obj.widthM, bayDepthM - 0.6) : obj.widthM;
    const roadWidthM = obj.depthM;
    const roadPosZ = isCrossBuilding && Math.abs(obj.posZ) < 0.01 ? bayCenterZ : obj.posZ;

    const laneGroup = new THREE.Group();
    laneGroup.position.set(obj.posX, 0.02, roadPosZ);
    laneGroup.rotation.y = THREE.MathUtils.degToRad(rotDeg);

    const laneGeo = new THREE.PlaneGeometry(roadLengthM, roadWidthM);
    const laneMat = new THREE.MeshStandardMaterial({
      color: 0x263348,
      roughness: 0.88,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const lane = new THREE.Mesh(laneGeo, laneMat);
    lane.rotation.x = -Math.PI / 2;
    lane.receiveShadow = true;
    laneGroup.add(lane);
    this.disposableGeometries.push(laneGeo);
    this.disposableMaterials.push(laneMat);

    // Crisp amber road border stripes
    const borderGeo = new THREE.PlaneGeometry(roadLengthM, 0.2);
    const borderMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(obj.colorHex || '#F59E0B'),
      roughness: 0.55,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.disposableGeometries.push(borderGeo);
    this.disposableMaterials.push(borderMat);

    for (const sign of [-1, 1]) {
      const border = new THREE.Mesh(borderGeo, borderMat);
      border.rotation.x = -Math.PI / 2;
      border.position.set(0, 0.008, sign * (roadWidthM / 2 - 0.1));
      laneGroup.add(border);
    }

    // Symmetrically centered dashed lane guide
    const dashLength = 2.4;
    const dashStep = 4.8;
    const dashGeo = new THREE.PlaneGeometry(dashLength, 0.14);
    this.disposableGeometries.push(dashGeo);
    const usableSpan = Math.max(dashLength, roadLengthM - 2.6);
    const dashCount = Math.max(2, Math.floor(usableSpan / dashStep) + 1);
    const totalDashSpan = (dashCount - 1) * dashStep;
    const startX = -totalDashSpan / 2;

    for (let i = 0; i < dashCount; i++) {
      const x = startX + i * dashStep;
      const dash = new THREE.Mesh(dashGeo, borderMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.008, 0);
      laneGroup.add(dash);
    }

    void textures;
    this.group.add(laneGroup);
  }

  private addBlockedSafetyZone(
    obj: LayoutObjectItem,
    textures: ProceduralTextureBundle
  ): void {
    const blockedGroup = new THREE.Group();
    blockedGroup.position.set(obj.posX, 0.025, obj.posZ);
    blockedGroup.rotation.y = THREE.MathUtils.degToRad(obj.rotationYDeg || 0);

    const floorGeo = new THREE.BoxGeometry(obj.widthM, 0.06, obj.depthM);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.7,
      metalness: 0.15,
      transparent: true,
      opacity: 0.35,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    blockedGroup.add(floor);
    this.disposableGeometries.push(floorGeo);
    this.disposableMaterials.push(floorMat);

    // 4 Corner safety bollards
    const bollardGeo = new THREE.CylinderGeometry(0.11, 0.13, 1.05, 10);
    const bollardMat = new THREE.MeshStandardMaterial({
      map: textures.hazardStripe,
      roughness: 0.5,
      metalness: 0.35,
    });
    this.disposableGeometries.push(bollardGeo);
    this.disposableMaterials.push(bollardMat);

    const hw = obj.widthM / 2 - 0.25;
    const hd = obj.depthM / 2 - 0.25;
    for (const [bx, bz] of [
      [-hw, -hd],
      [hw, -hd],
      [-hw, hd],
      [hw, hd],
    ]) {
      const b = new THREE.Mesh(bollardGeo, bollardMat);
      b.position.set(bx, 0.525, bz);
      b.castShadow = true;
      blockedGroup.add(b);
    }

    const labelTex = createZoneFloorLabelTexture('SAFETY HOLD ZONE', '#DC2626');
    this.disposableTextures.push(labelTex);
    const labelGeo = new THREE.PlaneGeometry(Math.min(obj.widthM * 0.85, 5), 1.15);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true });
    this.disposableGeometries.push(labelGeo);
    this.disposableMaterials.push(labelMat);
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, 0.04, 0);
    blockedGroup.add(label);

    this.group.add(blockedGroup);
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
