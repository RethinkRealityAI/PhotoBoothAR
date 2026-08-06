import { HandLandmarker } from '@mediapipe/tasks-vision';
import { resolveModelUrl, visionFileset } from './faceTracking';

let handLandmarker: HandLandmarker | null = null;
let initPromise: Promise<HandLandmarker> | null = null;

/**
 * The hand model rides the same vendoring pipeline as the face model
 * (scripts/remote-assets.json → public/models/), with the same content-type
 * guard against the SPA index.html-at-200 trap, and the same remote fallback
 * so nothing blocks before the Action lands the file. 7.8MB — the published
 * bundle is the FULL detector+landmark pair; no lite bundle exists upstream.
 */
const LOCAL_MODEL_URL = '/models/hand_landmarker.task';
const REMOTE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function create(delegate: 'GPU' | 'CPU', modelUrl: string): Promise<HandLandmarker> {
  const vision = await visionFileset();
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: 'VIDEO',
    // One hand: every shipped gesture is one-handed and numHands:2 doubles the
    // landmark-model cost on the exact devices already paying for face tracking.
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/**
 * Lazily initialize the hand landmarker. Callers gate on hasHandSource(), so a
 * scene without hand triggers never even downloads the model — which keeps
 * every legacy event byte-identical in behaviour and bandwidth.
 */
export async function initializeHandLandmarker() {
  if (handLandmarker) return handLandmarker;
  if (initPromise) return initPromise;

  // CPU delegate, same reason as faceTracking.ts:68 and doubly so: MediaPipe's
  // GPU delegate loses the WebGL context shared with R3F + the shader runner
  // (face tracking died after ~1s on GPU), and a SECOND GPU task would add a
  // third context to the fight. XNNPACK handles 224×224 hand landmarks fine.
  initPromise = (async () => {
    const modelUrl = await resolveModelUrl(LOCAL_MODEL_URL, REMOTE_MODEL_URL);
    try {
      handLandmarker = await create('CPU', modelUrl);
    } catch (cpuErr) {
      console.warn('[handTracking] CPU delegate failed, trying GPU', cpuErr);
      handLandmarker = await create('GPU', modelUrl);
    }
    return handLandmarker;
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null; // allow a later retry
    console.error('Error initializing HandLandmarker', error);
    throw error;
  }
}

export function getHandLandmarker() {
  return handLandmarker;
}

/** True once the landmarker is ready (for hint/loading UI states). */
export function isHandLandmarkerReady(): boolean {
  return handLandmarker !== null;
}
