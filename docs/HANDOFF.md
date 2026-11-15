# worlds: handoff from Capy to Claude Code

Written on 2026-11-15 by aidan lee, Danny Gu's Captain in Capy, when the team moved to Claude Code. It covers what's on `main`, the open work and the order to merge it, what still blocks the demo, and how to run the app and the backend.

worlds is an iOS app. Each night you talk for about 20 seconds about your day, and about a minute later it becomes a small 3D world you can explore. Your worlds make up a feed of your year, and worlds your friends share show up in your feed live. It's built with Expo SDK 58, Expo Router and TypeScript, on a Convex backend, and Supermemory keeps the same people and places looking the same from day to day.

## What's on main

- **Scaffold** (worlds#1). Home lists your worlds and has a text box to add one. `worlds.add({ transcript })` is the single entry point that creates a world.
- **CI** (worlds#2). `.github/workflows/ci.yml` runs `npm ci`, `npx expo customize tsconfig.json` (for typed routes), `tsc`, `expo lint` and `expo-doctor` on every pull request and every push to `main`.
- **Supermemory** (worlds#4), in `convex/memory.ts`.
  - `worlds.add` schedules `remember`, which saves the day and retries after 1, 10 and 60 minutes.
  - `recallCast(transcript, space?)` returns either `""` or a `<recurring_cast>` block of up to 12 facts. It has a 4-second deadline and never throws. The block goes before the voice note in the scene writer's prompt.
  - Nothing calls recall yet. The scene writer lives on Gurnoor's branch, described below.
- **Voice** (worlds#5).
  - `src/app/record.tsx` is a form sheet that opens from the "Record your day" button on home. It has a 20-second countdown and a live transcript, then lets you edit the text and confirm.
  - `src/hooks/use-speech-to-text.ts` wraps `expo-speech-recognition` with on-device recognition on iOS, so it needs no API key.
  - Typing is the fallback. On web, the sheet opens straight into typing.
  - `worlds://record?source=sample` feeds a bundled clip through the recognizer, so you can test without a microphone.

## Open work, in the order I'd merge it

1. **worlds#8: device profiles, friends and a live shared feed** (`capy/device-profiles-friends`).
   - Each phone picks a name and becomes a signed-in Convex user through `ctx.auth`. Convex signs the device tokens with the deployment's own key (`ctx.auth.signJwt`), so there are no signing keys to set up.
   - Friends connect with an invite link (`worlds://invite/<code>`) or by typing the code.
   - Worlds start private, and Share puts one in your friends' feeds. Memory is per person, through `memorySpace(tokenIdentifier)`.
   - **Before deploying it,** delete the worlds that have no owner (three test worlds on the dev deployment). Otherwise the schema push fails, because `ownerTokenIdentifier` is required.
   - Details are in `docs/friends/HANDOFF.md` on that branch.
2. **worlds#6: glass redesign** (`capy/glass-redesign`, from Neel Kolhe's crew). It owns the design system, the app shell, home and WorldCard. When you rebase it onto `main`:
   - Keep `api.feed.list` with its author line, Share and Unshare, and the Friends link in the header, all from #8.
   - Point the hero orb at `router.push("/record")`.
   - Keep the `record` form-sheet registration and `anchor: "index"` in the root layout.
3. **3D pipeline, viewer and research** (`capy/gurnoor-3d-worlds`, from Gurnoor Sandu's crew). It replaces draft worlds#3 and has no pull request yet. Start with `docs/3d-worlds/README.md` there. When you bring it onto `main` after #8:
   - `convex/access.ts` should let only the owner read a world, or a friend when the world is `shared`.
   - Recall should use the owner's space: `recallCast(prompt, memorySpace(world.ownerTokenIdentifier))`.
   - `worlds.add` must keep setting the owner and scheduling `remember`.
4. **Other branches.**
   - `capy/nightly-loop-notifications` is a nightly reminder that opens the record sheet. I haven't reviewed it.
   - `capy/google-apple-sign-in` has Apple and Google sign-in through Clerk. It's shelved because Clerk's dashboard was down. When real sign-in comes back, map each device profile's `tokenIdentifier` to the new account.

## Blockers and open decisions

- **3D generation is blocked.** `hunyuan-3d-pro`, GMI Cloud's only 3D model, fails on the team's account with `ResourceInsufficient` (request id `3df2b954-fb73-43f1-b663-011508e3a99b` for GMI support). Either GMI fixes the account, or a `FAL_KEY` lands and the 3D step moves to fal. That move is a one-line change, as `docs/3d-worlds/` explains.
- **Record flow (Danny's call).** In Neel's record mockup, you submit straight from the live transcript. worlds#5 has a stop-then-edit step, which is where people fix misheard words. Decide which to keep before restyling the sheet.
- **Real sign-in** is shelved, and device profiles stand in for it.

## Not yet checked on a real iPhone

Capy's cloud phones stopped when the organization ran out of Capy credits, so everything since was tested on Expo web and in tests. Check these on a phone:

- **Voice:**
  - on-device transcription and the live transcript
  - the microphone and speech permission prompts, and the denied states with Open Settings
  - the countdown, the stop at zero, and stopping early
  - the sample-clip link
  - the no-speech, network and unavailable messages
  - the form sheet's presentation and keyboard insets
  - joining the segments iOS 18 finalizes after each pause
- **Friends:**
  - whether the SecureStore secret survives a restart
  - opening `worlds://invite/<code>` from Messages, both from a cold start and while the app is running
  - the native share sheet for invites
  - `ctx.auth.signJwt` on the dev deployment once it's deployed

## Running it

```bash
npm ci
npx convex dev            # log in to Convex; writes .env.local with EXPO_PUBLIC_CONVEX_URL
npx expo run:ios          # development build; Expo Go doesn't include expo-speech-recognition
npm test                  # vitest with convex-test
npx tsc --noEmit && npx expo lint && npx -y expo-doctor
```

## The backend

- The Convex project is `yc-consumer-mobile-hackathon` in the `danny-gu` team.
  - Danny's dev deployment is `compassionate-goose-961` (https://compassionate-goose-961.convex.cloud). Every phone build so far pointed at it.
  - `main`'s backend is deployed there, along with the three ownerless test worlds.
  - A teammate who runs `npx convex dev` gets their own dev deployment.
- Environment variables:
  - `SUPERMEMORY_API_KEY` is set on `compassionate-goose-961`. Set it on any other deployment with `npx convex env set`.
  - The 3D pipeline also needs `GMI_API_KEY`. See `docs/3d-worlds/gmi-cloud.md` on Gurnoor's branch.
- Each push replaces every function on the deployment. Deploy `main` after merges, and don't push a feature branch to the deployment the phones use.

## Lessons from the Capy run

- If `<Link asChild>` wraps a child with an array `style`, it throws in dev, and release builds silently drop the style. Use a `Pressable` that calls `router.push`.
- `CI=1 npx expo start` turns off Metro's file watcher, so restart it after switching branches.
- `npx expo-doctor` waits forever at npx's install prompt unless you pass `-y`.
- Convex mutations can't make network calls. That's why Supermemory runs in scheduled actions, and why a Supermemory outage can't slow down `worlds.add`.
- Supermemory namespaces allow only letters, digits, `-`, `_` and `:`. That's why per-person spaces hash the `tokenIdentifier`.

## Files that stayed in Capy Drive

Some files live only in Capy Drive, not in this repo. Download them from Drive if you want to keep them:
- the crew reports and web screenshots: `captain-aidan-lee/reports/` and `renders/`
- the live Supermemory check output: `captain-aidan-lee/handoffs/YCCO-13/`
- Neel's design spec and mockups for home, record, onboarding, friends, invite and the world screens: `project-worlds/design/`
