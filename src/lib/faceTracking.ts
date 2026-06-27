import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let faceLandmarker: FaceLandmarker | null = null;
let initPromise: Promise<FaceLandmarker> | null = null;
const runningMode: 'IMAGE' | 'VIDEO' = 'VIDEO';

/**
 * WASM is served from our OWN origin (see scripts/copy-mediapipe.mjs), so its
 * version always matches the @mediapipe/tasks-vision JS we import. Loading the
 * WASM from a hardcoded CDN version that drifted away from the package produced
 * malformed facial-transform matrices, which placed AR assets off the face.
 */
const WASM_PATH = '/mediapipe/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

async function create(delegate: 'GPU' | 'CPU'): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    // Blendshapes are unused for asset attachment — skipping them saves work.
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
    runningMode,
    numFaces: 1,
  });
}

export async function initializeFaceLandmarker() {
  if (faceLandmarker) return faceLandmarker;
  if (initPromise) return initPromise;

  // IMPORTANT: use the CPU delegate. The booth runs alongside React-Three-Fiber
  // and the shader runner, which each hold their own WebGL context. MediaPipe's
  // GPU delegate competes for / loses that shared context, which made live
  // tracking work for ~1s and then stop (the asset would detach from the face).
  // The CPU delegate (XNNPACK) is plenty fast for single-face landmarks and is
  // rock-solid next to other WebGL canvases.
  initPromise = (async () => {
    try {
      faceLandmarker = await create('CPU');
    } catch (cpuErr) {
      console.warn('[faceTracking] CPU delegate failed, trying GPU', cpuErr);
      faceLandmarker = await create('GPU');
    }
    return faceLandmarker;
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null; // allow a later retry
    console.error('Error initializing FaceLandmarker', error);
    throw error;
  }
}

export function getFaceLandmarker() {
  return faceLandmarker;
}
