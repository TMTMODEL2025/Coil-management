import * as THREE from 'three';
import type { SceneLocationNode } from '../types/wms';
import { resolveCoilDimensionsMeters } from './warehouse3dLogic';
import type { ProceduralTextureBundle } from './textures';

const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();

/**
 * Module 5: SteelCoilModel
 * High-performance InstancedMesh renderer for real active Steel Coils from PostgreSQL.
 * - Authentic hollow annular coil cylinder (outer diameter + inner center bore hole)
 *   matching industrial reference photography, with brushed steel wrap + spiral end-face.
 * - Renders ONLY coils present in active PostgreSQL `inventory`.
 *   If active inventory is 0, renders 0 coils (never invents mock coils).
 */
export class SteelCoilModel {
  readonly group = new THREE.Group();
  private coilInstancedMesh: THREE.InstancedMesh | null = null;
  private occupiedLocations: SceneLocationNode[] = [];
  private unitCoilGeometry: THREE.BufferGeometry;
  private coilMaterials: THREE.MeshStandardMaterial[];

  constructor(textures: ProceduralTextureBundle) {
    this.group.name = 'SteelCoilModel';

    // Build normalized unit hollow steel coil geometry:
    // Outer radius = 0.5 (Diameter = 1.0m), Inner bore radius = 0.165 (~508mm/1550mm), Depth/Width = 1.0m
    // Bore axis runs along Z so coils rest horizontally on the Floor Saddle cradles!
    const outerRadius = 0.5;
    const innerRadius = 0.165;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);

    const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 1,
      curveSegments: 28,
      bevelEnabled: true,
      bevelThickness: 0.018,
      bevelSize: 0.015,
      bevelSegments: 2,
    });
    extrudeGeo.translate(0, 0, -0.5);

    // Normalize UVs on end-faces so concentric spiral texture centers cleanly around bore
    const pos = extrudeGeo.attributes.position;
    const uv = extrudeGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (Math.abs(z) > 0.49) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        uv.setXY(i, x + 0.5, y + 0.5);
      }
    }
    uv.needsUpdate = true;
    extrudeGeo.computeVertexNormals();
    this.unitCoilGeometry = extrudeGeo;

    // Group 0 = end-faces (spiral layers), Group 1 = outer/inner cylindrical wrap (brushed steel + strapping)
    const endFaceMat = new THREE.MeshStandardMaterial({
      map: textures.coilEndSpiral,
      roughness: 0.36,
      metalness: 0.78,
      color: 0xffffff,
    });
    const wrapMat = new THREE.MeshStandardMaterial({
      map: textures.coilOuterSteel,
      roughness: 0.28,
      metalness: 0.86,
      color: 0xffffff,
    });
    this.coilMaterials = [endFaceMat, wrapMat];
  }

  updateCoils(locations: SceneLocationNode[], highlightedIds: ReadonlySet<number>): void {
    this.clearMesh();

    // STRICT TRUTH: Only render coils backed by active PostgreSQL inventory rows
    this.occupiedLocations = locations.filter((loc) => loc.coil !== null);
    if (this.occupiedLocations.length === 0) {
      return;
    }

    const mesh = new THREE.InstancedMesh(
      this.unitCoilGeometry,
      this.coilMaterials,
      this.occupiedLocations.length
    );
    mesh.name = 'ActiveSteelCoils';
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    for (let i = 0; i < this.occupiedLocations.length; i++) {
      const loc = this.occupiedLocations[i];
      const coil = loc.coil!;
      const dims = resolveCoilDimensionsMeters(coil);
      const outerDiameterM = dims.outerRadiusM * 2;
      const saddleClearanceY = loc.levelNumber === 1 ? 0.16 : 0.04;

      DUMMY.position.set(loc.posX, loc.posY + saddleClearanceY + dims.outerRadiusM, loc.posZ);
      DUMMY.rotation.set(0, 0, 0);
      DUMMY.scale.set(outerDiameterM, outerDiameterM, dims.widthM);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);

      // Purple tint when actively focused/searched; Amber metallic for Pre-SAP coils awaiting SAP sync; otherwise brushed metallic steel
      if (highlightedIds.has(loc.id)) {
        COLOR.setHex(0xc084fc);
      } else if (coil.isPendingSapSync) {
        COLOR.setHex(0xf59e0b);
      } else {
        COLOR.setHex(0xe2e8f0);
      }
      mesh.setColorAt(i, COLOR);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingSphere();

    this.coilInstancedMesh = mesh;
    this.group.add(mesh);
  }

  setHighlightState(highlightedIds: ReadonlySet<number>): void {
    if (!this.coilInstancedMesh) return;
    for (let i = 0; i < this.occupiedLocations.length; i++) {
      const loc = this.occupiedLocations[i];
      if (highlightedIds.has(loc.id)) {
        COLOR.setHex(0xc084fc);
      } else if (loc.coil?.isPendingSapSync) {
        COLOR.setHex(0xf59e0b);
      } else {
        COLOR.setHex(0xe2e8f0);
      }
      this.coilInstancedMesh.setColorAt(i, COLOR);
    }
    if (this.coilInstancedMesh.instanceColor) {
      this.coilInstancedMesh.instanceColor.needsUpdate = true;
    }
  }

  getRaycastTargets(): THREE.Object3D[] {
    return this.coilInstancedMesh ? [this.coilInstancedMesh] : [];
  }

  resolveLocationByInstanceId(instanceId: number): SceneLocationNode | null {
    return this.occupiedLocations[instanceId] ?? null;
  }

  getActiveCoilCount(): number {
    return this.occupiedLocations.length;
  }

  private clearMesh(): void {
    if (this.coilInstancedMesh) {
      this.group.remove(this.coilInstancedMesh);
      this.coilInstancedMesh.dispose();
      this.coilInstancedMesh = null;
    }
  }

  dispose(): void {
    this.clearMesh();
    this.unitCoilGeometry.dispose();
    for (const m of this.coilMaterials) m.dispose();
    this.coilMaterials = [];
  }
}
