# worlds

Your day as a place you can walk around in. Each night you talk for about 20 seconds about your day, and a minute later it becomes a small interactive 3D world. Your year is a feed of worlds, and friends' worlds show up live when they share them.

The planned pipeline is speech-to-text, then an LLM that writes the scene, then image generation, then a 3D model from fal.ai (Hunyuan3D or TRELLIS), stored in Convex and rendered as an explorable world. Supermemory keeps recurring people and places consistent across days.

## Stack

- Expo (SDK 58) with Expo Router and TypeScript; routes live in `src/app`.
- Convex for the backend; the `worlds` table, its `list` query and `add` mutation live in `convex/`.
- Clerk for sign-in with Apple and Google. Convex checks Clerk's tokens, and each world belongs to the account that created it.

## Run it

1. `npm install`
2. `npx convex dev` signs you in, provisions a dev deployment, and writes `EXPO_PUBLIC_CONVEX_URL` to `.env.local`.
3. Add your Clerk publishable key to `.env.local` as `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, and point Convex at your Clerk instance with `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-instance>.clerk.accounts.dev`.
4. `npx expo start` in a second terminal.

Native builds read both `EXPO_PUBLIC_` values from `.env.local` at bundle time.
