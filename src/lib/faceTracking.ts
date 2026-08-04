import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let faceLandmarker: FaceLandmarker | null = null;
let initPromise: Promise<FaceLandmarker> | null = null;
const runningMode: 'IMAGE' | 'VIDEO' = 'VIDEO';

/**
 * WASM is served from our OWN origin (see scripts/copy-mediapipe.mjs), so its
 * version always matches the @mediapipe/tasks-vision JS we import. Loading the
 * WASM from a hardcoded CDN version that drifted away from the package produced
 * malformed facial-transform matrices, which placed AR assets off the face.
 *
 * Exported for handTracking.ts — both landmarkers resolve the same fileset.
 */
export const MEDIAPIPE_WASM_PATH = '/mediapipe/wasm';
const WASM_PATH = MEDIAPIPE_WASM_PATH;

/**
 * ONE FilesetResolver promise shared by every vision task. Sharing saves the
 * duplicate wasm download + parse when the hand landmarker joins; each task
 * still instantiates its own wasm runtime (heaps are not shared).
 */
let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
export function visionFileset() {
  if (filesetPromise === null) filesetPromise = FilesetResolver.forVisionTasks(WASM_PATH);
  return filesetPromise;
}

/**
 * The landmark model, preferred from our OWN origin for exactly the reason the
 * WASM is — except this one is also on the booth's critical path: without it the
 * tracker never acquires, the head group stays invisible and NO 3D renders at
 * all. A venue with bad wifi is the normal case, not the edge case.
 *
 * The vendored copy arrives via scripts/remote-assets.json (pushing that file
 * triggers the fetch-remote-assets workflow, which has the egress this sandbox
 * lacks). Until it lands, the remote copy is used and behaviour is unchanged.
 */
const LOCAL_MODEL_URL = '/models/face_landmarker.task';
const REMOTE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * Pick the vendored model when it is really there. A plain `res.ok` is not
 * enough: both the Vite dev server and Netlify answer an unknown path with
 * index.html at 200, so an un-vendored build would "find" the model and hand
 * MediaPipe a page of HTML. Content-type is what distinguishes them.
 *
 * Generalized (local, remote) for handTracking.ts — same trap, same guard.
 */
export async function resolveModelUrl(localUrl: string, remoteUrl: string): Promise<string> {
  try {
    const res = await fetch(localUrl, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && !type.includes('text/html')) return localUrl;
  } catch {
    // Offline, blocked, or not vendored yet — the remote copy still works.
  }
  return remoteUrl;
}

async function create(delegate: 'GPU' | 'CPU', modelUrl: string): Promise<FaceLandmarker> {
  const vision = await visionFileset();
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    // Blendshapes power face-triggered effects (src/lib/studio/triggers.ts).
    // With this on, FaceLandmarkerResult carries `faceBlendshapes: Classifications[]`
    // (vision.d.ts:697), each `{ categories: Category[] }` where a Category is
    // `{ score:number; index:number; categoryName:string; displayName:string }`
    // (vision.d.ts:87). Pose-only consumers (updateHeadPose) read only
    // `facialTransformationMatrixes` and ignore this extra field, so legacy
    // events render byte-identically; the only cost is the extra head's compute.
    outputFaceBlendshapes: true,
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
    const modelUrl = await resolveModelUrl(LOCAL_MODEL_URL, REMOTE_MODEL_URL);
    try {
      faceLandmarker = await create('CPU', modelUrl);
    } catch (cpuErr) {
      console.warn('[faceTracking] CPU delegate failed, trying GPU', cpuErr);
      faceLandmarker = await create('GPU', modelUrl);
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

let warnedUninitialized = false;

export function getFaceLandmarker() {
  // Loud one-shot diagnostic for the silent-failure wiring bug: a caller is
  // polling for the landmarker but NOBODY ever started initialization — every
  // face-tracked surface would just quietly never track. (A pending
  // initPromise is fine — that's normal loading, not a wiring bug.)
  if (!faceLandmarker && !initPromise && !warnedUninitialized) {
    warnedUninitialized = true;
    console.warn(
      '[faceTracking] getFaceLandmarker() called but initializeFaceLandmarker() was never invoked — face tracking will not work on this surface.',
    );
  }
  return faceLandmarker;
}

/** True once the landmarker is ready (for "loading tracker…" UI states). */
export function isFaceLandmarkerReady(): boolean {
  return faceLandmarker !== null;
}
