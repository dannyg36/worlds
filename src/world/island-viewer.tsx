"use dom";

import type { DOMProps } from "expo/dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { createWorld, type WorldHandle } from "@/world/island/kit/world.js";

type Props = {
  sceneJson: string;
  /** The world's photo URLs in the order they were added; vignettes point into it by index. */
  photos?: (string | null)[];
  insetTop: number;
  insetBottom: number;
  onReady: () => Promise<void>;
  onError: (message: string) => Promise<void>;
  /** A tap picked a vignette, or cleared the pick with null. */
  onSelect?: (index: number | null) => Promise<void>;
  dom?: DOMProps;
};

type Events = Pick<Props, "onReady" | "onError" | "onSelect">;
type Insets = { top: number; bottom: number };
/** What a vignette's card shows: its title, what happened, and its photos' indexes. */
type Moment = { title: string; moment: string; photos: number[] };

export default function IslandViewer({
  sceneJson,
  photos,
  insetTop,
  insetBottom,
  onReady,
  onError,
  onSelect,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<WorldHandle | null>(null);
  const insetsRef = useRef<Insets>({ top: insetTop, bottom: insetBottom });
  const eventsRef = useRef<Events>({ onReady, onError, onSelect });
  // The vignette under the mouse wins over the one picked with a tap while it lasts.
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const activeRef = useRef<number | null>(null);
  const moments = useMemo(() => readMoments(sceneJson), [sceneJson]);
  const active = hovered ?? selected;
  const moment = active === null ? undefined : moments[active];
  const urls = (moment?.photos ?? []).flatMap((index) => photos?.[index] ?? []);
  const photoKey = (photos ?? []).join("\n");

  useEffect(() => {
    eventsRef.current = { onReady, onError, onSelect };
  });

  // The card loop reads this, so the card only moves once its new content is drawn.
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Load the photos up front so a card has them the moment it opens.
  useEffect(() => {
    for (const url of photoKey.split("\n")) {
      if (url) {
        new Image().src = url;
      }
    }
  }, [photoKey]);

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
    let stopMoments = () => {};
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
        quality: "low",
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
        stopMoments = trackMoments(created, host, {
          card: () => cardRef.current,
          active: () => activeRef.current,
          insets: () => insetsRef.current,
          onHover: setHovered,
          onTap: (index) => {
            const next = index === selectedRef.current ? null : index;
            if (next !== selectedRef.current) {
              selectedRef.current = next;
              setSelected(next);
              void eventsRef.current.onSelect?.(next);
            }
          },
        });
      }, fail);
    } catch (error) {
      fail(error);
    }

    return () => {
      disposed = true;
      stopMoments();
      resizeObserver.disconnect();
      document.removeEventListener("gesturestart", preventGesture);
      world?.dispose();
      worldRef.current = null;
      selectedRef.current = null;
      setHovered(null);
      setSelected(null);
    };
  }, [sceneJson]);

  useEffect(() => {
    insetsRef.current = { top: insetTop, bottom: insetBottom };
    if (worldRef.current && hostRef.current) {
      layout(worldRef.current, hostRef.current, insetsRef.current);
    }
  }, [insetTop, insetBottom]);

  function dismiss() {
    if (selectedRef.current !== null) {
      selectedRef.current = null;
      setSelected(null);
      void eventsRef.current.onSelect?.(null);
    }
  }

  return (
    <>
      <style>{css}</style>
      <div ref={hostRef} className="island-viewer" />
      <div
        ref={cardRef}
        className="moment"
        data-pinned={hovered === null && selected !== null}
        onClick={dismiss}
      >
        {moment ? (
          <div
            key={active}
            className={urls.length > 0 ? "moment-body has-photos" : "moment-body"}
          >
            {urls.length > 0 ? (
              <div className="moment-photos" data-count={Math.min(urls.length, 3)}>
                {urls.slice(0, 3).map((url, index) => (
                  <div key={`${index}:${url}`} className="moment-photo">
                    <img
                      src={url}
                      alt=""
                      draggable={false}
                      onLoad={(event) => event.currentTarget.classList.add("loaded")}
                    />
                    {index === 2 && urls.length > 3 ? (
                      <span className="moment-more">+{urls.length - 3}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="moment-title">{moment.title}</div>
            <div className="moment-text">{moment.moment}</div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Each vignette's title, moment and photo indexes, in island order. */
function readMoments(sceneJson: string): Moment[] {
  try {
    const spec = JSON.parse(sceneJson) as { vignettes?: unknown };
    return (Array.isArray(spec.vignettes) ? spec.vignettes : []).map((vignette) => {
      const { title, moment, photos } = (vignette ?? {}) as Record<string, unknown>;
      return {
        title: typeof title === "string" ? title : "",
        moment: typeof moment === "string" ? moment : "",
        photos: Array.isArray(photos)
          ? photos.filter((photo): photo is number => Number.isInteger(photo))
          : [],
      };
    });
  } catch {
    return [];
  }
}

// createWorld frames the island for a square view. Fit that square into the band
// between the header and the info card: centre the view on the band and widen the
// frustum (zoom < 1) until the square's width and height both fit.
function layout(world: WorldHandle, host: HTMLElement, insets: Insets) {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  world.setSize(width, height);
  const { camera } = world;
  const band = height - insets.top - insets.bottom;
  camera.zoom = Math.min(1, Math.max(0.3, Math.min(band, width) / height));
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

// world.js merges every mesh on the island into shared draw calls, so the real
// geometry can't say which vignette the pointer is over. Instead, each plot gets
// an invisible cylinder this tall to pick against.
const PICK_HEIGHT = 3;
const TAP_SLOP = 8;
const TAP_MS = 500;
const CARD_GAP = 12;
const CARD_MARGIN = 12;
const RING_COLOR = "#fffaf0";

type Tracking = {
  card: () => HTMLDivElement | null;
  active: () => number | null;
  insets: () => Insets;
  onHover: (index: number | null) => void;
  onTap: (index: number | null) => void;
};

/**
 * Hover (with a mouse) and taps pick vignettes; the active one gets a ring on
 * the ground and its card is kept beside it on screen every frame, as the
 * camera moves. Returns a function that undoes all of it.
 */
function trackMoments(world: WorldHandle, host: HTMLElement, tracking: Tracking) {
  const { island, camera, scene } = world;
  if (!island || island.plots.length === 0) {
    return () => {};
  }
  const canvas = world.renderer.domElement;
  const plots = island.plots.map((plot) => ({
    ...plot,
    y: island.heightAt(plot.x, plot.z),
  }));
  const pickMaterial = new THREE.MeshBasicMaterial();
  const proxies = plots.map((plot, index) => {
    const proxy = new THREE.Mesh(
      new THREE.CylinderGeometry(plot.radius, plot.radius, PICK_HEIGHT, 24),
      pickMaterial,
    );
    proxy.position.set(plot.x, plot.y + PICK_HEIGHT / 2, plot.z);
    proxy.userData.index = index;
    proxy.updateMatrixWorld();
    return proxy;
  });
  const rings = plots.map((plot) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(plot.radius + 0.06, plot.radius + 0.22, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: RING_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    // Just above the path, which crowns at 4.6 cm.
    ring.position.set(plot.x, plot.y + 0.07, plot.z);
    ring.visible = false;
    scene.add(ring);
    return ring;
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pick(event: PointerEvent): number | null {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObjects(proxies, false);
    return hit ? (hit.object.userData.index as number) : null;
  }

  let hovering: number | null = null;
  function hover(index: number | null) {
    if (index !== hovering) {
      hovering = index;
      canvas.style.cursor = index === null ? "" : "pointer";
      tracking.onHover(index);
    }
  }
  const onMove = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.buttons === 0) {
      hover(pick(event));
    }
  };
  const onLeave = () => hover(null);

  // A tap is one quick press that barely moves; drags and pinches are the camera's.
  const presses = new Map<number, { x: number; y: number; at: number }>();
  let pinched = false;
  const onDown = (event: PointerEvent) => {
    if (presses.size === 0) {
      pinched = false;
    }
    presses.set(event.pointerId, { x: event.clientX, y: event.clientY, at: event.timeStamp });
    pinched ||= presses.size > 1;
  };
  const onUp = (event: PointerEvent) => {
    const press = presses.get(event.pointerId);
    presses.delete(event.pointerId);
    if (
      press &&
      !pinched &&
      event.button === 0 &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) <= TAP_SLOP &&
      event.timeStamp - press.at <= TAP_MS
    ) {
      tracking.onTap(pick(event));
    }
  };
  const onCancel = (event: PointerEvent) => presses.delete(event.pointerId);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);

  const point = new THREE.Vector3();
  function place(card: HTMLDivElement, index: number | null) {
    const plot = index === null ? undefined : plots[index];
    if (!plot) {
      card.style.visibility = "hidden";
      return;
    }
    // The vignette's box on screen: its plot's rim on the ground and at about head height.
    const width = host.clientWidth;
    const height = host.clientHeight;
    camera.updateMatrixWorld();
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let step = 0; step < 12; step++) {
      const angle = (step / 12) * Math.PI * 2;
      for (const lift of [0, PICK_HEIGHT * 0.8]) {
        point
          .set(
            plot.x + Math.cos(angle) * plot.radius,
            plot.y + lift,
            plot.z + Math.sin(angle) * plot.radius,
          )
          .project(camera);
        const x = ((point.x + 1) / 2) * width;
        const y = ((1 - point.y) / 2) * height;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    const behind = point.set(plot.x, plot.y, plot.z).project(camera).z > 1;
    if (behind || right < 0 || left > width || bottom < 0 || top > height) {
      card.style.visibility = "hidden";
      return;
    }
    // Above the vignette if it fits under the header; otherwise beside it, on
    // its outer side, when the screen is wide enough; otherwise below it. The
    // card always stays in the band between the header and the info card.
    const insets = tracking.insets();
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    const minY = insets.top + CARD_MARGIN;
    const maxY = Math.max(minY, height - insets.bottom - CARD_MARGIN - cardHeight);
    const middle = (left + right) / 2;
    let x = middle - cardWidth / 2;
    let y = top - CARD_GAP - cardHeight;
    if (y < minY) {
      const sides = [left - CARD_GAP - cardWidth, right + CARD_GAP];
      const side = (middle < width / 2 ? sides : sides.reverse()).find(
        (sideX) => sideX >= CARD_MARGIN && sideX + cardWidth <= width - CARD_MARGIN,
      );
      if (side === undefined) {
        y = bottom + CARD_GAP;
      } else {
        x = side;
        y = (top + bottom) / 2 - cardHeight / 2;
      }
    }
    x = Math.min(Math.max(x, CARD_MARGIN), width - CARD_MARGIN - cardWidth);
    y = Math.min(Math.max(y, minY), maxY);
    card.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    card.style.visibility = "visible";
  }

  let raf = 0;
  let last = performance.now();
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const ease = Math.min(1, ((now - last) / 1000) * 12);
    last = now;
    const active = tracking.active();
    rings.forEach((ring, index) => {
      const target = index === active ? 0.9 : 0;
      ring.material.opacity += (target - ring.material.opacity) * ease;
      ring.visible = ring.material.opacity > 0.01;
    });
    const card = tracking.card();
    if (card) {
      place(card, active);
    }
  }
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onCancel);
    canvas.style.cursor = "";
    for (const ring of rings) {
      ring.removeFromParent();
      ring.geometry.dispose();
      ring.material.dispose();
    }
    for (const proxy of proxies) {
      proxy.geometry.dispose();
    }
    pickMaterial.dispose();
  };
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

.moment {
  --serif: NotoSerifDisplay_400Regular, "Noto Serif Display", ui-serif, "New York", "Iowan Old Style", Georgia, serif;
  --sans: AlbertSans_400Regular, "Albert Sans", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
  position: fixed;
  left: 0;
  top: 0;
  width: min(300px, calc(100vw - 24px));
  visibility: hidden;
  pointer-events: none;
  will-change: transform;
}
.moment[data-pinned="true"] { pointer-events: auto; cursor: pointer; }
.moment-body {
  box-sizing: border-box;
  padding: 14px 16px 15px;
  border-radius: 22px;
  background: rgba(252, 251, 249, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 16px 40px -12px rgba(0, 0, 0, 0.32);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  backdrop-filter: blur(20px) saturate(1.2);
  color: #000;
  animation: moment-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.moment-body.has-photos { padding: 8px 8px 14px; }
.moment-body.has-photos .moment-title,
.moment-body.has-photos .moment-text { padding: 0 8px; }
.moment-photos { display: flex; gap: 6px; margin-bottom: 12px; }
.moment-photo {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  height: 132px;
  border-radius: 15px;
  overflow: hidden;
  background: #eeece6;
}
.moment-photos[data-count="3"] .moment-photo { height: 92px; }
.moment-photo img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 220ms ease;
}
.moment-photo img.loaded { opacity: 1; }
.moment-more {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.36);
  color: #fbfaf7;
  font: 500 15px/1 var(--sans);
}
.moment-title {
  font-family: var(--serif);
  font-size: 20px;
  line-height: 25px;
  letter-spacing: -0.15px;
}
.moment-text {
  margin-top: 4px;
  font-family: var(--sans);
  font-size: 15px;
  line-height: 21px;
  color: rgba(0, 0, 0, 0.58);
}
@keyframes moment-in {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
}
`;
