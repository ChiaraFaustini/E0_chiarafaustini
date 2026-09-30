/*
 * Schotter ("Gravel") — Georg Nees, 1968
 * Animated reconstruction using p5.js — Mode 2: Moving Disorder Front
 *
 * In Nees' original work, disorder is a function of vertical position:
 * the top rows are ordered, and perturbation increases toward the bottom.
 * This animation transforms that spatial progression into a temporal one:
 * a disorder front travels vertically through the composition, so each
 * row transitions from ordered to disordered at a different moment in time.
 */

// ---------- Numerical parameters ----------

const COLS = 12;              // number of columns in the grid
const ROWS = 22;              // number of rows in the grid
const SQUARE_SIZE = 26;       // side length of each square (pixels)
const SPACING_X = 30;         // horizontal distance between grid positions
const SPACING_Y = 30;         // vertical distance between grid positions
const MAX_DISPLACEMENT_X = 12; // max horizontal offset at the bottom row (pixels)
const MAX_DISPLACEMENT_Y = 8;  // max vertical offset at the bottom row (pixels)
// Note: p5.js constants like PI are only available inside setup()/draw(),
// so we use Math.PI here at the top level.
const MAX_ROTATION = Math.PI / 2; // max rotation angle at the bottom row (radians)
const SEED = 42;              // random seed — same seed = same composition

// Exponents controlling the non-linear progression of disorder.
// Lower exponent = faster early rise; higher exponent = slower early rise.
// Displacement uses a gentle curve so the first rows stay almost ordered.
// Rotation uses a stronger curve so it grows faster than displacement.
const DISPLACEMENT_CURVE = 0.8; // gentle: subtle early, moderate at the bottom
const ROTATION_CURVE = 0.9;     // stronger: grows faster, dominates the lower half

// ---------- Animation parameters ----------

const CYCLE_DURATION = 22;    // seconds for a full cycle (forward + hold + reverse)
const HOLD_DURATION = 2;      // seconds to hold at full disorder
const FRONT_WIDTH = 0.8;      // width of the smooth transition zone (0-1)
const PROPAGATION_DIRECTION = 1; // 1 = top to bottom, -1 = bottom to top

// Mode system: 'auto' = automatic animation, 'mouse' = mouseY control, 'hand' = webcam hand tracking
const MODE = 'hand';

// ---------- Hand tracking variables ----------
// These store the raw and smoothed values from webcam hand tracking.
// The webcam feed and landmarks are never drawn to the canvas.

let videoCapture;             // p5 video capture element (hidden)
let handsTracker;             // MediaPipe Hands instance
let handDetected = false;     // whether a hand is currently visible
let lastHandTime = 0;         // timestamp when hand was last seen

// Raw values from landmark tracking (0-1 range)
let rawHandY = 0.5;           // vertical hand position (0 = top, 1 = bottom)
let rawHandOpenness = 0;      // hand openness (0 = fist, 1 = open)

// Smoothed values used for animation (exponential moving average)
let smoothHandY = 0.5;
let smoothHandOpenness = 0;

// Smoothing and timing constants
const HAND_SMOOTHING = 0.05;  // lower = smoother but slower response
const HAND_TIMEOUT = 2000;    // ms before returning to order when hand is absent

// ---------- Audio parameters ----------
// The sound system follows the same conceptual logic as the visual system:
//   visual:  position = orderedPosition + fixedOffset * disorder
//   audio:   frequency = stableFrequency + fixedDetuning * disorder
// Detuning targets are generated once and never randomized per frame.

const MASTER_VOLUME = 1.0;    // master volume level
const FUNDAMENTAL = 55;       // Hz — low A1, dark ambient drone

// The drone is a bed, not the subject. It sits low and gets quieter as the
// disorder rises, so the melody takes over: the visual and the mix move together.
const FUNDAMENTAL_VOLUME = 0.15; // level of the drone at disorder = 0
const DRONE_FADE = 0.6;         // drone drops to 40% of its level at disorder = 1

// A lowpass filter is the single biggest cure for a harsh, metallic timbre.
// Every oscillator here is a pure sine, so there is no real high content to
// remove — but it makes the mix warm instead of buzzy at no musical cost.
const LOWPASS_CUTOFF = 1200;  // Hz — well above the top melodic note (440 Hz)
const LOWPASS_Q = 0.5;        // below 1 = gentle, no resonant peak

// Detuning is a RATIO, not an absolute Hz value. An absolute value of 30 Hz on a
// 55 Hz fundamental is a 55% pitch swing — that is what made the drone metallic.
// As a ratio it always stays a subtle drift, whatever the fundamental frequency is.
const DETUNE_RATIO = 0.015;   // ±1.5% pitch drift at disorder = 1
const LFO_RATE = 0.05;        // Hz — very slow wobble
const LFO_DEPTH = 0.004;      // ±0.4% frequency modulation at disorder = 1
const AUDIO_SMOOTHING = 0.03; // slightly more inertia than visual smoothing

// Melodic layer — modal scale for gradual melodic emergence
const SCALE_ROOT = 220;       // Hz — A3, root of the modal scale
const SCALE_INTERVALS = [1, 9/8, 5/4, 3/2, 5/3, 2]; // just intonation major-ish
const NUM_MELODIC_NOTES = 5;  // number of melodic notes in the scale

// Per-note volume. The worst case is the drone plus all notes sounding together,
// so this must stay small enough that the total never exceeds 1.0.
// 0.13 * 5 notes + 0.15 drone = 0.80 peak — comfortable headroom.
const MELODIC_VOLUME = 0.13;  // volume of each melodic note

// Vibrato makes the notes sound played rather than programmed: a slow, small
// pitch wobble. Rate and depth differ per note and are generated once.
const VIBRATO_RATE = 5;       // Hz — centre of the random rate range
const VIBRATO_SPREAD = 1.2;   // Hz — each note gets its own rate around VIBRATO_RATE
const VIBRATO_DEPTH = 0.004;  // ±0.4% pitch wobble — deeper than this gets rough

// ---------- Canvas ----------

const MARGIN = 60; // white border around the grid

// ---------- Square data ----------

// Each square stores its fixed target values, generated once at initialization.
// This ensures the animation is deterministic and the final state (full disorder)
// exactly matches the static reconstruction.
const squares = [];

function setup() {
  const canvasWidth = COLS * SPACING_X + MARGIN * 2;
  const canvasHeight = ROWS * SPACING_Y + MARGIN * 2;
  createCanvas(canvasWidth, canvasHeight);

  // Fix the random seed so the composition is identical on every load.
  randomSeed(SEED);

  // Generate all target values once, in the same order as the static reconstruction.
  // These values are fixed and never change during animation.
  // We use lerp() to interpolate between the ordered state and these targets,
  // rather than calling random() every frame, so the motion is smooth and deterministic.
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const progress = row / (ROWS - 1);
      const displacementFactor = pow(progress, DISPLACEMENT_CURVE);
      const rotationFactor = pow(progress, ROTATION_CURVE);

      const baseX = MARGIN + col * SPACING_X + SPACING_X / 2;
      const baseY = MARGIN + row * SPACING_Y + SPACING_Y / 2;

      const targetOffsetX = random(-MAX_DISPLACEMENT_X * displacementFactor, MAX_DISPLACEMENT_X * displacementFactor);
      const targetOffsetY = random(-MAX_DISPLACEMENT_Y * displacementFactor, MAX_DISPLACEMENT_Y * displacementFactor);
      const targetRotation = random(-MAX_ROTATION * rotationFactor, MAX_ROTATION * rotationFactor);

      squares.push({ baseX, baseY, targetOffsetX, targetOffsetY, targetRotation });
    }
  }

  // Initialize hand tracking if in hand mode
  // Gracefully fall back to mouse control if webcam/hand tracking fails
  if (MODE === 'hand') {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        setupHandTracking();
      } catch (e) {
        console.warn('Hand tracking initialization failed, falling back to mouse mode:', e);
        MODE = 'mouse';
      }
    } else {
      console.warn('Webcam API not available, falling back to mouse mode');
      MODE = 'mouse';
    }
  }

  // Subtle UI: volume control and hint in the bottom-right corner
  // Elements are vertically separated to avoid overlap
  hint = createP('click to enable audio — move hand to play');
  hint.style('font-size', '10px');
  hint.style('color', '#999');
  hint.style('position', 'absolute');
  hint.style('bottom', '8px');
  hint.style('right', '10px');
  hint.style('margin', '0');
  hint.style('pointer-events', 'none');
  hint.style('user-select', 'none');

}

// Standard smoothstep function for smooth transitions.
// Returns 0 when x <= edge0, 1 when x >= edge1, with a smooth S-curve in between.
function smoothstep(edge0, edge1, x) {
  const t = constrain((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------- Audio variables ----------
// Oscillators and gain nodes for the ambient drone.
// All detuning targets are generated once and fixed.

let audioInitialized = false;
let masterGain;
let lowpassFilter;
let limiter;
let fundamentalOsc;
let melodicOscs = [];    // melodic notes that emerge with disorder

// Fixed detuning target for the fundamental (generated once, like the visual targets).
// Analogue of the squares' fixed offsets: each sound drifts by its own fixed amount.
let fundamentalDetuning = 0;

// Fixed vibrato character of each melodic note (generated once)
const noteDetunes = [];          // small pitch offset from exact just intonation
const noteVibratoRates = [];     // Hz — vibrato speed per note
const noteVibratoPhases = [];    // radians — starting point of each note's vibrato

// Smoothed audio values (slightly more inertia than visual)
let smoothAudioDisorder = 0;

// UI elements (declared globally so draw() can access them)
let hint;

// ---------- Audio functions ----------

// Initialize the audio context and create the drone sound system.
// Must be called after user interaction (browser autoplay policy).
function initAudio() {
  if (audioInitialized) return;
  audioInitialized = true;

  // Gain chain: oscillators → masterGain → lowpass → limiter → speakers
  // The limiter only ever catches a genuine overshoot. It is deliberately not
  // used to hold the level down: continuous heavy compression is what makes a
  // mix sound squashed, and a squashed low drone sounds metallic.
  const audioContext = getAudioContext();

  masterGain = audioContext.createGain();
  masterGain.gain.value = MASTER_VOLUME;

  // Warmth: roll off everything above the top melodic note. Sines have almost no
  // energy there, so this only smooths over any distortion the sum introduced.
  lowpassFilter = audioContext.createBiquadFilter();
  lowpassFilter.type = 'lowpass';
  lowpassFilter.frequency.value = LOWPASS_CUTOFF;
  lowpassFilter.Q.value = LOWPASS_Q;

  limiter = audioContext.createDynamicsCompressor();
  limiter.threshold.value = -1;  // in dB: only acts just below full scale
  limiter.knee.value = 0;         // hard knee, so it stays out of the way
  limiter.ratio.value = 20;       // brickwall — catches peaks, does not pump
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  masterGain.connect(lowpassFilter);
  lowpassFilter.connect(limiter);
  limiter.connect(audioContext.destination);

  // Fundamental oscillator — a soft sine wave, always present.
  // A sine has no upper harmonics, so it reads as a smooth drone rather than a buzzy tone.
  fundamentalOsc = new p5.Oscillator('sine');
  fundamentalOsc.freq(FUNDAMENTAL);
  fundamentalOsc.amp(FUNDAMENTAL_VOLUME);
  fundamentalOsc.connect(masterGain);
  fundamentalOsc.start();

  // Fixed detuning target for the fundamental, generated once and never changed.
  // Same idea as the squares' fixed offsets: a constant target, reached gradually.
  // Stored as a ratio of the fundamental, so the drift stays subtle and musical.
  fundamentalDetuning = random(-DETUNE_RATIO, DETUNE_RATIO);

  // Melodic oscillators — notes from the modal scale, introduced gradually.
  // Each note gets its own fixed vibrato rate, phase and micro-detune, generated once.
  // Like the squares' offsets, these are constant targets, never re-randomised.
  for (let i = 0; i < NUM_MELODIC_NOTES; i++) {
    const osc = new p5.Oscillator('sine');

    // Tiny fixed offset from exact just intonation. Without it the chords are
    // perfectly static and sound synthetic; a few cents of "imprecision" makes
    // them sound like they are being played.
    noteDetunes.push(random(-0.004, 0.004));
    noteVibratoRates.push(VIBRATO_RATE + random(-VIBRATO_SPREAD, VIBRATO_SPREAD));
    noteVibratoPhases.push(random(0, 2 * PI)); // start each note at a different point

    osc.freq(SCALE_ROOT * SCALE_INTERVALS[i]);
    osc.amp(0); // start silent, introduced gradually with disorder
    osc.connect(masterGain);
    osc.start();
    melodicOscs.push(osc);
  }

}

// Update the audio system based on the current disorder value.
// Uses the same conceptual logic as the visual system:
//   frequency = stableFrequency + fixedDetuning * disorder
// The LFO modulation is computed in the time domain for robustness.
function updateAudio(disorder) {
  if (!audioInitialized) return;

  // Apply strong smoothing for fluid, continuous evolution
  // Slightly more inertia than visual smoothing
  smoothAudioDisorder = lerp(smoothAudioDisorder, disorder, AUDIO_SMOOTHING);
  const d = smoothAudioDisorder;
  const t = millis() / 1000;

  // Fundamental: stable frequency + fixed detuning drift + slow LFO modulation.
  // frequency = FUNDAMENTAL * (1 + detune + lfo), so both terms are pitch ratios.
  const lfoValue = Math.sin(2 * PI * LFO_RATE * t) * LFO_DEPTH * d;
  fundamentalOsc.freq(FUNDAMENTAL * (1 + fundamentalDetuning * d + lfoValue));

  // The drone recedes as the melody emerges, so the mix goes from drone to melody
  // as disorder rises. Visual and sonic weight move together.
  fundamentalOsc.amp(FUNDAMENTAL_VOLUME * (1 - DRONE_FADE * d));

  // Melodic notes: introduced one by one as disorder increases.
  // Each note is always present once it has emerged — nothing switches off, so
  // raising the disorder only ever adds notes, exactly like the visual front.
  for (let i = 0; i < NUM_MELODIC_NOTES; i++) {
    // Staggered thresholds: first note at d=0.1, last note at d=0.9
    const threshold = 0.1 + (i / NUM_MELODIC_NOTES) * 0.8;
    const noteLevel = smoothstep(threshold, threshold + 0.15, d);
    melodicOscs[i].amp(noteLevel * MELODIC_VOLUME);

    // Vibrato: a slow pitch wobble that makes each note sound played, not programmed
    const vibrato =
      Math.sin(2 * PI * noteVibratoRates[i] * t + noteVibratoPhases[i]) *
      VIBRATO_DEPTH *
      noteLevel;
    melodicOscs[i].freq(SCALE_ROOT * SCALE_INTERVALS[i] * (1 + noteDetunes[i] + vibrato));
  }
}

// ---------- Hand tracking ----------

// Initialize webcam capture and MediaPipe Hands tracker.
// The video feed is hidden and never drawn to the canvas.
function setupHandTracking() {
  videoCapture = createCapture(VIDEO);
  videoCapture.size(320, 240); // small size for performance
  videoCapture.hide();         // completely hidden from the canvas

  handsTracker = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
  });
  handsTracker.setOptions({
    maxNumHands: 1,
    modelComplexity: 0, // lite model for performance
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  handsTracker.onResults(onHandResults);

  // Throttled hand tracking loop — send frames at ~12fps to avoid overwhelming the tracker
  let lastTrackTime = 0;
  const TRACK_INTERVAL = 83; // ms (~12fps)
  const trackHand = async () => {
    requestAnimationFrame(trackHand);
    const now = millis();
    if (now - lastTrackTime < TRACK_INTERVAL) return;
    lastTrackTime = now;
    if (videoCapture.elt && videoCapture.elt.readyState >= 2) {
      try {
        await handsTracker.send({ image: videoCapture.elt });
      } catch (e) {
        // Silently ignore frame processing errors
      }
    }
  };
  trackHand();
}

// Process hand tracking results.
// Calculates vertical hand position and hand openness from landmarks.
function onHandResults(results) {
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];

    // Average Y position of all landmarks (0 = top, 1 = bottom)
    let sumY = 0;
    for (const lm of landmarks) {
      sumY += lm.y;
    }
    rawHandY = sumY / landmarks.length;

    // Estimate hand openness from fingertip distances relative to hand size
    const wrist = landmarks[0];
    const middleMCP = landmarks[9];
    const handSize = Math.sqrt(
      Math.pow(wrist.x - middleMCP.x, 2) +
      Math.pow(wrist.y - middleMCP.y, 2)
    );

    const fingertips = [4, 8, 12, 16, 20]; // thumb, index, middle, ring, pinky
    let sumDist = 0;
    for (const idx of fingertips) {
      const tip = landmarks[idx];
      sumDist += Math.sqrt(
        Math.pow(tip.x - wrist.x, 2) +
        Math.pow(tip.y - wrist.y, 2)
      );
    }
    const avgDist = sumDist / fingertips.length;
    const normalizedDist = avgDist / handSize;

    // Map normalized distance to openness: closed fist ≈ 0, open hand ≈ 1
    rawHandOpenness = constrain((normalizedDist - 0.5) / 1.0, 0, 1);

    handDetected = true;
    lastHandTime = millis();
  } else {
    handDetected = false;
  }
}

function draw() {
  const t = millis() / 1000; // time in seconds
  const transitionDuration = (CYCLE_DURATION - HOLD_DURATION) / 2;

  // The front must travel from outside the composition to outside the composition
  // so that all rows reach full disorder (or full order) at the extremes.
  const FRONT_START = -FRONT_WIDTH / 2;
  const FRONT_END = 1 + FRONT_WIDTH / 2;

  let frontPosition;
  let isForward;
  let intensity = 1; // disorder intensity multiplier (1 = full Schotter targets)

  if (MODE === 'hand') {
    // Hand tracking mode: hand Y controls propagation, hand openness controls intensity.
    // The interaction does not modify Nees' generative rule — it allows
    // the viewer to manually navigate through the same order-to-disorder
    // process that the automatic version unfolds over time.
    isForward = true;

    // Apply temporal smoothing for fluid, jitter-free response
    smoothHandY = lerp(smoothHandY, rawHandY, HAND_SMOOTHING);
    smoothHandOpenness = lerp(smoothHandOpenness, rawHandOpenness, HAND_SMOOTHING);

    // If hand disappears, hold last valid state briefly, then return toward order
    if (!handDetected && millis() - lastHandTime > HAND_TIMEOUT) {
      smoothHandY = lerp(smoothHandY, 0, HAND_SMOOTHING);
      smoothHandOpenness = lerp(smoothHandOpenness, 0, HAND_SMOOTHING);
    }

    // Map hand Y to front position (top = ordered, bottom = complete Schotter)
    frontPosition = FRONT_START + (FRONT_END - FRONT_START) * smoothHandY;

    // Hand openness controls disorder intensity
    intensity = smoothHandOpenness;
  } else if (MODE === 'mouse') {
    // Mouse mode: mouseY controls the disorder progression.
    isForward = true;
    const clampedMouseY = constrain(mouseY, 0, height);
    frontPosition = FRONT_START + (FRONT_END - FRONT_START) * (clampedMouseY / height);
  } else {
    // Automatic animation: front moves forward, holds, then reverses.
    // Sinusoidal easing ensures smooth acceleration and deceleration.
    const cycleTime = t % CYCLE_DURATION;
    if (cycleTime < transitionDuration) {
      // Forward phase: disorder accumulates from top to bottom
      isForward = true;
      const phaseT = cycleTime / transitionDuration;
      frontPosition = FRONT_START + (FRONT_END - FRONT_START) * (1 - cos(PI * phaseT)) / 2;
    } else if (cycleTime < transitionDuration + HOLD_DURATION) {
      // Hold phase: complete Schotter state is clearly visible
      isForward = true;
      frontPosition = FRONT_END;
    } else {
      // Reverse phase: order accumulates from top to bottom
      isForward = false;
      const phaseT = (cycleTime - transitionDuration - HOLD_DURATION) / transitionDuration;
      frontPosition = FRONT_END - (FRONT_END - FRONT_START) * (1 - cos(PI * phaseT)) / 2;
    }
  }

  background(255);
  stroke(0);
  strokeWeight(1);
  noFill();

  // Hide hint after first interaction
  if (audioInitialized && hint) {
    hint.hide();
  }

  // Calculate global disorder value for audio (0 = ordered, 1 = complete Schotter)
  // This uses the same progression value that controls the visual transformation
  let audioDisorder;
  if (MODE === 'hand') {
    audioDisorder = smoothHandY * smoothHandOpenness;
  } else if (MODE === 'mouse') {
    audioDisorder = constrain(mouseY / height, 0, 1);
  } else {
    // Auto mode: normalize frontPosition to 0-1 range
    audioDisorder = constrain((frontPosition - FRONT_START) / (FRONT_END - FRONT_START), 0, 1);
  }
  updateAudio(audioDisorder);

  // The original artwork distributes increasing disorder spatially from top to bottom.
  // This animation unfolds that same transition progressively through time.
  //
  // Forward phase: rows behind the front are fully disordered and stay that way;
  // rows in the broad transition zone gradually move toward their target;
  // rows ahead of the front remain ordered. The disordered area only grows.
  //
  // Reverse phase: the same principle in reverse — rows behind the front are
  // fully ordered and stay that way; rows in the transition zone gradually return
  // to order; rows ahead of the front remain disordered. The ordered area only grows.
  for (let row = 0; row < ROWS; row++) {
    const rowProgress = row / (ROWS - 1);

    // Apply propagation direction: flip rowProgress for bottom → top
    const effectiveRowProgress = PROPAGATION_DIRECTION === 1 ? rowProgress : 1 - rowProgress;

    // Smooth cumulative transition using smoothstep.
    // rawDisorder = 0 for rows well behind the front, 1 for rows well ahead.
    const rawDisorder = smoothstep(
      frontPosition - FRONT_WIDTH / 2,
      frontPosition + FRONT_WIDTH / 2,
      effectiveRowProgress
    );

    // Forward: rows behind front → 1 (disordered), rows ahead → 0 (ordered)
    // Reverse: rows behind front → 0 (ordered), rows ahead → 1 (disordered)
    const localDisorder = isForward ? 1 - rawDisorder : rawDisorder;

    for (let col = 0; col < COLS; col++) {
      const idx = row * COLS + col;
      const sq = squares[idx];

      // Interpolate position and rotation using lerp().
      // At localDisorder = 0: square is at its grid position with zero rotation.
      // At localDisorder = 1: square is at its target displaced/rotated state,
      // exactly matching the static reconstruction.
      // intensity scales the fixed Schotter targets (hand openness or default 1).
      const x = lerp(sq.baseX, sq.baseX + sq.targetOffsetX * intensity, localDisorder);
      const y = lerp(sq.baseY, sq.baseY + sq.targetOffsetY * intensity, localDisorder);
      const angle = lerp(0, sq.targetRotation * intensity, localDisorder);

      push();
      translate(x, y);
      rotate(angle);
      rectMode(CENTER);
      rect(0, 0, SQUARE_SIZE, SQUARE_SIZE);
      pop();
    }
  }
}

// Initialize audio on first user interaction (browser autoplay policy)
function mousePressed() {
  if (!audioInitialized) {
    userStartAudio();
    initAudio();
  }
}

function keyPressed() {
  if (!audioInitialized) {
    userStartAudio();
    initAudio();
  }
}
