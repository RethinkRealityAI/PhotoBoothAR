import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let faceLandmarker: FaceLandmarker | null = null;
let runningMode: 'IMAGE' | 'VIDEO' = 'VIDEO';

export async function initializeFaceLandmarker() {
  if (faceLandmarker) return faceLandmarker;

  try {
    const vision = await FilesetResolver.forVisionTasks(
      // Fetch WebAssembly files from the CDN
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );
    
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: 'GPU'
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode,
      numFaces: 1
    });

    return faceLandmarker;
  } catch (error) {
    console.error("Error initializing FaceLandmarker", error);
    throw error;
  }
}

export function getFaceLandmarker() {
  return faceLandmarker;
}
