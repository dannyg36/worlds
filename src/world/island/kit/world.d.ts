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

/** A vignette's plot: its centre on the island, its outward angle and its radius, in metres. */
export type IslandPlot = { x: number; z: number; rot: number; radius: number; index: number };

/** What island.js laid out; plots[i] holds vignettes[i]. */
export type IslandLayout = {
  radius: number;
  plots: IslandPlot[];
  heightAt(x: number, z: number): number;
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
  /** Null for a single diorama, or when the island couldn't be built. */
  island: IslandLayout | null;
};

export function createWorld(
  container: HTMLElement,
  spec: object,
  opts?: WorldOptions,
): Promise<WorldHandle>;
