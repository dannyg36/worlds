# Scene spec: what the scene writer emits

You turn one day into a small, dense, cinematic diorama: one frozen moment, like a still from a stop-motion film. Output ONE JSON object, nothing else. The renderer builds every object from a fixed kit, so only use the types below.

## Units and axes
- 1 unit = 1 metre. The diorama sits on a base about 9 m across, centred on the origin.
- `x` runs left to right and `z` runs back to front as seen from the hero camera, which sits on +z looking at the centre from 30 degrees up. Keep everything inside the base (radius 4.5 for round, ±4.5 for square).
- `rot` is the yaw in degrees. At `rot: 0` an object faces +z, toward the camera. A chair at `rot: 0` has its back on the -z side and a person sitting in it faces the camera. `rot: 180` faces away.

## Top level
```json
{
  "title": "A Sparkler for Priya",
  "time": "dusk",                 // dawn | morning | noon | golden-hour | dusk | night | overcast | rain | snow
  "base": { "shape": "round", "surface": "cobblestone" },   // shape: round | square; surface: cobblestone | grass | wood | tile | sand | snow | asphalt | carpet | water
  "palette": ["#c0392b", "#f5e6c8", "#2e5e3a"],             // optional accent colours
  "objects": [ ... ]
}
```

## Objects
Every object has `type`, `at: [x, z]` and optional `rot`, `id`, `scale`, `color`.
To put something on top of another object, give the support an `id` and the item `on: "<id>"`. Its `at` is then an offset from the support's centre in the support's own frame, and it sits on the support's top surface. Use this for everything on tables, counters and desks.

| type | params | notes |
| --- | --- | --- |
| `table` | `size: [w, d]`, `shape: "rect" or "round"`, `cloth: "red-check" or "white" or "none"`, `height` | top is at 0.75 by default |
| `chair` | `color` | seat 0.45 high, faces +z at rot 0 |
| `bench` | `length`, `color` | |
| `stool` | `color` | |
| `counter` | `size: [w, d]`, `color` | 1.0 high; shop or café counter |
| `desk` | `size: [w, d]`, `color` | |
| `shelf` | `size: [w, h]`, `color`, `fill: "books" or "jars" or "produce"` | backed against -z at rot 0 |
| `person` | `pose: "sit" or "stand" or "wave" or "walk" or "cheer" or "play-guitar"`, `skin`, `shirt`, `pants`, `hair`, `hairStyle: "short" or "long" or "bun" or "curly" or "bald" or "cap"`, `holding: "glass" or "phone" or "umbrella" or "none"`, `kid: true` | seated people go at the same `at` and `rot` as their chair |
| `dog` | `color`, `size: "small" or "medium"`, `holding: "ball" or "none"` | |
| `wall` | `length`, `height`, `material: "brick" or "stone" or "plaster" or "wood"`, `color`, `window: true`, `door: true`, `vines: true` | runs along x at rot 0 |
| `roof` | `length`, `depth`, `color` | terracotta tile overhang; place it on top of a wall's position at that wall's height (`y`) |
| `post` | `height`, `color` | wooden post, for string lights and awnings |
| `fence` | `length`, `color` | |
| `awning` | `size: [w, d]`, `height`, `stripes: ["#hex", "#hex"]` | striped market awning on poles |
| `string-lights` | `points: [[x, y, z], ...]`, `color` | catenary between consecutive points; bulbs glow; anchor on post tops. `points` are absolute world coordinates, so leave out `at` |
| `lamp-post` | `height` | glowing street lamp |
| `lantern` | | small glowing lantern; put on tables, walls or the ground |
| `tree` | `kind: "round" or "olive" or "palm" or "pine" or "cypress"`, `height` | |
| `bush` | `size`, `flowers: "#hex"` | |
| `potted-plant` | `kind: "herb" or "flowers" or "olive" or "succulent"`, `size`, `flowers: "#hex"` | terracotta pot |
| `planter` | `length`, `flowers: "#hex"` | long box with greens |
| `rock` | `size` | |
| `plate` | `food: "pasta" or "pizza" or "salad" or "steak" or "pancakes" or "galette" or "burrito" or "none"` | on a table |
| `glass` | `drink: "red-wine" or "white-wine" or "water" or "beer" or "latte" or "red-bull"` | |
| `bottle` | `color` | |
| `cake` | `kind: "tiramisu" or "birthday"`, `sparkler: true`, `candles: n` | |
| `candle` | | small glowing candle |
| `bread-basket` | | |
| `vase` | `flowers: "#hex"` | |
| `book` | `color`, `open: true` | |
| `laptop` | `open: true` | screen glows |
| `mug` | `color` | |
| `guitar` | | lying or leaned |
| `crate` | `fill: "peaches" or "carrots" or "apples" or "bread" or "none"` | market crate |
| `umbrella` | `color`, `open: true` | |
| `bike` | `color` | |
| `box` / `sphere` / `cylinder` / `cone` | `size: [x, y, z]`, `color`, `y` | escape hatch for anything missing, keep it rare |

## Composition rules
1. Pick ONE frozen moment, the emotional peak of the day, and build the whole scene around it. Everything points at it.
2. Be dense: 40 to 90 objects. Put things on surfaces (plates, glasses, candles, bread on tables). Dress the edges with plants, planters, lights and walls so the base reads as a place.
3. Back the scene with one or two walls on the far (-z) side so it frames like a film set, and keep the front (+z) open for the camera.
4. Every person mentioned gets a figure, with distinct shirt and hair colours. Don't invent extra people unless the note implies a crowd.
5. Lights tell the time: at dusk or night, add string lights, lanterns, candles or lamps; at golden hour, warm low sun is automatic.
6. Keep 0.6 m walking gaps between furniture so it reads clearly, and keep objects off each other unless they use `on`.
7. Keep the footprint tight, about 7 x 7 m. The renderer shrinks the base to wrap your content, so empty floor is wasted space. Dress the front (+z) third with low things that don't block the view of the moment: planters, crates, a dog, lanterns, a bike, flowers, dropped props.
