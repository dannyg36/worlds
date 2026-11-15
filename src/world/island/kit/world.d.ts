// Types for the synced plain-JS kit (world.js). Hand-written; kept by tools/sync-island-kit.mjs.
import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type WorldOptions = {
  pixelRatio?: number;
  post?: boolean;
  quality?: "high" | "low";
  autoRotate?: boolean;
  onReady?: (stats: unknown) => void;
  onError?: (error: unknown) => void;
};

export type WorldHandle = {
  dispose(): void;
  setSize(width: number, height: number): void;
  stats: unknown;
  focusVignette(index: number): void;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
};

export function createWorld(
  container: HTMLElement,
  spec: object,
  opts?: WorldOptions,
): Promise<WorldHandle>;
