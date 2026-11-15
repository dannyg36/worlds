import {
  type ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useEffect, useRef, useState } from "react";

export type SpeechError =
  | "microphone-denied"
  | "speech-denied"
  | "no-speech"
  | "network"
  | "unavailable"
  | "interrupted"
  | "failed";

type SpeechStatus = "idle" | "starting" | "listening" | "stopping";

const ERROR_KINDS: Partial<
  Record<ExpoSpeechRecognitionErrorCode, SpeechError>
> = {
  "not-allowed": "speech-denied",
  "no-speech": "no-speech",
  "speech-timeout": "no-speech",
  network: "network",
  "service-not-allowed": "unavailable",
  "language-not-supported": "unavailable",
  interrupted: "interrupted",
};

const NATIVE_CHUNK_FRAMES = 4096;
const CLIP_SAMPLE_RATE = 16_000;

export function useSpeechToText({
  maxSeconds,
  onFinish,
}: {
  maxSeconds: number;
  onFinish: (transcript: string) => void;
}) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<SpeechError | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(maxSeconds * 1000);
  const session = useRef({
    final: "",
    interim: "",
    error: null as SpeechError | null,
    running: false,
    unmounted: false,
  });

  useSpeechRecognitionEvent("start", () => {
    setStatus("listening");
    setRemainingMs(maxSeconds * 1000);
    setDeadline(Date.now() + maxSeconds * 1000);
  });

  useSpeechRecognitionEvent("result", ({ isFinal, results }) => {
    const current = session.current;
    const text = results[0]?.transcript ?? "";
    if (isFinal) {
      current.final += text;
      current.interim = "";
    } else {
      current.interim = text;
    }
    setTranscript((current.final + current.interim).trim());
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (event.error === "aborted") return;
    const current = session.current;
    const kind = ERROR_KINDS[event.error] ?? "failed";
    if (kind === "no-speech" && (current.final + current.interim).trim()) {
      return;
    }
    current.error = kind;
    setError(kind);
  });

  useSpeechRecognitionEvent("end", () => {
    const current = session.current;
    const text = (current.final + current.interim).trim();
    current.running = false;
    setStatus("idle");
    setDeadline(null);
    if (current.unmounted) return;
    if (text) {
      onFinish(text);
    } else if (!current.error) {
      setError("no-speech");
    }
  });

  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => {
      const left = Math.max(0, deadline - Date.now());
      setRemainingMs(left);
      if (left > 0) return;
      clearInterval(timer);
      setStatus("stopping");
      ExpoSpeechRecognitionModule.stop();
    }, 200);
    return () => clearInterval(timer);
  }, [deadline]);

  useEffect(() => {
    const current = session.current;
    return () => {
      current.unmounted = true;
      if (current.running) ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  function fail(kind: SpeechError) {
    session.current.running = false;
    setError(kind);
    setStatus("idle");
  }

  async function start(clipUri?: string) {
    const current = session.current;
    if (current.running) return;
    current.running = true;
    current.final = "";
    current.interim = "";
    current.error = null;
    setTranscript("");
    setError(null);
    setStatus("starting");

    if (
      !clipUri &&
      !(await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync())
        .granted
    ) {
      return fail("microphone-denied");
    }
    if (
      !(
        await ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync()
      ).granted
    ) {
      return fail("speech-denied");
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      return fail("unavailable");
    }
    if (current.unmounted) return;

    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      addsPunctuation: true,
      iosTaskHint: "dictation",
      requiresOnDeviceRecognition:
        ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
      audioSource: clipUri
        ? {
            uri: clipUri,
            chunkDelayMillis: (NATIVE_CHUNK_FRAMES / CLIP_SAMPLE_RATE) * 1000,
          }
        : undefined,
    });
  }

  function stop() {
    if (status !== "listening") return;
    setStatus("stopping");
    setDeadline(null);
    ExpoSpeechRecognitionModule.stop();
  }

  return { status, transcript, error, remainingMs, start, stop };
}
