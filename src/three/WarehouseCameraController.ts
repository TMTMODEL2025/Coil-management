import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  computeCameraPreset,
  computeLocationFocusPose,
  type CameraPose,
  type CameraPresetId,
  type SceneBounds,
  type Vec3,
} from './warehouse3dLogic';

/**
 * Module 7: WarehouseCameraController
 * Manages OrbitControls, smooth preset/focus camera transitions, floor/bounds clamping,
 * mobile touch navigation, and instant transition cancellation when the user drags.
 */
export class WarehouseCameraController {
  readonly controls: OrbitControls;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private onNeedsRender: () => void;

  private bounds: SceneBounds = {
    centerX: 0,
    centerZ: 0,
    widthM: 64,
    depthM: 38,
    heightM: 14,
  };

  private transitionTargetPos: THREE.Vector3 | null = null;
  private transitionTargetLook: THREE.Vector3 | null = null;
  private transitionActive = false;

  private readonly handleControlsStart = () => {
    // User always wins immediately — cancel any in-flight camera animation
    this.cancelTransition();
  };

  private readonly handleControlsChange = () => {
    // Clamp orbit target safely inside warehouse bounds and above floor
    this.controls.target.y = Math.max(0.2, Math.min(18, this.controls.target.y));
    const maxOffset = Math.max(this.bounds.widthM, this.bounds.depthM) * 0.75;
    this.controls.target.x = THREE.MathUtils.clamp(
      this.controls.target.x,
      this.bounds.centerX - maxOffset,
      this.bounds.centerX + maxOffset
    );
    this.controls.target.z = THREE.MathUtils.clamp(
      this.controls.target.z,
      this.bounds.centerZ - maxOffset,
      this.bounds.centerZ + maxOffset
    );
    this.onNeedsRender();
  };

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    isSoftwareGl: boolean,
    onNeedsRender: () => void
  ) {
    this.camera = camera;
    this.isSoftwareGl = isSoftwareGl;
    this.onNeedsRender = onNeedsRender;

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = !isSoftwareGl;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.78;
    this.controls.zoomSpeed = 0.95;
    this.controls.panSpeed = 0.82;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 4.8;
    this.controls.maxDistance = 125;
    this.controls.maxPolarAngle = Math.PI * 0.475; // Never clip beneath concrete floor
    this.controls.minPolarAngle = 0.08;

    this.controls.addEventListener('start', this.handleControlsStart);
    this.controls.addEventListener('change', this.handleControlsChange);

    // Initial isometric overview pose
    this.applyPoseImmediate(computeCameraPreset('isometric', this.bounds));
  }

  setSceneBounds(bounds: SceneBounds): void {
    this.bounds = bounds;
    const span = Math.max(bounds.widthM, bounds.depthM, 64);
    this.controls.maxDistance = Math.max(125, span * 1.9);
    const neededFar = Math.max(280, span * 4);
    if (this.camera.far < neededFar) {
      this.camera.far = neededFar;
      this.camera.updateProjectionMatrix();
    }
  }

  goToPreset(preset: CameraPresetId, immediate = false): void {
    const pose = computeCameraPreset(preset, this.bounds);
    if (immediate || this.isSoftwareGl) {
      this.applyPoseImmediate(pose);
    } else {
      this.startTransition(pose);
    }
  }

  focusOnPoint(point: Vec3, immediate = false): void {
    const pose = computeLocationFocusPose(point);
    if (immediate || this.isSoftwareGl) {
      this.applyPoseImmediate(pose);
    } else {
      this.startTransition(pose);
    }
  }

  private applyPoseImmediate(pose: CameraPose): void {
    this.cancelTransition();
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    this.controls.update();
    this.onNeedsRender();
  }

  private startTransition(pose: CameraPose): void {
    this.transitionTargetPos = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
    this.transitionTargetLook = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z);
    this.transitionActive = true;
    this.onNeedsRender();
  }

  cancelTransition(): void {
    this.transitionActive = false;
    this.transitionTargetPos = null;
    this.transitionTargetLook = null;
  }

  /**
   * Advances smooth exponential damping or camera transition.
   * Returns true if another frame is needed to finish settling.
   */
  update(deltaSec: number): boolean {
    const dt = Math.min(deltaSec, 0.05);
    let keepAnimating = false;

    if (this.transitionActive && this.transitionTargetPos && this.transitionTargetLook) {
      const lambda = 7.5;
      this.camera.position.x = THREE.MathUtils.damp(
        this.camera.position.x,
        this.transitionTargetPos.x,
        lambda,
        dt
      );
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        this.transitionTargetPos.y,
        lambda,
        dt
      );
      this.camera.position.z = THREE.MathUtils.damp(
        this.camera.position.z,
        this.transitionTargetPos.z,
        lambda,
        dt
      );

      this.controls.target.x = THREE.MathUtils.damp(
        this.controls.target.x,
        this.transitionTargetLook.x,
        lambda,
        dt
      );
      this.controls.target.y = THREE.MathUtils.damp(
        this.controls.target.y,
        this.transitionTargetLook.y,
        lambda,
        dt
      );
      this.controls.target.z = THREE.MathUtils.damp(
        this.controls.target.z,
        this.transitionTargetLook.z,
        lambda,
        dt
      );

      const posDist = this.camera.position.distanceTo(this.transitionTargetPos);
      const lookDist = this.controls.target.distanceTo(this.transitionTargetLook);

      if (posDist < 0.04 && lookDist < 0.04) {
        this.camera.position.copy(this.transitionTargetPos);
        this.controls.target.copy(this.transitionTargetLook);
        this.cancelTransition();
      } else {
        keepAnimating = true;
      }
    }

    const dampingChanged = this.controls.update();
    return keepAnimating || (this.controls.enableDamping && dampingChanged);
  }

  dispose(): void {
    this.cancelTransition();
    this.controls.removeEventListener('start', this.handleControlsStart);
    this.controls.removeEventListener('change', this.handleControlsChange);
    this.controls.dispose();
  }
}
