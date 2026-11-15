"use dom";

import type { DOMProps } from "expo/dom";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HorizontalBlurShader } from "three/addons/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/addons/shaders/VerticalBlurShader.js";

type Props = {
  modelUrl: string;
  palette: string[];
  insetTop: number;
  insetBottom: number;
  walking: boolean;
  showStats: boolean;
  onProgress: (fraction: number) => Promise<void>;
  onReady: () => Promise<void>;
  onError: (message: string) => Promise<void>;
  onTap: () => Promise<void>;
  onWalkingChange: (walking: boolean) => Promise<void>;
  dom?: DOMProps;
};

type Events = Pick<
  Props,
  "onProgress" | "onReady" | "onError" | "onTap" | "onWalkingChange"
>;

export default function WorldViewer({
  modelUrl,
  palette,
  insetTop,
  insetBottom,
  walking,
  showStats,
  onProgress,
  onReady,
  onError,
  onTap,
  onWalkingChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ReturnType<typeof createViewer> | null>(null);
  const eventsRef = useRef<Events>({
    onProgress,
    onReady,
    onError,
    onTap,
    onWalkingChange,
  });
  const paletteKey = palette.join(",");

  useEffect(() => {
    eventsRef.current = {
      onProgress,
      onReady,
      onError,
      onTap,
      onWalkingChange,
    };
  });

  useEffect(() => {
    const viewer = createViewer(hostRef.current!, modelUrl, showStats, {
      onProgress: (fraction) => eventsRef.current.onProgress(fraction),
      onReady: () => eventsRef.current.onReady(),
      onError: (message) => eventsRef.current.onError(message),
      onTap: () => eventsRef.current.onTap(),
      onWalkingChange: (value) => eventsRef.current.onWalkingChange(value),
    });
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [modelUrl, showStats]);

  useEffect(() => {
    viewerRef.current?.setPalette(paletteKey.split(","));
  }, [paletteKey, modelUrl, showStats]);

  useEffect(() => {
    viewerRef.current?.setInsets(insetTop, insetBottom);
  }, [insetTop, insetBottom, modelUrl, showStats]);

  useEffect(() => {
    viewerRef.current?.setWalking(walking);
  }, [walking, modelUrl, showStats]);

  return (
    <>
      <style>{css}</style>
      <div ref={hostRef} className="world-viewer" />
    </>
  );
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
.world-viewer { position: fixed; inset: 0; }
.world-viewer canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.world-joystick {
  position: absolute;
  left: 28px;
  width: 132px;
  height: 132px;
  border-radius: 66px;
  background: rgba(255, 255, 255, 0.16);
  -webkit-backdrop-filter: blur(18px) saturate(1.6);
  backdrop-filter: blur(18px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  touch-action: none;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 300ms ease, transform 300ms ease;
  pointer-events: none;
}
.world-joystick.visible { opacity: 1; transform: scale(1); pointer-events: auto; }
.world-joystick-knob {
  position: absolute;
  left: 37px;
  top: 37px;
  width: 58px;
  height: 58px;
  border-radius: 29px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  transition: transform 180ms ease;
}
.world-joystick.dragging .world-joystick-knob { transition: none; }
.world-stats {
  position: absolute;
  left: 12px;
  top: 110px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font: 600 12px/1.45 ui-monospace, Menlo, monospace;
  white-space: pre;
  pointer-events: none;
}
`;

const backdropVertex = `
varying vec3 vDirection;
void main() {
  vDirection = position;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
}
`;

const backdropFragment = `
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uGround;
varying vec3 vDirection;
void main() {
  float y = normalize(vDirection).y;
  vec3 color = y > 0.0
    ? mix(uHorizon, uSky, pow(smoothstep(0.0, 0.9, y), 0.75))
    : mix(uHorizon, uGround, pow(smoothstep(0.0, 0.35, -y), 0.8));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}
`;

const groundVertex = `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const groundFragment = `
uniform vec3 uGround;
uniform vec3 uHorizon;
varying vec2 vLocal;
void main() {
  float radius = length(vLocal);
  vec3 color = mix(uGround, uHorizon, smoothstep(0.15, 1.0, radius) * 0.55);
  gl_FragColor = vec4(color, 1.0 - smoothstep(0.2, 1.0, radius));
  #include <colorspace_fragment>
}
`;

const contactVertex = `
varying float vHeight;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vHeight = world.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const contactFragment = `
uniform float uFar;
uniform vec3 uColor;
varying float vHeight;
void main() {
  float strength = 1.0 - clamp(vHeight / uFar, 0.0, 1.0);
  gl_FragColor = vec4(uColor, strength * strength);
}
`;

const heightFragment = `
uniform vec2 uRange;
varying float vHeight;
void main() {
  float value = clamp((vHeight - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0) * 65535.0;
  float high = floor(value / 256.0);
  gl_FragColor = vec4(high / 255.0, (value - high * 256.0) / 255.0, 0.0, 1.0);
}
`;

const revealNoise = `
uniform float uReveal;
uniform vec3 uRevealColor;
uniform vec2 uRevealRange;
varying vec3 vRevealPosition;
float revealHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float revealNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(revealHash(i), revealHash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(revealHash(i + vec3(0.0, 1.0, 0.0)), revealHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(revealHash(i + vec3(0.0, 0.0, 1.0)), revealHash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(revealHash(i + vec3(0.0, 1.0, 1.0)), revealHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
`;

const revealCut = `
float revealLine = mix(uRevealRange.x, uRevealRange.y, uReveal);
float revealDistance = vRevealPosition.y + (revealNoise(vRevealPosition * 7.0) - 0.5) * 0.22 - revealLine;
if (revealDistance > 0.0) discard;
float revealEdge = 1.0 - smoothstep(0.0, 0.07, -revealDistance);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uRevealColor * 2.4, revealEdge);
`;

const textureSlots = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
] as const;

const eyeHeight = 0.075;
const walkSpeed = 0.34;
const homePolar = 1.08;
const homeAzimuth = 0.62;

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function clamp01(t: number) {
  return Math.min(Math.max(t, 0), 1);
}

function damp(current: number, target: number, lambda: number, dt: number) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function shortestAngle(from: number, to: number) {
  const delta = (to - from) % (Math.PI * 2);
  return (
    from +
    (delta > Math.PI
      ? delta - Math.PI * 2
      : delta < -Math.PI
        ? delta + Math.PI * 2
        : delta)
  );
}

function createViewer(
  host: HTMLDivElement,
  modelUrl: string,
  showStats: boolean,
  events: Events,
) {
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute(
    "content",
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
  );
  const preventGesture = (event: Event) => event.preventDefault();
  document.addEventListener("gesturestart", preventGesture);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
  camera.position.set(0, 2, 8);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.85;

  const colors = {
    sky: new THREE.Color(),
    horizon: new THREE.Color(),
    ground: new THREE.Color(),
    shadow: new THREE.Color(),
    accent: new THREE.Color(),
  };

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 0.75);
  const sun = new THREE.DirectionalLight(0xfff2e0, 1.5);
  sun.position.set(2.5, 4, 3);
  scene.add(hemisphere, sun);

  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        uSky: { value: colors.sky },
        uHorizon: { value: colors.horizon },
        uGround: { value: colors.ground },
      },
      vertexShader: backdropVertex,
      fragmentShader: backdropFragment,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -3;
  scene.add(backdrop);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.ShaderMaterial({
      uniforms: {
        uGround: { value: colors.ground },
        uHorizon: { value: colors.horizon },
      },
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
      transparent: true,
      depthWrite: false,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.scale.setScalar(7);
  ground.renderOrder = -2;
  scene.add(ground);

  const shadowResolution = 512;
  const shadowTarget = new THREE.WebGLRenderTarget(
    shadowResolution,
    shadowResolution,
  );
  const shadowBlurTarget = new THREE.WebGLRenderTarget(
    shadowResolution,
    shadowResolution,
  );
  shadowTarget.texture.generateMipmaps = false;
  shadowBlurTarget.texture.generateMipmaps = false;
  const shadowGroup = new THREE.Group();
  shadowGroup.rotation.x = Math.PI / 2;
  shadowGroup.position.y = 0.002;
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTarget.texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    opacity: 0,
  });
  let shadowPlane: THREE.Mesh | null = null;
  scene.add(shadowGroup);
  const contactMaterial = new THREE.ShaderMaterial({
    uniforms: { uFar: { value: 0.5 }, uColor: { value: colors.shadow } },
    vertexShader: contactVertex,
    fragmentShader: contactFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const horizontalBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
  const verticalBlur = new THREE.ShaderMaterial(VerticalBlurShader);
  horizontalBlur.depthTest = false;
  verticalBlur.depthTest = false;

  const revealUniforms = {
    uReveal: { value: 0 },
    uRevealColor: { value: colors.accent },
    uRevealRange: { value: new THREE.Vector2(-0.1, 2.1) },
  };
  const baseMaterials = new Map<
    THREE.Mesh,
    THREE.Material | THREE.Material[]
  >();

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.8;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.9;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = 1.47;
  controls.autoRotateSpeed = 0;

  const raycaster = new THREE.Raycaster();
  const ripple = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 1, 48),
    new THREE.MeshBasicMaterial({
      color: colors.accent,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  ripple.visible = false;
  ripple.renderOrder = 10;
  scene.add(ripple);
  let rippleStart = -Infinity;

  const joystick = document.createElement("div");
  joystick.className = "world-joystick";
  const knob = document.createElement("div");
  knob.className = "world-joystick-knob";
  joystick.appendChild(knob);
  host.appendChild(joystick);

  const stats = showStats ? document.createElement("div") : null;
  if (stats) {
    stats.className = "world-stats";
    host.appendChild(stats);
  }

  let model: THREE.Object3D | null = null;
  const bounds = new THREE.Box3(
    new THREE.Vector3(-1, 0, -1),
    new THREE.Vector3(1, 2, 1),
  );
  let radius = 1;
  const home = { target: new THREE.Vector3(0, 0.9, 0), distance: 6 };
  let width = 1;
  let height = 1;
  let insets = { top: 0, bottom: 0 };
  let disposed = false;
  let ready = false;
  let readyPending = false;
  let entranceStart = -Infinity;
  let revealDone = false;
  let wantsWalking = false;
  let interacting = false;
  let lastInteraction = 0;
  let loadStartedAt = performance.now();
  let loadMs = 0;

  type Flight = {
    start: number;
    duration: number;
    ease: (t: number) => number;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    from: THREE.Spherical;
    to: THREE.Spherical;
  };
  let flight: Flight | null = null;

  type Transition = {
    start: number;
    duration: number;
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromQuaternion: THREE.Quaternion;
    toQuaternion: THREE.Quaternion;
    done: () => void;
  };
  let transition: Transition | null = null;

  type HeightField = {
    size: number;
    data: Float32Array;
    origin: THREE.Vector3;
    right: THREE.Vector3;
    up: THREE.Vector3;
    extent: number;
  };
  let heightField: HeightField | null = null;
  const walk = {
    active: false,
    position: new THREE.Vector3(),
    ground: 0,
    yaw: 0,
    pitch: -0.08,
    velocity: new THREE.Vector3(),
    lookVelocity: new THREE.Vector2(),
    looking: false,
    lastLook: new THREE.Vector2(),
    lastLookTime: 0,
    stick: new THREE.Vector2(),
    destination: null as THREE.Vector3 | null,
    saved: null as { position: THREE.Vector3; target: THREE.Vector3 } | null,
    phase: 0,
  };

  function setPalette(palette: string[]) {
    const parsed = palette.map((hex) => new THREE.Color(hex));
    const byLightness = [...parsed].sort(
      (a, b) =>
        a.getHSL({ h: 0, s: 0, l: 0 }).l - b.getHSL({ h: 0, s: 0, l: 0 }).l,
    );
    const darkest = byLightness[0];
    const lightest = byLightness[byLightness.length - 1];
    const middle = byLightness[Math.floor(byLightness.length / 2)];
    const accent = [...parsed].sort((a, b) => {
      const ha = a.getHSL({ h: 0, s: 0, l: 0 });
      const hb = b.getHSL({ h: 0, s: 0, l: 0 });
      return (
        hb.s * (1 - Math.abs(hb.l - 0.55)) - ha.s * (1 - Math.abs(ha.l - 0.55))
      );
    })[0];
    const white = new THREE.Color(1, 1, 1);
    colors.sky.copy(lightest).lerp(white, 0.3);
    colors.horizon.copy(middle).lerp(lightest, 0.45).lerp(white, 0.12);
    colors.ground.copy(middle).lerp(darkest, 0.35).lerp(colors.horizon, 0.35);
    colors.shadow.copy(darkest).multiplyScalar(0.35);
    colors.accent.copy(accent).lerp(white, 0.2);
    hemisphere.color.copy(colors.sky);
    hemisphere.groundColor.copy(colors.ground);
    document.body.style.backgroundColor =
      "#" + colors.horizon.getHexString(THREE.SRGBColorSpace);
    if (model && revealDone) {
      renderContactShadow();
    }
  }

  function setInsets(top: number, bottom: number) {
    insets = { top, bottom };
    resize();
  }

  function applyViewOffset() {
    const offset = walk.active ? 0 : (insets.bottom - insets.top) / 2;
    camera.aspect = width / height;
    camera.setViewOffset(width, height, 0, offset, width, height);
    camera.updateProjectionMatrix();
  }

  function fitDistance() {
    const visible = Math.max(
      0.3,
      (height - insets.top - insets.bottom) / height,
    );
    const halfVertical = Math.atan(
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * visible,
    );
    const halfHorizontal = Math.atan(
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect,
    );
    return (radius / Math.sin(Math.min(halfVertical, halfHorizontal))) * 1.04;
  }

  function resize() {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    applyViewOffset();
    if (model) {
      const previous = home.distance;
      home.distance = fitDistance();
      controls.maxDistance = home.distance * 2.2;
      if (
        !walk.active &&
        !interacting &&
        lastInteraction === 0 &&
        !flight &&
        revealDone &&
        Math.abs(previous - home.distance) > 0.01
      ) {
        flyTo(
          home.target,
          new THREE.Spherical(
            home.distance,
            homePolar,
            controls.getAzimuthalAngle(),
          ),
          600,
          easeInOutCubic,
        );
      }
    }
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  function sphericalAround(target: THREE.Vector3) {
    return new THREE.Spherical().setFromVector3(
      camera.position.clone().sub(target),
    );
  }

  function flyTo(
    target: THREE.Vector3,
    to: THREE.Spherical,
    duration: number,
    ease: (t: number) => number,
  ) {
    const from = sphericalAround(controls.target);
    to.theta = shortestAngle(from.theta, to.theta);
    flight = {
      start: performance.now(),
      duration,
      ease,
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
      from,
      to,
    };
  }

  function stepFlight(now: number) {
    if (!flight) {
      return false;
    }
    const t = clamp01((now - flight.start) / flight.duration);
    const e = flight.ease(t);
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
    const spherical = new THREE.Spherical(
      THREE.MathUtils.lerp(flight.from.radius, flight.to.radius, e),
      THREE.MathUtils.lerp(flight.from.phi, flight.to.phi, e),
      THREE.MathUtils.lerp(flight.from.theta, flight.to.theta, e),
    );
    camera.position.setFromSpherical(spherical).add(controls.target);
    camera.lookAt(controls.target);
    if (t >= 1) {
      flight = null;
    }
    return true;
  }

  function markInteraction() {
    lastInteraction = performance.now();
  }

  controls.addEventListener("start", () => {
    interacting = true;
    flight = null;
    markInteraction();
  });
  controls.addEventListener("end", () => {
    interacting = false;
    markInteraction();
  });

  function clampTarget() {
    const before = controls.target.clone();
    const margin = radius * 0.3;
    controls.target.x = THREE.MathUtils.clamp(
      controls.target.x,
      bounds.min.x - margin,
      bounds.max.x + margin,
    );
    controls.target.z = THREE.MathUtils.clamp(
      controls.target.z,
      bounds.min.z - margin,
      bounds.max.z + margin,
    );
    controls.target.y = THREE.MathUtils.clamp(
      controls.target.y,
      0,
      bounds.max.y,
    );
    camera.position.add(controls.target.clone().sub(before));
  }

  function renderContactShadow() {
    if (!model || !shadowPlane) {
      return;
    }
    const shadowCamera = shadowGroup.children.find(
      (child): child is THREE.OrthographicCamera =>
        child instanceof THREE.OrthographicCamera,
    );
    if (!shadowCamera) {
      return;
    }
    const blurPlane = new THREE.Mesh(shadowPlane.geometry);
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    const previousToneMapping = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    scene.overrideMaterial = contactMaterial;
    shadowCamera.layers.set(1);
    renderer.setRenderTarget(shadowTarget);
    renderer.clear();
    renderer.render(scene, shadowCamera);
    scene.overrideMaterial = null;
    for (const amount of [2.2, 0.9]) {
      blurPlane.material = horizontalBlur;
      horizontalBlur.uniforms.tDiffuse.value = shadowTarget.texture;
      horizontalBlur.uniforms.h.value = amount / 256;
      renderer.setRenderTarget(shadowBlurTarget);
      renderer.render(blurPlane, shadowCamera);
      blurPlane.material = verticalBlur;
      verticalBlur.uniforms.tDiffuse.value = shadowBlurTarget.texture;
      verticalBlur.uniforms.v.value = amount / 256;
      renderer.setRenderTarget(shadowTarget);
      renderer.render(blurPlane, shadowCamera);
    }
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousAlpha);
    renderer.toneMapping = previousToneMapping;
  }

  function buildHeightField(): HeightField {
    const size = 256;
    const target = new THREE.WebGLRenderTarget(size, size);
    const extent =
      Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 1.04;
    const top = bounds.max.y + 0.5;
    const orthographic = new THREE.OrthographicCamera(
      -extent / 2,
      extent / 2,
      extent / 2,
      -extent / 2,
      0.01,
      top - bounds.min.y + 1,
    );
    const center = bounds.getCenter(new THREE.Vector3());
    orthographic.position.set(center.x, top, center.z);
    orthographic.up.set(0, 0, -1);
    orthographic.lookAt(center.x, bounds.min.y, center.z);
    orthographic.updateMatrixWorld();
    orthographic.layers.set(1);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uRange: { value: new THREE.Vector2(bounds.min.y, bounds.max.y) },
      },
      vertexShader: contactVertex,
      fragmentShader: heightFragment,
      side: THREE.DoubleSide,
    });
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    scene.overrideMaterial = material;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, orthographic);
    scene.overrideMaterial = null;
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousAlpha);
    target.dispose();
    material.dispose();
    const data = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      data[i] =
        pixels[i * 4 + 3] === 0
          ? Number.NaN
          : bounds.min.y +
            ((pixels[i * 4] * 256 + pixels[i * 4 + 1]) / 65535) *
              (bounds.max.y - bounds.min.y);
    }
    return {
      size,
      data,
      extent,
      origin: orthographic.position.clone(),
      right: new THREE.Vector3().setFromMatrixColumn(
        orthographic.matrixWorld,
        0,
      ),
      up: new THREE.Vector3().setFromMatrixColumn(orthographic.matrixWorld, 1),
    };
  }

  function heightAt(x: number, z: number) {
    if (!heightField) {
      return null;
    }
    const offset = new THREE.Vector3(
      x - heightField.origin.x,
      0,
      z - heightField.origin.z,
    );
    const u = offset.dot(heightField.right) / heightField.extent + 0.5;
    const v = offset.dot(heightField.up) / heightField.extent + 0.5;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) {
      return null;
    }
    const value =
      heightField.data[
        Math.floor(v * heightField.size) * heightField.size +
          Math.floor(u * heightField.size)
      ];
    return Number.isNaN(value) ? null : value;
  }

  function findSpawn() {
    const center = bounds.getCenter(new THREE.Vector3());
    const step = (heightField?.extent ?? 2) / 128;
    for (let ring = 0; ring < 128; ring++) {
      for (let i = 0; i < Math.max(1, ring * 8); i++) {
        const angle = (i / Math.max(1, ring * 8)) * Math.PI * 2;
        const x = center.x + Math.cos(angle) * ring * step;
        const z = center.z + Math.sin(angle) * ring * step;
        const here = heightAt(x, z);
        if (here === null) {
          continue;
        }
        const neighbors = [
          [step, 0],
          [-step, 0],
          [0, step],
          [0, -step],
        ].map(([dx, dz]) => heightAt(x + dx * 3, z + dz * 3));
        if (
          neighbors.every(
            (value) => value !== null && Math.abs(value - here) < 0.03,
          )
        ) {
          return new THREE.Vector3(x, here, z);
        }
      }
    }
    return null;
  }

  function walkPose(position: THREE.Vector3, groundHeight: number) {
    return {
      position: new THREE.Vector3(
        position.x,
        groundHeight + eyeHeight,
        position.z,
      ),
      quaternion: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(walk.pitch, walk.yaw, 0, "YXZ"),
      ),
    };
  }

  function startTransition(
    toPosition: THREE.Vector3,
    toQuaternion: THREE.Quaternion,
    duration: number,
    done: () => void,
  ) {
    transition = {
      start: performance.now(),
      duration,
      fromPosition: camera.position.clone(),
      toPosition,
      fromQuaternion: camera.quaternion.clone(),
      toQuaternion,
      done,
    };
  }

  function setWalking(value: boolean) {
    wantsWalking = value;
    if (!ready || !revealDone || value === walk.active) {
      return;
    }
    if (value) {
      heightField ??= buildHeightField();
      const spawn = findSpawn();
      if (!spawn) {
        wantsWalking = false;
        void events.onWalkingChange(false);
        return;
      }
      flight = null;
      walk.saved = {
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
      const forward = controls.target.clone().sub(camera.position);
      walk.yaw = Math.atan2(-forward.x, -forward.z);
      walk.pitch = -0.08;
      walk.position.set(spawn.x, 0, spawn.z);
      walk.ground = spawn.y;
      walk.velocity.set(0, 0, 0);
      walk.lookVelocity.set(0, 0);
      walk.destination = null;
      walk.active = true;
      controls.enabled = false;
      controls.autoRotate = false;
      applyViewOffset();
      const pose = walkPose(walk.position, walk.ground);
      startTransition(pose.position, pose.quaternion, 1700, () => {
        joystick.classList.add("visible");
      });
      positionJoystick();
    } else {
      joystick.classList.remove("visible");
      walk.stick.set(0, 0);
      const saved = walk.saved ?? {
        position: home.target
          .clone()
          .add(
            new THREE.Vector3().setFromSpherical(
              new THREE.Spherical(home.distance, homePolar, homeAzimuth),
            ),
          ),
        target: home.target.clone(),
      };
      const look = new THREE.Matrix4().lookAt(
        saved.position,
        saved.target,
        new THREE.Vector3(0, 1, 0),
      );
      startTransition(
        saved.position,
        new THREE.Quaternion().setFromRotationMatrix(look),
        1400,
        () => {
          walk.active = false;
          controls.target.copy(saved.target);
          controls.enabled = true;
          applyViewOffset();
          markInteraction();
        },
      );
    }
  }

  function positionJoystick() {
    joystick.style.bottom = Math.max(insets.bottom, 24) + 24 + "px";
  }

  function updateStick(event: PointerEvent) {
    const rect = joystick.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.min(Math.hypot(dx, dy), 42);
    const angle = Math.atan2(dy, dx);
    const x = Math.cos(angle) * length;
    const y = Math.sin(angle) * length;
    knob.style.transform = "translate(" + x + "px, " + y + "px)";
    walk.stick.set(x / 42, -y / 42);
    walk.destination = null;
  }
  joystick.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    joystick.setPointerCapture(event.pointerId);
    joystick.classList.add("dragging");
    updateStick(event);
  });
  joystick.addEventListener("pointermove", (event) => {
    if (joystick.classList.contains("dragging")) {
      updateStick(event);
    }
  });
  const releaseStick = () => {
    joystick.classList.remove("dragging");
    knob.style.transform = "translate(0px, 0px)";
    walk.stick.set(0, 0);
  };
  joystick.addEventListener("pointerup", releaseStick);
  joystick.addEventListener("pointercancel", releaseStick);

  const pointers = new Map<number, { x: number; y: number; time: number }>();
  let tapCandidate: { x: number; y: number; time: number } | null = null;
  canvas.addEventListener("pointerdown", (event) => {
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    });
    tapCandidate =
      pointers.size === 1
        ? { x: event.clientX, y: event.clientY, time: performance.now() }
        : null;
    if (walk.active && !transition && pointers.size === 1) {
      walk.looking = true;
      walk.lastLook.set(event.clientX, event.clientY);
      walk.lastLookTime = performance.now();
      walk.lookVelocity.set(0, 0);
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!walk.active || !walk.looking || pointers.size !== 1) {
      return;
    }
    const now = performance.now();
    const dx = event.clientX - walk.lastLook.x;
    const dy = event.clientY - walk.lastLook.y;
    const dt = Math.max(1, now - walk.lastLookTime) / 1000;
    walk.yaw += dx * 0.0045;
    walk.pitch = THREE.MathUtils.clamp(walk.pitch + dy * 0.0045, -1.1, 0.9);
    walk.lookVelocity.set((dx * 0.0045) / dt, (dy * 0.0045) / dt);
    walk.lastLook.set(event.clientX, event.clientY);
    walk.lastLookTime = now;
  });
  const releasePointer = (event: PointerEvent) => {
    const candidate = tapCandidate;
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      walk.looking = false;
      if (performance.now() - walk.lastLookTime > 80) {
        walk.lookVelocity.set(0, 0);
      }
    }
    if (
      event.type === "pointerup" &&
      candidate &&
      Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) <
        10 &&
      performance.now() - candidate.time < 350
    ) {
      walk.lookVelocity.set(0, 0);
      handleTap(event.clientX, event.clientY);
    }
    tapCandidate = null;
  };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);

  function handleTap(x: number, y: number) {
    if (!model || !ready || transition) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((x - rect.left) / rect.width) * 2 - 1,
        -((y - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = raycaster.intersectObject(model, true)[0];
    markInteraction();
    if (!hit) {
      if (!walk.active) {
        flyTo(
          home.target,
          new THREE.Spherical(
            home.distance,
            homePolar,
            controls.getAzimuthalAngle(),
          ),
          1100,
          easeInOutCubic,
        );
      }
      return;
    }
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 1, 0);
    ripple.position.copy(hit.point).addScaledVector(normal, 0.004);
    ripple.lookAt(hit.point.clone().add(normal));
    rippleStart = performance.now();
    ripple.visible = true;
    void events.onTap();
    if (walk.active) {
      if (heightAt(hit.point.x, hit.point.z) !== null) {
        walk.destination = new THREE.Vector3(hit.point.x, 0, hit.point.z);
      }
      return;
    }
    const current = sphericalAround(controls.target);
    const distance = Math.max(
      controls.minDistance * 1.15,
      Math.min(current.radius * 0.55, radius * 1.6),
    );
    const to = new THREE.Spherical(
      distance,
      Math.min(current.phi, 1.3),
      current.theta,
    );
    flyTo(hit.point, to, 1100, easeInOutCubic);
  }

  function stepWalk(dt: number) {
    if (!walk.looking && walk.lookVelocity.lengthSq() > 0) {
      walk.yaw += walk.lookVelocity.x * dt;
      walk.pitch = THREE.MathUtils.clamp(
        walk.pitch + walk.lookVelocity.y * dt,
        -1.1,
        0.9,
      );
      walk.lookVelocity.multiplyScalar(Math.exp(-dt * 5));
      if (walk.lookVelocity.lengthSq() < 1e-4) {
        walk.lookVelocity.set(0, 0);
      }
    }
    const forward = new THREE.Vector3(
      -Math.sin(walk.yaw),
      0,
      -Math.cos(walk.yaw),
    );
    const right = new THREE.Vector3(Math.cos(walk.yaw), 0, -Math.sin(walk.yaw));
    const desired = new THREE.Vector3();
    if (walk.stick.lengthSq() > 0.0025) {
      desired
        .addScaledVector(forward, walk.stick.y)
        .addScaledVector(right, walk.stick.x)
        .multiplyScalar(walkSpeed);
    } else if (walk.destination) {
      const toDestination = walk.destination.clone().sub(walk.position).setY(0);
      if (toDestination.length() < 0.03) {
        walk.destination = null;
      } else {
        desired.copy(toDestination.normalize().multiplyScalar(walkSpeed * 1.4));
        const heading = shortestAngle(
          walk.yaw,
          Math.atan2(-toDestination.x, -toDestination.z),
        );
        walk.yaw = damp(walk.yaw, heading, 4, dt);
      }
    }
    walk.velocity.lerp(desired, 1 - Math.exp(-dt * 9));
    const step = walk.velocity.clone().multiplyScalar(dt);
    const tryMove = (dx: number, dz: number) => {
      const next = heightAt(walk.position.x + dx, walk.position.z + dz);
      if (next === null || next - walk.ground > 0.05) {
        return null;
      }
      return next;
    };
    let next = tryMove(step.x, step.z);
    if (next !== null) {
      walk.position.x += step.x;
      walk.position.z += step.z;
    } else if ((next = tryMove(step.x, 0)) !== null) {
      walk.position.x += step.x;
      walk.velocity.z = 0;
    } else if ((next = tryMove(0, step.z)) !== null) {
      walk.position.z += step.z;
      walk.velocity.x = 0;
    } else {
      walk.velocity.set(0, 0, 0);
      walk.destination = null;
    }
    const groundHere =
      heightAt(walk.position.x, walk.position.z) ?? walk.ground;
    walk.ground = damp(walk.ground, groundHere, 14, dt);
    const speed = walk.velocity.length();
    walk.phase += speed * dt * 38;
    const bob = Math.sin(walk.phase) * 0.0022 * Math.min(1, speed / walkSpeed);
    camera.position.set(
      walk.position.x,
      walk.ground + eyeHeight + bob,
      walk.position.z,
    );
    camera.quaternion.setFromEuler(
      new THREE.Euler(walk.pitch, walk.yaw, 0, "YXZ"),
    );
  }

  function prepareModel(object: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const scale = 2 / Math.max(size.x, size.y, size.z, 1e-6);
    const center = box.getCenter(new THREE.Vector3());
    object.scale.multiplyScalar(scale);
    object.position.set(
      -center.x * scale,
      -box.min.y * scale,
      -center.z * scale,
    );
    object.updateMatrixWorld(true);
    bounds.setFromObject(object);
    radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    const anisotropy = renderer.capabilities.getMaxAnisotropy();
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      child.layers.enable(1);
      const materials: THREE.Material[] = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const material of materials) {
        for (const slot of textureSlots) {
          const texture = (
            material as Partial<
              Record<(typeof textureSlots)[number], THREE.Texture | null>
            >
          )[slot];
          if (texture) {
            texture.anisotropy = anisotropy;
          }
        }
      }
    });
    home.target.set(0, (bounds.min.y + bounds.max.y) * 0.45, 0);
    home.distance = fitDistance();
    controls.minDistance = radius * 0.3;
    controls.maxDistance = home.distance * 2.2;
    revealUniforms.uRevealRange.value.set(
      bounds.min.y - 0.12,
      bounds.max.y + 0.12,
    );

    const footprint =
      Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 1.9;
    const planeGeometry = new THREE.PlaneGeometry(footprint, footprint).rotateX(
      Math.PI / 2,
    );
    shadowPlane = new THREE.Mesh(planeGeometry, shadowMaterial);
    shadowPlane.scale.set(1, -1, 1);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.renderOrder = -1;
    const shadowCamera = new THREE.OrthographicCamera(
      -footprint / 2,
      footprint / 2,
      footprint / 2,
      -footprint / 2,
      0,
      Math.max(0.35, (bounds.max.y - bounds.min.y) * 0.5),
    );
    contactMaterial.uniforms.uFar.value = shadowCamera.far;
    shadowGroup.add(shadowPlane, shadowCamera);
    scene.add(object);
    scene.updateMatrixWorld(true);
    renderContactShadow();
  }

  function applyRevealMaterials(object: THREE.Object3D) {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      baseMaterials.set(child, child.material);
      const reveal = (material: THREE.Material) => {
        const clone = material.clone();
        clone.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, revealUniforms);
          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying vec3 vRevealPosition;",
            )
            .replace(
              "#include <project_vertex>",
              "#include <project_vertex>\nvRevealPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
            );
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\n" + revealNoise)
            .replace(
              "#include <dithering_fragment>",
              "#include <dithering_fragment>\n" + revealCut,
            );
        };
        return clone;
      };
      child.material = Array.isArray(child.material)
        ? child.material.map(reveal)
        : reveal(child.material);
    });
  }

  function restoreBaseMaterials() {
    for (const [mesh, material] of baseMaterials) {
      const reveal = mesh.material;
      mesh.material = material;
      for (const used of Array.isArray(reveal) ? reveal : [reveal]) {
        used.dispose();
      }
    }
    baseMaterials.clear();
  }

  async function setup(object: THREE.Object3D) {
    prepareModel(object);
    model = object;
    const start = new THREE.Spherical(
      home.distance * 1.75,
      homePolar - 0.42,
      homeAzimuth + 1.25,
    );
    controls.target.copy(home.target);
    camera.position.setFromSpherical(start).add(home.target);
    camera.lookAt(home.target);
    await renderer.compileAsync(scene, camera);
    applyRevealMaterials(object);
    await renderer.compileAsync(scene, camera);
    if (disposed) {
      return;
    }
    loadMs = Math.round(performance.now() - loadStartedAt);
    readyPending = true;
  }

  const draco = new DRACOLoader().setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
  );
  const loader = new GLTFLoader()
    .setDRACOLoader(draco)
    .setMeshoptDecoder(MeshoptDecoder);
  let lastProgress = 0;
  let lastProgressAt = 0;
  loader.load(
    modelUrl,
    (gltf) => {
      if (disposed) {
        return;
      }
      setup(gltf.scene).catch((error: unknown) => fail(error));
    },
    (event) => {
      if (!event.lengthComputable || event.total === 0) {
        return;
      }
      const fraction = event.loaded / event.total;
      const now = performance.now();
      if (
        fraction === 1 ||
        (fraction - lastProgress > 0.02 && now - lastProgressAt > 120)
      ) {
        lastProgress = fraction;
        lastProgressAt = now;
        void events.onProgress(fraction);
      }
    },
    (error) => fail(error),
  );

  function fail(error: unknown) {
    if (disposed) {
      return;
    }
    console.error("World model failed to load", modelUrl, error);
    void events.onError("We couldn't load this world's 3D model.");
  }

  const contextLost = (event: Event) => {
    event.preventDefault();
    void events.onError("The 3D view was interrupted.");
  };
  canvas.addEventListener("webglcontextlost", contextLost);

  const frameTimes: number[] = [];
  let windowStart = 0;
  let windowFrames = 0;
  let minimumFps = Infinity;
  let lastQualityCheck = 0;
  let previousTime = performance.now();
  let frame = 0;

  function measure(now: number) {
    frameTimes.push(now);
    while (frameTimes.length > 0 && now - frameTimes[0] > 2000) {
      frameTimes.shift();
    }
    const averageFps =
      frameTimes.length > 1
        ? ((frameTimes.length - 1) * 1000) / (now - frameTimes[0])
        : 0;
    if (!ready) {
      return;
    }
    windowFrames++;
    if (now - windowStart >= 1000) {
      if (now - entranceStart > 3500) {
        minimumFps = Math.min(
          minimumFps,
          (windowFrames * 1000) / (now - windowStart),
        );
      }
      windowStart = now;
      windowFrames = 0;
    }
    if (now - entranceStart > 4000 && now - lastQualityCheck > 2000) {
      lastQualityCheck = now;
      if (averageFps < 48 && pixelRatio > 1.5) {
        pixelRatio = Math.max(1.5, pixelRatio - 0.5);
        renderer.setPixelRatio(pixelRatio);
        resize();
      }
    }
    if (stats) {
      stats.textContent = [
        "fps " +
          averageFps.toFixed(1) +
          "  min " +
          (minimumFps === Infinity ? "-" : minimumFps.toFixed(1)),
        "load " + loadMs + " ms",
        "dpr " + pixelRatio + "  " + canvas.width + "x" + canvas.height,
        "tris " +
          renderer.info.render.triangles +
          "  calls " +
          renderer.info.render.calls,
      ].join("\n");
    }
  }

  function tick(now: number) {
    if (disposed) {
      return;
    }
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - previousTime) / 1000);
    previousTime = now;

    if (model && ready && !revealDone) {
      const reveal = easeInOutCubic(
        clamp01((now - entranceStart - 200) / 2300),
      );
      revealUniforms.uReveal.value = reveal;
      shadowMaterial.opacity = reveal * 0.95;
      if (reveal >= 1) {
        revealDone = true;
        restoreBaseMaterials();
        if (wantsWalking) {
          setWalking(true);
        }
      }
    }

    if (transition) {
      const t = easeInOutCubic(
        clamp01((now - transition.start) / transition.duration),
      );
      camera.position.lerpVectors(
        transition.fromPosition,
        transition.toPosition,
        t,
      );
      camera.quaternion.slerpQuaternions(
        transition.fromQuaternion,
        transition.toQuaternion,
        t,
      );
      if (t >= 1) {
        const done = transition.done;
        transition = null;
        done();
      }
    } else if (walk.active) {
      stepWalk(dt);
    } else if (!stepFlight(now)) {
      const idleFor = now - Math.max(lastInteraction, entranceStart + 2600);
      const idle = ready && !interacting && idleFor > 4000;
      controls.autoRotate = idle;
      controls.autoRotateSpeed = idle
        ? 0.55 * clamp01((idleFor - 4000) / 2500)
        : 0;
      controls.update(dt);
      clampTarget();
    }

    if (ripple.visible) {
      const t = clamp01((now - rippleStart) / 700);
      ripple.scale.setScalar(0.02 + easeOutCubic(t) * radius * 0.09);
      (ripple.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      ripple.visible = t < 1;
    }

    renderer.render(scene, camera);
    measure(now);

    if (readyPending) {
      readyPending = false;
      ready = true;
      entranceStart = now;
      windowStart = now;
      flyTo(
        home.target,
        new THREE.Spherical(home.distance, homePolar, homeAzimuth),
        2600,
        easeOutCubic,
      );
      void events.onReady();
    }
  }
  frame = requestAnimationFrame(tick);

  function dispose() {
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    document.removeEventListener("gesturestart", preventGesture);
    canvas.removeEventListener("webglcontextlost", contextLost);
    controls.dispose();
    draco.dispose();
    restoreBaseMaterials();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          for (const slot of textureSlots) {
            (
              material as Partial<
                Record<(typeof textureSlots)[number], THREE.Texture | null>
              >
            )[slot]?.dispose();
          }
          material.dispose();
        }
      }
    });
    environment.dispose();
    pmrem.dispose();
    shadowTarget.dispose();
    shadowBlurTarget.dispose();
    contactMaterial.dispose();
    horizontalBlur.dispose();
    verticalBlur.dispose();
    renderer.dispose();
    host.replaceChildren();
  }

  return { setPalette, setInsets, setWalking, dispose };
}
