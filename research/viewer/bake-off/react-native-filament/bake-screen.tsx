import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Camera,
  DefaultLight,
  FilamentScene,
  FilamentView,
  ModelRenderer,
  RenderCallbackContext,
  Skybox,
  useFilamentContext,
  useModel,
} from "react-native-filament";
import { ISharedValue, useSharedValue } from "react-native-worklets-core";

const RAW =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";
const MODELS = [
  { name: "DamagedHelmet", mb: 3.8, url: `${RAW}/DamagedHelmet/glTF-Binary/DamagedHelmet.glb` },
  { name: "BoomBox", mb: 10.6, url: `${RAW}/BoomBox/glTF-Binary/BoomBox.glb` },
  { name: "Corset", mb: 13.5, url: `${RAW}/Corset/glTF-Binary/Corset.glb` },
];

type Shared = {
  frames: ISharedValue<number>;
  loaded: ISharedValue<number>;
  firstFrameAt: ISharedValue<number>;
  dragYaw: ISharedValue<number>;
  dragPitch: ISharedValue<number>;
  vpW: ISharedValue<number>;
  vpH: ISharedValue<number>;
};

function Viewer({ url, cameraZ, shared }: { url: string; cameraZ: number; shared: Shared }) {
  const { transformManager, view } = useFilamentContext();
  const source = useMemo(() => ({ uri: url }), [url]);
  const model = useModel(source);
  const rootEntity = model.state === "loaded" ? model.rootEntity : null;
  const { frames, loaded, firstFrameAt, dragYaw, dragPitch, vpW, vpH } = shared;

  useEffect(() => {
    if (rootEntity != null) loaded.value = 1;
  }, [rootEntity, loaded]);

  RenderCallbackContext.useRenderCallback(
    (frameInfo) => {
      "worklet";
      frames.value = frames.value + 1;
      if (vpW.value === 0) {
        const vp = view.getViewport();
        vpW.value = vp.width;
        vpH.value = vp.height;
      }
      if (rootEntity == null || loaded.value !== 1) return;
      if (firstFrameAt.value === 0) firstFrameAt.value = Date.now();
      const dt = Math.min(frameInfo.timeSinceLastFrame, 0.1);
      const yaw = dragYaw.value;
      const pitch = dragPitch.value;
      dragYaw.value = 0;
      dragPitch.value = 0;
      transformManager.setEntityRotation(rootEntity, dt * 0.6 + yaw, [0, 1, 0], true);
      if (pitch !== 0) transformManager.setEntityRotation(rootEntity, pitch, [1, 0, 0], true);
    },
    [rootEntity, transformManager, view, frames, loaded, firstFrameAt, dragYaw, dragPitch, vpW, vpH]
  );

  return (
    <>
      <ModelRenderer model={model} transformToUnitCube />
      <Camera cameraPosition={[0, 0, cameraZ]} cameraTarget={[0, 0, 0]} />
    </>
  );
}

export default function BakeOff() {
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [run, setRun] = useState(0);
  const [cameraZ, setCameraZ] = useState(5);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [fps, setFps] = useState<{ avg: number; min: number | null }>({ avg: 0, min: null });
  const [layout, setLayout] = useState({ w: 0, h: 0 });
  const [buf, setBuf] = useState({ w: 0, h: 0 });

  const shared: Shared = {
    frames: useSharedValue(0),
    loaded: useSharedValue(0),
    firstFrameAt: useSharedValue(0),
    dragYaw: useSharedValue(0),
    dragPitch: useSharedValue(0),
    vpW: useSharedValue(0),
    vpH: useSharedValue(0),
  };
  const sharedRef = useRef(shared);
  sharedRef.current = shared;
  const t0 = useRef(Date.now());
  const minFps = useRef<number | null>(null);
  const samples = useRef<{ t: number; f: number }[]>([]);
  const statusRef = useRef(status);
  statusRef.current = status;

  const select = useCallback((i: number) => {
    const s = sharedRef.current;
    s.loaded.value = 0;
    s.firstFrameAt.value = 0;
    t0.current = Date.now();
    minFps.current = null;
    setStatus("loading");
    setMessage("");
    setLoadMs(null);
    setIdx(i);
    setRun((r) => r + 1);
  }, []);

  useEffect(() => {
    const original = console.error;
    console.error = (...args: unknown[]) => {
      if (String(args[0]).startsWith("Failed to load asset")) {
        setStatus("error");
        setMessage(args.map(String).join(" ").slice(0, 200));
      }
      original(...args);
    };
    return () => {
      console.error = original;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const s = sharedRef.current;
      const now = Date.now();
      const f = s.frames.value;
      const list = samples.current;
      list.push({ t: now, f });
      while (list.length > 1 && now - list[1].t >= 2000) list.shift();
      const first = list[0];
      const avg = now > first.t ? ((f - first.f) * 1000) / (now - first.t) : 0;

      const firstFrameAt = s.firstFrameAt.value;
      if (statusRef.current === "loading" && firstFrameAt > 0) {
        setStatus("ready");
        setLoadMs(firstFrameAt - t0.current);
      }
      if (firstFrameAt > 0) {
        const oneSecAgo = [...list].reverse().find((x) => now - x.t >= 1000);
        if (oneSecAgo) {
          const w = ((f - oneSecAgo.f) * 1000) / (now - oneSecAgo.t);
          if (oneSecAgo.t >= firstFrameAt && (minFps.current == null || w < minFps.current)) {
            minFps.current = w;
          }
        }
      }
      setFps({ avg, min: minFps.current });
      if (s.vpW.value !== 0) setBuf({ w: s.vpW.value, h: s.vpH.value });
      if (statusRef.current === "loading" && now - t0.current > 60000) {
        setStatus("error");
        setMessage("timeout: no model drawn after 60 s");
      }
    }, 250);
    return () => clearInterval(timer);
  }, []);

  const pan = useMemo(() => {
    let lx = 0;
    let ly = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        lx = e.nativeEvent.pageX;
        ly = e.nativeEvent.pageY;
      },
      onPanResponderMove: (e) => {
        const s = sharedRef.current;
        s.dragYaw.value = s.dragYaw.value + (e.nativeEvent.pageX - lx) * 0.01;
        s.dragPitch.value = s.dragPitch.value + (e.nativeEvent.pageY - ly) * 0.01;
        lx = e.nativeEvent.pageX;
        ly = e.nativeEvent.pageY;
      },
    });
  }, []);

  const dpr = PixelRatio.get();
  const model = MODELS[idx];

  return (
    <View
      style={styles.root}
      onLayout={(e) => setLayout({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <FilamentScene>
        <FilamentView style={StyleSheet.absoluteFill} enableTransparentRendering={false}>
          <Skybox colorInHex="#1b1b2a" />
          <DefaultLight />
          <Viewer key={`${idx}-${run}`} url={model.url} cameraZ={cameraZ} shared={shared} />
        </FilamentView>
      </FilamentScene>

      <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />

      <View style={[styles.overlay, { paddingTop: insets.top + 6 }]} pointerEvents="none">
        <Text style={styles.big}>
          {model.name} ({model.mb} MB)
        </Text>
        <Text style={[styles.big, status === "error" && styles.err, status === "ready" && styles.ok]}>
          state: {status}
          {message ? ` – ${message}` : ""}
        </Text>
        <Text style={styles.big}>load: {loadMs == null ? "…" : `${loadMs} ms`}</Text>
        <Text style={styles.big}>
          fps avg2s: {fps.avg.toFixed(1)}  min1s: {fps.min == null ? "–" : fps.min.toFixed(1)}
        </Text>
        <Text style={styles.small}>
          DPR {dpr} · view {layout.w.toFixed(0)}x{layout.h.toFixed(0)} pt · buffer{" "}
          {buf.w ? `${buf.w}x${buf.h} px` : `~${Math.round(layout.w * dpr)}x${Math.round(layout.h * dpr)} px`}
        </Text>
      </View>

      <View style={[styles.buttons, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.row}>
          {MODELS.map((m, i) => (
            <Pressable
              key={m.name}
              style={[styles.btn, i === idx && styles.btnOn]}
              onPress={() => select(i)}
            >
              <Text style={styles.btnText}>{m.name}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          <Pressable style={styles.btn} onPress={() => setCameraZ((z) => z + 0.5)}>
            <Text style={styles.btnText}>zoom −</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => setCameraZ((z) => Math.max(1, z - 0.5))}>
            <Text style={styles.btnText}>zoom +</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1b1b2a" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  big: { color: "#fff", fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  small: { color: "#ddd", fontSize: 13, marginTop: 2 },
  ok: { color: "#7dff9b" },
  err: { color: "#ff7d7d" },
  buttons: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  row: { flexDirection: "row", gap: 8 },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
  },
  btnOn: { backgroundColor: "#3b6cff" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
