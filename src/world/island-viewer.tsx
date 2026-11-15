"use dom";

import type { DOMProps } from "expo/dom";
import { useEffect, useRef } from "react";

import { createWorld, type WorldHandle } from "@/world/island/kit/world.js";

type Props = {
  sceneJson: string;
  insetTop: number;
  insetBottom: number;
  onReady: () => Promise<void>;
  onError: (message: string) => Promise<void>;
  dom?: DOMProps;
};

type Events = Pick<Props, "onReady" | "onError">;
type Insets = { top: number; bottom: number };

export default function IslandViewer({
  sceneJson,
  insetTop,
  insetBottom,
  onReady,
  onError,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<WorldHandle | null>(null);
  const insetsRef = useRef<Insets>({ top: insetTop, bottom: insetBottom });
  const eventsRef = useRef<Events>({ onReady, onError });

  useEffect(() => {
    eventsRef.current = { onReady, onError };
  });

  useEffect(() => {
    const host = hostRef.current!;
    const viewport = document.querySelector('meta[name="viewport"]');
    viewport?.setAttribute(
      "content",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
    );
    const preventGesture = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", preventGesture);

    let disposed = false;
    let world: WorldHandle | null = null;
    const fail = (error: unknown) => {
      if (!disposed) {
        void eventsRef.current.onError(
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      if (world) {
        layout(world, host, insetsRef.current);
      }
    });

    try {
      createWorld(host, JSON.parse(sceneJson), {
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        onReady: () => {
          if (!disposed) {
            void eventsRef.current.onReady();
          }
        },
        onError: fail,
      }).then((created) => {
        if (disposed) {
          created.dispose();
          return;
        }
        world = created;
        worldRef.current = created;
        layout(created, host, insetsRef.current);
        resizeObserver.observe(host);
      }, fail);
    } catch (error) {
      fail(error);
    }

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      document.removeEventListener("gesturestart", preventGesture);
      world?.dispose();
      worldRef.current = null;
    };
  }, [sceneJson]);

  useEffect(() => {
    insetsRef.current = { top: insetTop, bottom: insetBottom };
    if (worldRef.current && hostRef.current) {
      layout(worldRef.current, hostRef.current, insetsRef.current);
    }
  }, [insetTop, insetBottom]);

  return (
    <>
      <style>{css}</style>
      <div ref={hostRef} className="island-viewer" />
    </>
  );
}

// Fit the island into the band between the header and the info card: shift the
// view centre and widen the frustum so the visible band sees what the full screen would.
function layout(world: WorldHandle, host: HTMLElement, insets: Insets) {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  world.setSize(width, height);
  const { camera } = world;
  camera.aspect = width / height;
  camera.zoom = Math.max(0.3, (height - insets.top - insets.bottom) / height);
  camera.setViewOffset(
    width,
    height,
    0,
    (insets.bottom - insets.top) / 2,
    width,
    height,
  );
  camera.updateProjectionMatrix();
}

const css = `
html, body, #root {
  margin: 0;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
}
.island-viewer { position: fixed; inset: 0; }
.island-viewer canvas { display: block; width: 100%; height: 100%; touch-action: none; }
`;
