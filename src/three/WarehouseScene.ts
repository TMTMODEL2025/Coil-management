import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { SceneLocationNode, Warehouse3DSceneResponse } from '../types/wms';
import { createWarehouseTextures, type ProceduralTextureBundle } from './textures';
import { WarehouseStructure } from './WarehouseStructure';
import { BuildingDoorModel } from './BuildingDoorModel';
import { StorageLocationModel } from './StorageLocationModel';
import { SteelCoilModel } from './SteelCoilModel';
import { OverheadCraneModel } from './OverheadCraneModel';
import { WarehouseCameraController } from './WarehouseCameraController';
import { LocationInteraction } from './LocationInteraction';
import { computeEffectiveSceneBounds, type CameraPresetId } from './warehouse3dLogic';

export interface WarehouseSceneCallbacks {
  onSelectLocation: (location: SceneLocationNode | null) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface WarehouseSceneDiagnostics {
  isSoftwareGl: boolean;
  rendererName: string;
  locationCount: number;
  activeCoilCount: number;
}

function detectSoftwareGl(gl: WebGLRenderingContext | WebGL2RenderingContext): {
  isSoftwareGl: boolean;
  rendererName: string;
} {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
      : String(gl.getParameter(gl.RENDERER) ?? '');
    const isSoftwareGl =
      /SwiftShader|llvmpipe|Software|Mesa OffScreen|ANGLE.*Basic Render/i.test(rendererName);
    return { isSoftwareGl, rendererName: rendererName || 'WebGL' };
  } catch {
    return { isSoftwareGl: false, rendererName: 'WebGL' };
  }
}

/**
 * Module 1: WarehouseScene
 * Core Three.js orchestrator owning WebGLRenderer, RoomEnvironment lighting,
 * modular warehouse sub-assemblies, on-demand rendering, software-WebGL pacing,
 * context loss recovery, ResizeObserver, and zero-leak disposal.
 */
export class WarehouseScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private envRenderTarget: THREE.WebGLRenderTarget;
  private textures: ProceduralTextureBundle;

  private structure: WarehouseStructure;
  private doorModel: BuildingDoorModel;
  private locationModel: StorageLocationModel;
  private coilModel: SteelCoilModel;
  private craneModel: OverheadCraneModel;
  private cameraController: WarehouseCameraController;
  private interaction: LocationInteraction;

  private resizeObserver: ResizeObserver;
  private callbacks: WarehouseSceneCallbacks;

  private readonly isSoftwareGl: boolean;
  private readonly rendererName: string;

  private rafId: number | null = null;
  private softwareDemoTimer: number | null = null;
  private disposed = false;
  private needsRender = false;
  private lastFrameMs = performance.now();

  private craneDemoActive = false;
  private craneDemoElapsedSec = 0;

  private currentLocationCount = 0;
  private currentActiveCoilCount = 0;

  private readonly handleContextLost = (e: Event) => {
    e.preventDefault();
    this.stopScheduledFrames();
    this.callbacks.onContextLost?.();
  };

  private readonly handleContextRestored = () => {
    this.callbacks.onContextRestored?.();
    this.requestRender();
  };

  constructor(container: HTMLElement, callbacks: WarehouseSceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    // Probe WebGL availability & software renderer cleanly before setting renderer quality
    const testCanvas = document.createElement('canvas');
    const probeGl =
      testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    if (!probeGl) {
      throw new Error('WEBGL_UNAVAILABLE');
    }
    const probe = detectSoftwareGl(probeGl);
    this.isSoftwareGl = probe.isSoftwareGl;
    this.rendererName = probe.rendererName;
    probeGl.getExtension('WEBGL_lose_context')?.loseContext();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    if (!this.isSoftwareGl) {
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 320);
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D Steel Coil Warehouse Viewport'
    );
    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);

    // Scene backdrop + horizon fog (crisp industrial dark navy echoing user reference)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1526);
    this.scene.fog = new THREE.FogExp2(0x0b1526, 0.0038);

    // Camera (widen vertical FOV smoothly on narrow portrait screens so full bay frames cleanly)
    const initialAspect = width / height;
    const initialFov = initialAspect < 0.85 ? 58 : 42;
    this.camera = new THREE.PerspectiveCamera(initialFov, initialAspect, 0.25, 280);

    // Studio metallic reflections via PMREM RoomEnvironment (identical across GPU & Software WebGL)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.envRenderTarget = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    roomEnv.dispose();
    pmrem.dispose();

    // Industrial 3-point + Hemisphere lighting (identical intensities on GPU & Software WebGL)
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.95);
    hemiLight.position.set(0, 32, 0);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
    keyLight.position.set(28, 38, 24);
    if (!this.isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(2048, 2048);
      keyLight.shadow.camera.near = 5;
      keyLight.shadow.camera.far = 120;
      keyLight.shadow.camera.left = -42;
      keyLight.shadow.camera.right = 42;
      keyLight.shadow.camera.top = 34;
      keyLight.shadow.camera.bottom = -34;
      keyLight.shadow.bias = -0.0005;
    }
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.65);
    rimLight.position.set(-28, 22, -26);
    this.scene.add(rimLight);

    // Procedural PBR textures
    this.textures = createWarehouseTextures(this.renderer.capabilities.getMaxAnisotropy());

    // Modular sub-assemblies
    this.structure = new WarehouseStructure();
    this.doorModel = new BuildingDoorModel();
    this.locationModel = new StorageLocationModel();
    this.coilModel = new SteelCoilModel(this.textures);
    this.craneModel = new OverheadCraneModel();

    this.scene.add(
      this.structure.group,
      this.doorModel.group,
      this.locationModel.group,
      this.coilModel.group,
      this.craneModel.group
    );

    // Camera & Raycast Interaction
    this.cameraController = new WarehouseCameraController(
      this.camera,
      this.renderer.domElement,
      this.isSoftwareGl,
      () => this.requestRender()
    );

    this.interaction = new LocationInteraction(
      this.renderer.domElement,
      this.camera,
      this.locationModel,
      this.coilModel,
      (loc) => {
        this.callbacks.onSelectLocation(loc);
      }
    );

    // Responsive ResizeObserver
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || this.disposed) return;
      const w = Math.max(Math.floor(entry.contentRect.width), 280);
      const h = Math.max(Math.floor(entry.contentRect.height), 260);
      const aspect = w / h;
      this.camera.fov = aspect < 0.85 ? 58 : 42;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
      this.requestRender();
    });
    this.resizeObserver.observe(container);

    this.requestRender();
  }

  /**
   * Synchronizes the full warehouse structure (zones, doors, layout objects) from PostgreSQL.
   */
  syncStructure(data: Warehouse3DSceneResponse): void {
    const effectiveBounds = computeEffectiveSceneBounds(data.zones, data.locations);
    this.cameraController.setSceneBounds(effectiveBounds);

    this.structure.build(data.zones, data.layoutObjects, this.textures, effectiveBounds);
    this.doorModel.build(data.doors, data.layoutObjects, this.textures);
    this.craneModel.build(data.layoutObjects, this.textures, effectiveBounds);
    if (!this.craneDemoActive) {
      this.craneModel.resetToHomePose();
    }
    this.requestRender();
  }

  /**
   * Synchronizes visible locations & active coils (filtered by Door/Row/Level).
   */
  syncLocations(
    locations: SceneLocationNode[],
    highlightedIds: ReadonlySet<number>,
    focusedLocationId: number | null
  ): void {
    this.currentLocationCount = locations.length;
    this.locationModel.updateLocations(locations, highlightedIds);
    this.locationModel.setHighlightState(highlightedIds, focusedLocationId);
    this.coilModel.updateCoils(locations, highlightedIds);
    this.currentActiveCoilCount = this.coilModel.getActiveCoilCount();
    this.requestRender();
  }

  /**
   * Fast per-instance highlight update without regenerating meshes.
   */
  updateHighlights(highlightedIds: ReadonlySet<number>, focusedLocationId: number | null): void {
    this.locationModel.setHighlightState(highlightedIds, focusedLocationId);
    this.coilModel.setHighlightState(highlightedIds);
    this.requestRender();
  }

  setCameraPreset(preset: CameraPresetId): void {
    this.cameraController.goToPreset(preset);
    this.requestRender();
  }

  focusLocationById(locationId: number): boolean {
    const loc = this.locationModel.getLocationById(locationId);
    if (!loc) return false;
    this.cameraController.focusOnPoint({ x: loc.posX, y: loc.posY, z: loc.posZ });
    this.requestRender();
    return true;
  }

  setCraneVisualDemo(active: boolean): void {
    this.craneDemoActive = active;
    if (!active) {
      this.craneModel.resetToHomePose();
      if (this.softwareDemoTimer !== null) {
        window.clearTimeout(this.softwareDemoTimer);
        this.softwareDemoTimer = null;
      }
    }
    this.requestRender();
  }

  getDiagnostics(): WarehouseSceneDiagnostics {
    return {
      isSoftwareGl: this.isSoftwareGl,
      rendererName: this.rendererName,
      locationCount: this.currentLocationCount,
      activeCoilCount: this.currentActiveCoilCount,
    };
  }

  requestRender(): void {
    if (this.disposed) return;
    this.needsRender = true;
    if (this.rafId === null && this.softwareDemoTimer === null) {
      this.rafId = window.requestAnimationFrame(this.renderLoop);
    }
  }

  private readonly renderLoop = (nowMs: number) => {
    this.rafId = null;
    if (this.disposed) return;

    const deltaSec = Math.min((nowMs - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = nowMs;

    const cameraAnimating = this.cameraController.update(deltaSec);
    if (this.craneDemoActive) {
      this.craneDemoElapsedSec += deltaSec;
      this.craneModel.updateVisualDemo(this.craneDemoElapsedSec);
    }

    if (this.needsRender || cameraAnimating || this.craneDemoActive) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }

    if (cameraAnimating) {
      this.rafId = window.requestAnimationFrame(this.renderLoop);
    } else if (this.craneDemoActive) {
      if (this.isSoftwareGl) {
        // Software WebGL pacing: wait for rasterizer fence + 80ms quiet window so input stays crisp
        this.afterDraw(() => {
          if (this.disposed || !this.craneDemoActive) return;
          this.softwareDemoTimer = window.setTimeout(() => {
            this.softwareDemoTimer = null;
            this.requestRender();
          }, 80);
        });
      } else {
        this.rafId = window.requestAnimationFrame(this.renderLoop);
      }
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext();
    if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (sync) {
        gl.flush();
        const poll = () => {
          if (this.disposed) {
            gl.deleteSync(sync);
            return;
          }
          const status = gl.clientWaitSync(sync, 0, 0);
          if (status === gl.WAIT_FAILED || status !== gl.TIMEOUT_EXPIRED) {
            gl.deleteSync(sync);
            cb();
          } else {
            window.setTimeout(poll, 10);
          }
        };
        window.setTimeout(poll, 10);
        return;
      }
    }
    window.setTimeout(cb, 32);
  }

  private stopScheduledFrames(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.softwareDemoTimer !== null) {
      window.clearTimeout(this.softwareDemoTimer);
      this.softwareDemoTimer = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopScheduledFrames();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.interaction.dispose();
    this.cameraController.dispose();
    this.structure.dispose();
    this.doorModel.dispose();
    this.locationModel.dispose();
    this.coilModel.dispose();
    this.craneModel.dispose();
    this.textures.dispose();
    this.envRenderTarget.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
