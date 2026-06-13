import { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useParams } from 'react-router-dom';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { initializeFaceLandmarker, getFaceLandmarker } from '../lib/faceTracking';
import { useStore } from '../store';
import { Share2, Disc3, Layers } from 'lucide-react';
import confetti from 'canvas-confetti';
import { ARAsset } from '../types';

// 3D Scene mapping head transform
function FaceAsset({ assetId, config }: { assetId?: string, config?: any }) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const [scene, setScene] = useState<any>(null);
  const assets = useStore(state => state.assets);
  const assetUrl = useMemo(() => assets.find(a => a.id === assetId)?.url, [assets, assetId]);

  useEffect(() => {
    if (assetUrl) {
      const loader = new GLTFLoader();
      loader.load(assetUrl, (gltf) => {
        setScene(gltf.scene);
      });
    } else {
      setScene(null);
    }
  }, [assetUrl]);

  useFrame(() => {
    const faceLandmarker = getFaceLandmarker();
    const video = document.getElementById('webcam-video') as HTMLVideoElement;
    if (!faceLandmarker || !video || !groupRef.current) return;

    if (video.readyState >= 2) {
      const results = faceLandmarker.detectForVideo(video, performance.now());
      if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
        const matrixArray = results.facialTransformationMatrixes[0].data;
        const matrix = new THREE.Matrix4().fromArray(matrixArray);
        
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(position, quaternion, scale);

        groupRef.current.position.copy(position);
        groupRef.current.quaternion.copy(quaternion);
        groupRef.current.position.z -= 10; 
        
        groupRef.current.visible = true;
      } else {
        groupRef.current.visible = false;
      }
    }
  });

  if (!assetId) return null;

  const s = config?.scale ?? 1;
  const cx = config?.x ?? 0;
  const cy = config?.y ?? 0;
  const cz = config?.z ?? 0;
  const rx = config?.rotX ?? 0;
  const ry = config?.rotY ?? 0;
  const rz = config?.rotZ ?? 0;

  return (
    <group ref={groupRef} visible={false}>
      {/* Apply local changes for the specific asset */}
      <group position={[cx, cy, cz]} rotation={[rx, ry, rz]} scale={[s, s, s]}>
        {scene ? (
          <primitive object={scene} />
        ) : (
          <group position={[0, cy, 0]}>
            <mesh position={[4, 5, 5]} rotation={[0, 0, 0]}>
              <torusGeometry args={[3, 0.5, 16, 100]} />
              <meshStandardMaterial color="#F27D26" />
            </mesh>
            <mesh position={[-4, 5, 5]} rotation={[0, 0, 0]}>
              <torusGeometry args={[3, 0.5, 16, 100]} />
              <meshStandardMaterial color="#F27D26" />
            </mesh>
            <mesh position={[0, 5, 5]}>
              <cylinderGeometry args={[0.5, 0.5, 2, 8]} />
              <meshStandardMaterial color="#D4AF37" />
              <lineSegments rotation={[0, 0, Math.PI / 2]} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}

export default function Booth() {
  const { id } = useParams<{ id: string }>(); // Extract experience ID
  const videoRef = useRef<HTMLVideoElement>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);
  const filterImgRef = useRef<HTMLImageElement>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [previewMedia, setPreviewMedia] = useState<{url: string, type: 'image'|'video'} | null>(null);
  const [message, setMessage] = useState('');
  
  const { assets, fetchAssets, currentFilter, setCurrentFilter } = useStore();

  useEffect(() => {
    const init = async () => {
      await fetchAssets();
    };
    init();
  }, [fetchAssets]);

  useEffect(() => {
    if (assets.length > 0 && id) {
      const filter = assets.find(a => a.id === id);
      if (filter) {
        setCurrentFilter(filter);
      }
    }
  }, [id, assets, setCurrentFilter]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    
    async function setupCamera() {
      try {
        await initializeFaceLandmarker();
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, 
          audio: true 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setIsInitializing(false);
      } catch (e) {
        console.error("Camera setup failed", e);
      }
    }
    
    setupCamera();

    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  const capturePhoto = () => {
    if (!videoRef.current || !compositeCanvasRef.current) return;
    
    const video = videoRef.current;
    const compositeCanvas = compositeCanvasRef.current;
    const ctx = compositeCanvas.getContext('2d');
    if (!ctx) return;

    compositeCanvas.width = 1080;
    compositeCanvas.height = 1920;

    const targetAspect = 9 / 16;
    const videoAspect = video.videoWidth / video.videoHeight;
    
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;

    if (videoAspect > targetAspect) {
      sw = video.videoHeight * targetAspect;
      sx = (video.videoWidth - sw) / 2;
    } else {
      sh = video.videoWidth / targetAspect;
      sy = (video.videoHeight - sh) / 2;
    }

    // Draw video (mirrored)
    ctx.translate(compositeCanvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, compositeCanvas.width, compositeCanvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform

    // Draw Three.js overlay
    const threeCanvas = document.querySelector('#three-canvas canvas') as HTMLCanvasElement;
    if (threeCanvas && currentFilter?.type === '3d') {
      ctx.drawImage(threeCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);
    }
    
    // Draw 2D Filter image if available
    if (filterImgRef.current && currentFilter?.type === '2d_filter') {
      const cfg = currentFilter.config || {};
      const scale = cfg.scale ?? 1;
      const xPercent = cfg.x ?? 0;
      const yPercent = cfg.y ?? 0;
      
      const w = compositeCanvas.width;
      const h = compositeCanvas.height;
      const img = filterImgRef.current;
      
      const imgAspect = img.width / img.height || 1;
      const canvasAspect = w / h;
      let drawW = w;
      let drawH = h;
      if (imgAspect > canvasAspect) {
         drawW = w;
         drawH = w / imgAspect;
      } else {
         drawH = h;
         drawW = h * imgAspect;
      }

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.translate(w * (xPercent / 100), h * (yPercent / 100));
      ctx.scale(scale, scale);
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }

    const dataUrl = compositeCanvas.toDataURL('image/jpeg', 0.9);
    setPreviewMedia({ url: dataUrl, type: 'image' });
  };

  const uploadToWall = async () => {
    if (!previewMedia) return;
    
    try {
      const blob = await fetch(previewMedia.url).then(r => r.blob());
      const formData = new FormData();
      formData.append('media', blob, previewMedia.type === 'video' ? 'video.webm' : 'photo.jpg');
      formData.append('type', previewMedia.type);
      if (message.trim()) {
        formData.append('message', message.trim());
      }

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      
      if (res.ok) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#F27D26', '#D4AF37', '#ffffff'] // brand colors
        });
        setPreviewMedia(null);
        setMessage('');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const isStandalone = !!id;

  return (
    <div className={`absolute inset-0 flex flex-col items-center justify-between p-4 pb-0 face-grid w-full overflow-hidden`}>
      {/* Background Glow Blobs for wider screens */}
      <div className="absolute top-0 left-0 w-[80vw] h-[80vw] max-w-[800px] max-h-[800px] bg-brand-orange/30 blur-[150px] rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2 z-0" />
      <div className="absolute bottom-0 right-0 w-[80vw] h-[80vw] max-w-[800px] max-h-[800px] bg-brand-gold/30 blur-[150px] rounded-full pointer-events-none translate-x-1/4 translate-y-1/4 z-0" />

      {isInitializing && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-brand-bg glass">
          <Disc3 className="w-12 h-12 text-brand-orange animate-spin mb-4" />
          <p className="text-[11px] uppercase tracking-[0.2em] opacity-60">Initializing Optics...</p>
        </div>
      )}

      {/* Main capture view */}
      <div className={`relative z-10 w-full max-w-sm aspect-[9/16] mx-auto mt-4 ${isStandalone ? 'mb-8' : 'mb-24'} bg-black rounded-3xl overflow-hidden glass border border-white/10 glow-gold shrink-0 ${previewMedia ? 'hidden' : 'block'}`}>
        {/* Video feed (mirrored) */}
        <video 
          id="webcam-video"
          ref={videoRef} 
          className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" 
          autoPlay 
          playsInline 
          muted 
        />
        
        {/* ThreeJS Overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <Canvas 
            id="three-canvas" 
            camera={{ position: [0, 0, 50], fov: 45 }} 
            gl={{ alpha: true, preserveDrawingBuffer: true }}
          >
            <ambientLight intensity={1} />
            <directionalLight position={[10, 10, 10]} intensity={2} />
            <FaceAsset 
              assetId={currentFilter?.type === '3d' ? currentFilter.id : undefined} 
              config={currentFilter?.config}
            />
          </Canvas>
        </div>
        
        {/* 2D Filter Overlay */}
        {currentFilter?.type === '2d_filter' && (
          <div className="absolute inset-0 w-full h-full pointer-events-none" style={{
            transform: `scale(${currentFilter.config?.scale ?? 1}) translate(${currentFilter.config?.x ?? 0}%, ${currentFilter.config?.y ?? 0}%)`,
            transformOrigin: 'center'
          }}>
            <img 
              ref={filterImgRef}
              src={currentFilter.url} 
              className="w-full h-full object-contain pointer-events-none" 
              alt="Filter overlay"
              crossOrigin="anonymous"
            />
          </div>
        )}

        {/* Temporary Composite Canvas (hidden) */}
        <canvas ref={compositeCanvasRef} className="hidden" />

        {/* Capture Controls */}
        <div className="absolute bottom-8 left-0 right-0 flex justify-center items-center gap-6 z-20">
          <button 
            onClick={capturePhoto}
            className="w-20 h-20 bg-white/20 hover:bg-white/40 transition-colors backdrop-blur-md rounded-full border-[6px] border-white flex items-center justify-center group"
          >
            <div className="w-14 h-14 bg-white rounded-full group-active:scale-90 transition-transform"></div>
          </button>
        </div>
      </div>

      {/* Asset Selection Drawer - Only visible if NOT standalone experience */}
      {!previewMedia && !isStandalone && (
        <div className="fixed bottom-0 left-0 right-0 h-24 glass flex items-center overflow-x-auto hide-scrollbar px-6 gap-4 z-40 bg-brand-bg/80">
          <button 
            onClick={() => setCurrentFilter(null)}
            className={`flex-shrink-0 w-16 h-16 rounded-full flex flex-col items-center justify-center gap-1 border-2 transition-colors ${!currentFilter ? 'border-brand-orange bg-brand-orange/10' : 'border-white/10 hover:border-white/30 bg-black/40'}`}
          >
            <Layers className={`w-6 h-6 ${!currentFilter ? 'text-brand-orange' : 'opacity-40'}`} />
            <span className="text-[9px] uppercase font-bold tracking-widest opacity-70">None</span>
          </button>
          
          {assets.map((asset) => (
            <button
              key={asset.id}
              onClick={() => setCurrentFilter(asset)}
              className={`flex-shrink-0 w-16 h-16 rounded-full overflow-hidden border-2 transition-colors relative flex items-center justify-center ${currentFilter?.id === asset.id ? 'border-brand-orange shadow-lg shadow-brand-orange/20 glow-orange' : 'border-white/10 hover:border-white/30 bg-black/40'}`}
            >
              {asset.type === '2d_filter' && asset.url ? (
                <img src={asset.url} className="w-full h-full object-cover opacity-70" alt={asset.name} />
              ) : (
                <div className="text-[9px] uppercase font-bold text-center leading-tight p-1 text-brand-gold">3D Asset</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Preview View */}
      {previewMedia && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center p-4 sm:p-6 hide-scrollbar overflow-hidden face-grid bg-black/90 backdrop-blur-2xl">
          <div className="flex-1 min-h-0 w-full max-w-sm max-h-[50vh] relative rounded-3xl overflow-hidden glass border border-white/10 glow-orange shrink-0 mt-4 sm:mt-8 bg-black/50 mx-auto">
             {previewMedia.type === 'video' ? (
                <video src={previewMedia.url} autoPlay loop muted playsInline className="w-full h-full object-contain" />
             ) : (
                <img src={previewMedia.url} className="w-full h-full object-contain" />
             )}
          </div>
          
          <div className="w-full max-w-sm mt-6 flex flex-col gap-3 shrink-0 mb-4 sm:mb-8 z-10">
            <div className="glass p-4 rounded-xl border border-white/10 bg-black/40">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write a message for the live wall..."
                className="w-full bg-transparent text-white border-none outline-none resize-none placeholder-white/40 text-sm font-medium"
                rows={2}
                maxLength={100}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => {
                  setPreviewMedia(null);
                  setMessage('');
                }}
                className="py-4 px-6 glass rounded-xl text-[10px] uppercase tracking-widest font-bold text-white hover:bg-white/10 transition-colors border border-white/10"
              >
                Retake
              </button>
              <button 
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = previewMedia.url;
                  link.download = `HOPE_GALA_${Date.now()}.${previewMedia.type === 'video' ? 'webm' : 'jpg'}`;
                  link.click();
                }}
                className="py-4 px-6 glass rounded-xl text-[10px] uppercase tracking-widest font-bold text-white hover:bg-white/10 transition-colors border border-white/10"
              >
                Download
              </button>
            </div>

            {navigator.share && (
              <button
                 onClick={async () => {
                   try {
                     const response = await fetch(previewMedia.url);
                     const blob = await response.blob();
                     const file = new File([blob], `hope_gala_2026_${Date.now()}.${previewMedia.type === 'video' ? 'webm' : 'jpg'}`, { type: blob.type });
                     await navigator.share({
                       title: 'Hope Gala 2026',
                       text: message || 'Check out my photo from the Hope Gala 2026!',
                       files: [file]
                     });
                   } catch (err) {
                     console.log('Error sharing', err);
                   }
                 }}
                 className="w-full py-4 bg-brand-orange/20 text-brand-orange hover:bg-brand-orange/30 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-colors flex items-center justify-center gap-2 border border-brand-orange/50"
              >
                <Share2 className="w-4 h-4" /> Share
              </button>
            )}

            <button 
              onClick={uploadToWall}
              className="w-full py-5 bg-gradient-to-r from-brand-orange to-brand-gold text-black rounded-xl text-[10px] uppercase tracking-[0.2em] font-bold glow-orange hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
            >
              <Share2 className="w-5 h-5" />
              Send to Live Wall
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


