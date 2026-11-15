# worlds

Your day as a place you can walk around in. Each night you talk for about 20 seconds about your day, and a minute later it becomes a small interactive 3D world. Your year is a feed of worlds, and friends' worlds show up live when they share them.

The planned pipeline is speech-to-text, then an LLM that writes the scene, then image generation, then a 3D model from fal.ai (Hunyuan3D or TRELLIS), stored in Convex and rendered as an explorable world. Supermemory keeps recurring people and places consistent across days.

## Stack

- Expo (SDK 58) with Expo Router and TypeScript; routes live in `src/app`.
- Convex for the backend; the `worlds` table, its `list` query and `add` mutation live in `convex/`.
- Speech-to-text runs on the phone through [expo-speech-recognition](https://github.com/jamsch/expo-speech-recognition) (Apple's speech recognizer, on-device when the phone supports it). `src/hooks/use-speech-to-text.ts` is the only place that talks to it, so a server pass such as fal's Wizper can slot in behind the same hook later.

## Record your day

**Record your day** on the home screen opens the record sheet (`src/app/record.tsx`). You talk for up to 20 seconds while a countdown runs and your words appear as you speak, then you check or edit the transcript and confirm, which calls `worlds.add({ transcript })` and returns to the list. Typing instead works for quiet places.

Simulators and cloud phones have no microphone, so open `worlds://record?source=sample` to play a bundled clip (`assets/audio/sample-day.wav`) through the same speech-to-text path.

## Run it

```bash
npm install
npx convex dev   # signs you in, provisions a dev deployment, and writes EXPO_PUBLIC_CONVEX_URL to .env.local
npx expo start   # in a second terminal
```

Native builds need `EXPO_PUBLIC_CONVEX_URL` at bundle time, which Expo reads from `.env.local`.
