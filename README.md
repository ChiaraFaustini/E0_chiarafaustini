# Schotter — Georg Nees (1968) — p5.js Reconstruction

A generative art reconstruction of Georg Nees' *Schotter* ("Gravel", 1968), one of the pioneering works of computer art. The composition is a vertical grid of unfilled squares that progressively loses its ordered structure through random displacement and rotation from top to bottom.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Entry point — loads p5.js, p5.sound, and MediaPipe Hands from CDN |
| `style.css` | Minimal page styling — centers the canvas on a white background |
| `sketch.js` | All generative logic, parameters, animation, hand tracking, and audio |

## Running

Open `index.html` in a browser. No build step or local server is required (all libraries are loaded from CDN). Webcam access requires HTTPS or localhost.

## Parameters

All important values are exposed as named constants at the top of `sketch.js`:

### Grid & Appearance

| Constant | Default | Description |
|----------|---------|-------------|
| `COLS` | `12` | Number of columns |
| `ROWS` | `22` | Number of rows |
| `SQUARE_SIZE` | `26` | Side length of each square (pixels) |
| `SPACING_X` | `30` | Horizontal distance between grid positions |
| `SPACING_Y` | `30` | Vertical distance between grid positions |
| `SEED` | `42` | Random seed — same seed produces the same composition |

### Disorder Limits

| Constant | Default | Description |
|----------|---------|-------------|
| `MAX_DISPLACEMENT_X` | `12` | Max horizontal offset at the bottom row (pixels) |
| `MAX_DISPLACEMENT_Y` | `8` | Max vertical offset at the bottom row (pixels) |
| `MAX_ROTATION` | `Math.PI / 2` | Max rotation angle at the bottom row (radians) |

### Disorder Progression Curves

| Constant | Default | Description |
|----------|---------|-------------|
| `DISPLACEMENT_CURVE` | `0.8` | Exponent for displacement progression — lower = faster early rise |
| `ROTATION_CURVE` | `0.9` | Exponent for rotation progression — lower = faster early rise |

### Animation

| Constant | Default | Description |
|----------|---------|-------------|
| `CYCLE_DURATION` | `22` | Seconds for a full automatic cycle |
| `HOLD_DURATION` | `2` | Seconds to hold at full disorder |
| `FRONT_WIDTH` | `0.8` | Width of the smooth transition zone (0–1) |
| `PROPAGATION_DIRECTION` | `1` | `1` = top → bottom, `-1` = bottom → top |
| `MODE` | `'hand'` | `'auto'`, `'mouse'`, or `'hand'` |

### Hand Tracking

| Constant | Default | Description |
|----------|---------|-------------|
| `HAND_SMOOTHING` | `0.05` | Temporal smoothing factor for hand tracking |
| `HAND_TIMEOUT` | `2000` | ms before returning to order when hand is absent |

### Audio

| Constant | Default | Description |
|----------|---------|-------------|
| `MASTER_VOLUME` | `1.0` | Overall volume (a limiter sits after it to catch genuine overshoots) |
| `FUNDAMENTAL` | `55` | Hz — low A1, dark ambient drone |
| `FUNDAMENTAL_VOLUME` | `0.15` | Level of the drone at disorder = 0 |
| `DRONE_FADE` | `0.6` | Drone drops to 40% of its level at disorder = 1 |
| `LOWPASS_CUTOFF` | `1200` | Hz — everything above this is rolled off (well above the top melodic note) |
| `LOWPASS_Q` | `0.5` | Below 1, so the filter stays gentle with no resonant peak |
| `DETUNE_RATIO` | `0.015` | ±1.5% pitch drift at disorder = 1 (a ratio, not Hz — keeps the drone smooth) |
| `LFO_RATE` | `0.05` | Hz — very slow wobble rate |
| `LFO_DEPTH` | `0.004` | ±0.4% frequency modulation at disorder = 1 |
| `AUDIO_SMOOTHING` | `0.03` | Slightly more inertia than visual smoothing |
| `SCALE_ROOT` | `220` | Hz — A3, root of the modal scale |
| `SCALE_INTERVALS` | `[1, 9/8, 5/4, 3/2, 5/3, 2]` | Just intonation intervals |
| `NUM_MELODIC_NOTES` | `5` | Number of melodic notes in the scale |
| `MELODIC_VOLUME` | `0.13` | Volume of each melodic note — must stay low so all 5 + drone fit under 1.0 |
| `VIBRATO_RATE` | `5` | Hz — centre of the per-note vibrato rate range |
| `VIBRATO_SPREAD` | `1.2` | Hz — each note gets its own rate around `VIBRATO_RATE` |
| `VIBRATO_DEPTH` | `0.004` | ±0.4% pitch wobble — deeper than this starts to sound rough |

## Interaction Modes

### Automatic (`MODE = 'auto'`)

A disorder front travels vertically through the composition:

1. **Forward** — disorder accumulates from top to bottom; rows already crossed remain in their target state
2. **Hold** — complete Schotter state is displayed for `HOLD_DURATION` seconds
3. **Reverse** — order progressively returns from top to bottom

### Mouse (`MODE = 'mouse'`)

The vertical mouse position controls the same cumulative disorder process:

- Mouse at top → perfectly ordered grid
- Mouse at middle → approximately half of the composition has transitioned
- Mouse at bottom → complete Schotter reconstruction

### Hand Tracking (`MODE = 'hand'`)

Uses webcam and MediaPipe Hands to track one hand:

- **Hand Y position** → disorder propagation (top = ordered, bottom = complete Schotter)
- **Hand openness** → disorder intensity multiplier (fist = 0, open hand = 1)

Moving an open hand downward progressively constructs the complete Schotter composition. Closing the hand reduces perturbation toward order. The interaction does not modify Nees' generative rule — it allows the viewer to manually navigate through the same order-to-disorder process that the automatic version unfolds over time.

If the hand temporarily disappears, the last valid state is held briefly, then smoothly returns toward order. If webcam/hand tracking fails completely, the sketch gracefully falls back to mouse control.

## Generative Sound

A subtle, dark ambient drone follows the same disorder parameter that controls the visual transformation. The sound system uses the same conceptual logic as the visual system:

- **Visual:** `position = orderedPosition + fixedOffset * disorder`
- **Audio:** `frequency = stableFrequency + fixedDetuning * disorder`

Detuning targets are generated once and never randomized per frame. All audio parameters use strong smoothing for continuous evolution.

### Sound Layers

- **Fundamental drone** — low sine wave (55 Hz), always present
- **Melodic notes** — modal scale notes (just intonation) that emerge one by one as disorder increases
- **LFO modulation** — slow frequency modulation that increases with disorder
- **Lowpass filter** — rolls off above `LOWPASS_CUTOFF`, warming the mix and removing any harshness the sum introduced
- **Limiter** — a `DynamicsCompressorNode` set as a brickwall, so the mix can be played loud without clipping

At disorder = 0, the sound is minimal and stable. At disorder = 1, the sound is dense and textural but still ambient and controlled.

## UI

- **Hint text** — "click to enable audio — move hand to play" (disappears after first interaction)

## Generative Logic

Each square stores fixed target values generated once at initialization:

- `baseX`, `baseY` — original grid position
- `targetOffsetX`, `targetOffsetY` — target displacement
- `targetRotation` — target rotation

During animation, each square interpolates from its ordered state to its target state using `lerp()`:

```
x = lerp(baseX, baseX + targetOffsetX * intensity, localDisorder)
y = lerp(baseY, baseY + targetOffsetY * intensity, localDisorder)
angle = lerp(0, targetRotation * intensity, localDisorder)
```

The `localDisorder` value (0–1) is calculated per row using a cumulative smoothstep function based on the row's position relative to the moving front. This ensures the animation is deterministic and the final state exactly matches the static reconstruction.

## References

- Georg Nees, *Schotter* ("Gravel"), 1968 — plotter drawing, one of the earliest examples of generative art
- [p5.js](https://p5js.org/) — JavaScript creative coding library
- [p5.sound](https://p5js.org/reference/#/libraries/p5.sound) — audio library for p5.js
- [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands.html) — hand tracking library
