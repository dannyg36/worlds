import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber/native';
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BASE = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';
const MODELS = [
  { name: 'DamagedHelmet', mb: 3.8, url: `${BASE}/DamagedHelmet/glTF-Binary/DamagedHelmet.glb` },
  { name: 'BoomBox', mb: 10.6, url: `${BASE}/BoomBox/glTF-Binary/BoomBox.glb` },
  { name: 'Corset', mb: 13.5, url: `${BASE}/Corset/glTF-Binary/Corset.glb` },
];

type Stats = {
  state: string;
  error: string;
  startedAt: number;
  loadMs: number | null;
  fpsAvg: number;
  fpsMin: number | null;
  dpr: string;
  env: string;
  frames: number[];
  winStart: number;
  winCount: number;
  measuring: boolean;
};

const newStats = (): Stats => ({
  state: 'loading', error: '', startedAt: performance.now(), loadMs: null,
  fpsAvg: 0, fpsMin: null, dpr: '-', env: '-', frames: [], winStart: 0, winCount: 0, measuring: false,
});

const orbit = { yaw: 0, pitch: 0 };
const log = (...a: unknown[]) => console.log('BAKE:', ...a);
const g = globalThis as unknown as { ErrorUtils?: { setGlobalHandler: (h: (e: Error, fatal?: boolean) => void) => void } };
g.ErrorUtils?.setGlobalHandler((e, fatal) => log('GLOBAL ERROR', fatal, e?.message, String(e?.stack).slice(0, 800)));

function Meter({ stats }: { stats: React.RefObject<Stats> }) {
  const { gl } = useThree();
  useEffect(() => {
    const id = setInterval(() => log('heartbeat state', stats.current.state, 'frames2s', stats.current.frames.length, 'glframe', gl.info.render.frame, 'calls', gl.info.render.calls, 'tex', gl.info.memory.textures, 'geo', gl.info.memory.geometries), 2000);
    return () => clearInterval(id);
  }, [gl, stats]);
  useEffect(() => {
    const ctx = gl.getContext();
    stats.current.dpr = `dpr ${gl.getPixelRatio()} buf ${ctx.drawingBufferWidth}x${ctx.drawingBufferHeight}`;
  }, [gl, stats]);
  useFrame(() => {
    const s = stats.current;
    const now = performance.now();
    if (s.frames.length === 0) log('Meter first frame');
    s.frames.push(now);
    while (s.frames.length && now - s.frames[0] > 2000) s.frames.shift();
    s.fpsAvg = s.frames.length > 1 ? ((s.frames.length - 1) * 1000) / (now - s.frames[0]) : 0;
    if (!s.measuring) return;
    s.winCount++;
    if (now - s.winStart >= 1000) {
      const fps = (s.winCount * 1000) / (now - s.winStart);
      s.fpsMin = s.fpsMin === null ? fps : Math.min(s.fpsMin, fps);
      s.winStart = now;
      s.winCount = 0;
    }
  });
  return null;
}

function Environment({ stats }: { stats: React.RefObject<Stats> }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    try {
      log('PMREM start');
      const pmrem = new THREE.PMREMGenerator(gl);
      const rt = pmrem.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = rt.texture;
      pmrem.dispose();
      stats.current.env = 'PMREM RoomEnvironment ok';
      log('PMREM done');
    } catch (e) {
      stats.current.env = 'PMREM failed: ' + (e as Error).message;
      log('PMREM failed', (e as Error).message);
    }
  }, [gl, scene, stats]);
  return null;
}

function ModelUseLoader({ url, stats }: { url: string; stats: React.RefObject<Stats> }) {
  log('useLoader start', url);
  const gltf = useLoader(GLTFLoader, url);
  log('useLoader done', url);
  return <Model gltf={gltf} url={url} stats={stats} />;
}

function ModelFetch({ url, stats }: { url: string; stats: React.RefObject<Stats> }) {
  const [gltf, setGltf] = useState<GLTF | null>(null);
  useEffect(() => {
    let dead = false;
    const t0 = performance.now();
    log('fetch start', url);
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        log('fetch done bytes', buf.byteLength, 'ms', Math.round(performance.now() - t0));
        const t1 = performance.now();
        new GLTFLoader().parse(
          buf,
          '',
          (g) => {
            log('parse done ms', Math.round(performance.now() - t1));
            if (!dead) setGltf(g);
          },
          (e) => {
            log('parse error', String((e as ErrorEvent)?.message ?? e));
            stats.current.state = 'error';
            stats.current.error = 'parse: ' + String((e as ErrorEvent)?.message ?? e);
          }
        );
      })
      .catch((e) => {
        log('fetch error', String(e?.message ?? e));
        stats.current.state = 'error';
        stats.current.error = 'fetch: ' + String(e?.message ?? e);
      });
    return () => {
      dead = true;
    };
  }, [url, stats]);
  return gltf ? <Model gltf={gltf} url={url} stats={stats} /> : null;
}

function Model({ gltf, url, stats }: { gltf: GLTF; url: string; stats: React.RefObject<Stats> }) {
  const group = useRef<THREE.Group>(null!);
  const phase = useRef(0);
  const [fit] = useState(() => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 2.4 / Math.max(size.x, size.y, size.z);
    return { scale, offset: center.multiplyScalar(-scale) };
  });

  useEffect(() => {
    const scene = gltf.scene;
    return () => {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
          mat.dispose();
        }
      });
      useLoader.clear(GLTFLoader, url);
    };
  }, [gltf, url]);

  useFrame((_, delta) => {
    group.current.rotation.y += delta * 0.4;
    if (phase.current < 2) log('Model useFrame phase', phase.current);
    if (phase.current === 0) {
      phase.current = 1;
      return;
    }
    if (phase.current === 1) {
      phase.current = 2;
      const s = stats.current;
      const now = performance.now();
      s.loadMs = Math.round(now - s.startedAt);
      s.state = 'ready';
      s.measuring = true;
      s.winStart = now;
      s.winCount = 0;
      s.fpsMin = null;
    }
  });

  return (
    <group ref={group} rotation={[orbit.pitch, orbit.yaw, 0]}>
      <group position={fit.offset} scale={fit.scale}>
        <primitive object={gltf.scene} />
      </group>
    </group>
  );
}

function Orbit() {
  useFrame(({ scene }) => {
    scene.rotation.x = orbit.pitch;
    scene.rotation.y = orbit.yaw;
  });
  return null;
}

class Boundary extends Component<{ stats: React.RefObject<Stats>; children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(e: Error) {
    this.props.stats.current.state = 'error';
    this.props.stats.current.error = String(e?.message ?? e);
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

export default function Bake() {
  const [sel, setSel] = useState(0);
  const [envOn, setEnvOn] = useState(true);
  const [fetchMode, setFetchMode] = useState(true);
  const stats = useRef<Stats>(newStats());
  const [view, setView] = useState<Stats>(stats.current);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const id = setInterval(() => setView({ ...stats.current }), 250);
    return () => clearInterval(id);
  }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => (last.current = { x: 0, y: 0 }),
      onPanResponderMove: (_, g) => {
        orbit.yaw += (g.dx - last.current.x) * 0.01;
        orbit.pitch = Math.max(-1.2, Math.min(1.2, orbit.pitch + (g.dy - last.current.y) * 0.01));
        last.current = { x: g.dx, y: g.dy };
      },
    })
  ).current;

  const choose = (i: number) => {
    const prevDpr = stats.current.dpr;
    const prevEnv = stats.current.env;
    stats.current = { ...newStats(), dpr: prevDpr, env: prevEnv };
    setSel(i);
  };

  return (
    <View style={styles.root} {...pan.panHandlers}>
      <Canvas style={styles.canvas} camera={{ position: [0, 0, 4], fov: 45 }} gl={{ antialias: true }}>
        <color attach="background" args={['#1b1b2a']} />
        {envOn && <Environment stats={stats} />}
        <mesh rotation={[0.5, 0.5, 0]} position={[0, -1.6, 0]}>
          <boxGeometry args={[0.4, 0.4, 0.4]} />
          <meshStandardMaterial color="hotpink" />
        </mesh>
        <ambientLight intensity={0.3} />
        <directionalLight position={[3, 4, 5]} intensity={2} />
        <Meter stats={stats} />
        <Boundary key={`${sel}-${fetchMode}`} stats={stats}>
          <Suspense fallback={null}>
            {fetchMode ? <ModelFetch url={MODELS[sel].url} stats={stats} /> : <ModelUseLoader url={MODELS[sel].url} stats={stats} />}
          </Suspense>
        </Boundary>
      </Canvas>
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.big}>{MODELS[sel].name} ({MODELS[sel].mb} MB)</Text>
        <Text style={styles.big}>state: {view.state}{view.error ? ` — ${view.error}` : ''}</Text>
        <Text style={styles.big}>load: {view.loadMs === null ? '…' : `${view.loadMs} ms`}</Text>
        <Text style={styles.big}>fps avg2s: {view.fpsAvg.toFixed(1)}  min1s: {view.fpsMin === null ? '-' : view.fpsMin.toFixed(1)}</Text>
        <Text style={styles.small}>{view.dpr}</Text>
        <Text style={styles.small}>{view.env}</Text>
      </View>
      <View style={styles.buttons}>
        <Pressable onPress={() => { stats.current = { ...newStats(), dpr: stats.current.dpr, env: stats.current.env }; setFetchMode((v) => !v); }} style={[styles.btn, { flex: 0.7 }, fetchMode && styles.btnOn]}>
          <Text style={styles.btnText}>{fetchMode ? 'fetch' : 'useLoader'}</Text>
        </Pressable>
        <Pressable onPress={() => setEnvOn((v) => !v)} style={[styles.btn, { flex: 0.6 }, envOn && styles.btnOn]}>
          <Text style={styles.btnText}>Env {envOn ? 'on' : 'off'}</Text>
        </Pressable>
        {MODELS.map((m, i) => (
          <Pressable key={m.name} onPress={() => choose(i)} style={[styles.btn, i === sel && styles.btnOn]}>
            <Text style={styles.btnText}>{m.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1b1b2a' },
  canvas: { flex: 1 },
  overlay: { position: 'absolute', top: 60, left: 12, right: 12 },
  big: { color: '#fff', fontSize: 17, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.5)', alignSelf: 'flex-start', marginBottom: 2 },
  small: { color: '#cde', fontSize: 13, backgroundColor: 'rgba(0,0,0,0.5)', alignSelf: 'flex-start' },
  buttons: { position: 'absolute', bottom: 40, left: 12, right: 12, flexDirection: 'row', gap: 8 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: '#3a3a55', alignItems: 'center' },
  btnOn: { backgroundColor: '#5b5bd6' },
  btnText: { color: '#fff', fontWeight: '700' },
});
