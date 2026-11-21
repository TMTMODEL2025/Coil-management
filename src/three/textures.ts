import * as THREE from 'three';

export interface ProceduralTextureBundle {
  concreteFloor: THREE.CanvasTexture;
  hazardStripe: THREE.CanvasTexture;
  coilOuterSteel: THREE.CanvasTexture;
  coilEndSpiral: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Generates crisp procedural PBR textures for the industrial steel coil warehouse
 * (concrete bay floor, yellow/black safety striping, brushed steel wrap, spiral coil end-face).
 * Zero external image fetches -> zero broken URLs or CORS failures.
 */
export function createWarehouseTextures(maxAnisotropy: number): ProceduralTextureBundle {
  const anisotropy = Math.min(8, Math.max(1, maxAnisotropy));

  // 1. Industrial troweled concrete floor with expansion joints
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 512;
  floorCanvas.height = 512;
  const fCtx = floorCanvas.getContext('2d')!;
  fCtx.fillStyle = '#475569';
  fCtx.fillRect(0, 0, 512, 512);

  // Subtle concrete aggregate grain
  for (let i = 0; i < 4200; i++) {
    const x = (i * 197) % 512;
    const y = (i * 353 + Math.floor(i / 7) * 19) % 512;
    const shade = 62 + ((i * 31) % 28);
    fCtx.fillStyle = `rgb(${shade}, ${shade + 9}, ${shade + 22})`;
    fCtx.fillRect(x, y, 2, 2);
  }

  // Expansion joint grid lines
  fCtx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
  fCtx.lineWidth = 3;
  fCtx.strokeRect(1.5, 1.5, 509, 509);
  fCtx.strokeStyle = 'rgba(203, 213, 225, 0.14)';
  fCtx.lineWidth = 1;
  fCtx.beginPath();
  fCtx.moveTo(256, 0);
  fCtx.lineTo(256, 512);
  fCtx.moveTo(0, 256);
  fCtx.lineTo(512, 256);
  fCtx.stroke();

  const concreteFloor = new THREE.CanvasTexture(floorCanvas);
  concreteFloor.colorSpace = THREE.SRGBColorSpace;
  concreteFloor.wrapS = THREE.RepeatWrapping;
  concreteFloor.wrapT = THREE.RepeatWrapping;
  concreteFloor.repeat.set(16, 10);
  concreteFloor.anisotropy = anisotropy;

  // 2. Industrial Yellow/Black Hazard Chevron Stripes (matching reference photos 1 & 3)
  const hazardCanvas = document.createElement('canvas');
  hazardCanvas.width = 256;
  hazardCanvas.height = 256;
  const hCtx = hazardCanvas.getContext('2d')!;
  hCtx.fillStyle = '#EAB308';
  hCtx.fillRect(0, 0, 256, 256);
  hCtx.fillStyle = '#111827';
  for (let i = -256; i < 512; i += 48) {
    hCtx.beginPath();
    hCtx.moveTo(i, 0);
    hCtx.lineTo(i + 24, 0);
    hCtx.lineTo(i + 24 + 256, 256);
    hCtx.lineTo(i + 256, 256);
    hCtx.closePath();
    hCtx.fill();
  }
  const hazardStripe = new THREE.CanvasTexture(hazardCanvas);
  hazardStripe.colorSpace = THREE.SRGBColorSpace;
  hazardStripe.wrapS = THREE.RepeatWrapping;
  hazardStripe.wrapT = THREE.RepeatWrapping;
  hazardStripe.repeat.set(2, 1);
  hazardStripe.anisotropy = anisotropy;

  // 3. Brushed Cold/Hot-Rolled Steel Outer Band with Dark Steel Strapping
  const steelCanvas = document.createElement('canvas');
  steelCanvas.width = 512;
  steelCanvas.height = 256;
  const sCtx = steelCanvas.getContext('2d')!;
  const grad = sCtx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#94A3B8');
  grad.addColorStop(0.25, '#CBD5E1');
  grad.addColorStop(0.5, '#E2E8F0');
  grad.addColorStop(0.75, '#94A3B8');
  grad.addColorStop(1, '#64748B');
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, 512, 256);

  // Fine brushed rolling grain
  for (let y = 0; y < 256; y += 2) {
    const alpha = 0.04 + ((y * 17) % 10) * 0.008;
    sCtx.fillStyle = y % 4 === 0 ? `rgba(255,255,255,${alpha})` : `rgba(15,23,42,${alpha})`;
    sCtx.fillRect(0, y, 512, 1);
  }

  // Dark steel packaging strapping bands (3 circumferential straps)
  sCtx.fillStyle = '#1E293B';
  sCtx.fillRect(0, 26, 512, 10);
  sCtx.fillRect(0, 123, 512, 10);
  sCtx.fillRect(0, 220, 512, 10);

  const coilOuterSteel = new THREE.CanvasTexture(steelCanvas);
  coilOuterSteel.colorSpace = THREE.SRGBColorSpace;
  coilOuterSteel.wrapS = THREE.RepeatWrapping;
  coilOuterSteel.wrapT = THREE.ClampToEdgeWrapping;
  coilOuterSteel.anisotropy = anisotropy;

  // 4. Concentric Spiral End-Face Texture for Steel Coils (matching reference photo 1)
  const spiralCanvas = document.createElement('canvas');
  spiralCanvas.width = 512;
  spiralCanvas.height = 512;
  const spCtx = spiralCanvas.getContext('2d')!;
  spCtx.fillStyle = '#475569';
  spCtx.fillRect(0, 0, 512, 512);

  const cx = 256;
  const cy = 256;
  for (let r = 82; r < 252; r += 4) {
    spCtx.beginPath();
    spCtx.arc(cx, cy, r, 0, Math.PI * 2);
    spCtx.strokeStyle = r % 8 === 0 ? '#CBD5E1' : '#1E293B';
    spCtx.lineWidth = r % 8 === 0 ? 2.2 : 1.4;
    spCtx.stroke();
  }
  // Radial steel strapping across the end-face
  spCtx.strokeStyle = '#0F172A';
  spCtx.lineWidth = 7;
  for (let a = 0; a < 4; a++) {
    const angle = (a * Math.PI) / 2 + Math.PI / 4;
    spCtx.beginPath();
    spCtx.moveTo(cx + Math.cos(angle) * 80, cy + Math.sin(angle) * 80);
    spCtx.lineTo(cx + Math.cos(angle) * 254, cy + Math.sin(angle) * 254);
    spCtx.stroke();
  }

  const coilEndSpiral = new THREE.CanvasTexture(spiralCanvas);
  coilEndSpiral.colorSpace = THREE.SRGBColorSpace;
  coilEndSpiral.anisotropy = anisotropy;

  return {
    concreteFloor,
    hazardStripe,
    coilOuterSteel,
    coilEndSpiral,
    dispose: () => {
      concreteFloor.dispose();
      hazardStripe.dispose();
      coilOuterSteel.dispose();
      coilEndSpiral.dispose();
    },
  };
}

/**
 * Generates crisp door gate signage canvas texture (e.g. "DOOR E7").
 */
export function createDoorSignTexture(doorCode: string, subtitle?: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, 512, 192);

  // Industrial accent border
  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 496, 176);

  // Door code badge
  ctx.fillStyle = '#1D4ED8';
  ctx.fillRect(24, 26, 152, 140);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 74px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(doorCode, 100, 98);

  // Right label (safely bounded within canvas width)
  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 28px "JetBrains Mono", "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`BUILDING DOOR ${doorCode}`, 194, 78, 294);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = '600 20px "Inter", sans-serif';
  ctx.fillText(subtitle || 'STEEL COIL BAY ACCESS', 194, 126, 294);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Generates a high-contrast floor zone marking label texture (e.g. "RECEIVING AREA E7").
 */
export function createZoneFloorLabelTexture(
  title: string,
  accentHex: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.fillRect(0, 0, 512, 128);

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 116);

  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 34px "JetBrains Mono", "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
