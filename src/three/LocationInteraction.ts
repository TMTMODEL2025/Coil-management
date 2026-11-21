import * as THREE from 'three';
import type { SceneLocationNode } from '../types/wms';
import type { SteelCoilModel } from './SteelCoilModel';
import type { StorageLocationModel } from './StorageLocationModel';

export type LocationSelectHandler = (
  location: SceneLocationNode | null,
  source: 'coil' | 'location' | 'empty'
) => void;

/**
 * Module 8: LocationInteraction
 * Handles desktop click and mobile tap raycasting against InstancedMesh Coils and Locations.
 * Distinguishes tap/click from OrbitControls camera drag via pointer travel threshold.
 */
export class LocationInteraction {
  private domElement: HTMLElement;
  private camera: THREE.PerspectiveCamera;
  private locationModel: StorageLocationModel;
  private coilModel: SteelCoilModel;
  private onSelect: LocationSelectHandler;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  private pointerDownX = 0;
  private pointerDownY = 0;
  private pointerDownTime = 0;
  private activePointerId: number | null = null;
  private lastHoverCheckMs = 0;

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.activePointerId = e.pointerId;
    this.pointerDownX = e.clientX;
    this.pointerDownY = e.clientY;
    this.pointerDownTime = performance.now();
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    if (this.activePointerId !== e.pointerId) return;
    this.activePointerId = null;

    const dx = e.clientX - this.pointerDownX;
    const dy = e.clientY - this.pointerDownY;
    const dist = Math.hypot(dx, dy);
    const elapsed = performance.now() - this.pointerDownTime;

    // Ignore drags / long camera pans so orbiting never accidentally selects slots
    if (dist > 7 || elapsed > 650) return;

    const hit = this.pickAtClientPoint(e.clientX, e.clientY);
    if (hit) {
      this.onSelect(hit.location, hit.source);
    }
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - this.lastHoverCheckMs < 75) return;
    this.lastHoverCheckMs = now;

    const hit = this.pickAtClientPoint(e.clientX, e.clientY);
    this.domElement.style.cursor = hit ? 'pointer' : 'grab';
  };

  constructor(
    domElement: HTMLElement,
    camera: THREE.PerspectiveCamera,
    locationModel: StorageLocationModel,
    coilModel: SteelCoilModel,
    onSelect: LocationSelectHandler
  ) {
    this.domElement = domElement;
    this.camera = camera;
    this.locationModel = locationModel;
    this.coilModel = coilModel;
    this.onSelect = onSelect;

    this.domElement.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    this.domElement.addEventListener('pointerup', this.onPointerUp, { passive: true });
    this.domElement.addEventListener('pointermove', this.onPointerMove, { passive: true });
  }

  private pickAtClientPoint(
    clientX: number,
    clientY: number
  ): { location: SceneLocationNode; source: 'coil' | 'location' } | null {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);

    // 1. Check active Steel Coils first
    const coilTargets = this.coilModel.getRaycastTargets();
    if (coilTargets.length > 0) {
      const coilHits = this.raycaster.intersectObjects(coilTargets, false);
      if (coilHits.length > 0 && coilHits[0].instanceId !== undefined) {
        const loc = this.coilModel.resolveLocationByInstanceId(coilHits[0].instanceId);
        if (loc) {
          return { location: loc, source: 'coil' };
        }
      }
    }

    // 2. Check Storage Location pads / Floor Saddles
    const locTargets = this.locationModel.getRaycastTargets();
    if (locTargets.length > 0) {
      const locHits = this.raycaster.intersectObjects(locTargets, false);
      if (locHits.length > 0 && locHits[0].instanceId !== undefined) {
        const loc = this.locationModel.resolveLocationByInstanceId(locHits[0].instanceId);
        if (loc) {
          return { location: loc, source: 'location' };
        }
      }
    }

    return null;
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.style.cursor = '';
  }
}
