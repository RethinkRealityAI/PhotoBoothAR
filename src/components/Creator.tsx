import { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, Save, Disc3, Settings2, Box, Image as ImageIcon, Sparkles, Move, RotateCw, Maximize, Pause, Play, Video } from 'lucide-react';
import { useStore } from '../store';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import { useNavigate } from 'react-router-dom';
import { GLTFLoader } from 'three-stdlib';
import * as THREE from 'three';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { initializeFaceLandmarker, getFaceLandmarker } from '../lib/faceTracking';

function DragHandle() {
  return (
    <PanelResizeHandle className="w-2 bg-brand-bg transition-colors hover:bg-white/10 flex flex-col items-center justify-center cursor-col-resize z-50 group border-x border-white/5">
      <div className="w-0.5 h-8 bg-white/20 group-hover:bg-brand-orange rounded-full transition-colors" />
    </PanelResizeHandle>
  );
}

// Loads the model and allows Transform controls
function LoadedModel({ url, scale, x, y, z, rotX, rotY, rotZ, mode, onUpdate }: any) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!url || url === '3d_model_selected') return;
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      setScene(gltf.scene);
    });
  }, [url]);

  // Synchronize initial prop values to ref when they change externally
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.set(x, y, z);
      groupRef.current.rotation.set(rotX, rotY, rotZ);
      groupRef.current.scale.set(scale, scale, scale);
    }
  }, [x, y, z, rotX, rotY, rotZ, scale]);

  if (!scene && url !== '3d_model_selected') return null;

  return (
    <TransformControls 
      mode={mode} 
      onMouseUp={() => {
        if (groupRef.current) {
          onUpdate({
            x: groupRef.current.position.x,
            y: groupRef.current.position.y,
            z: groupRef.current.position.z,
            rotX: groupRef.current.rotation.x,
            rotY: groupRef.current.rotation.y,
            rotZ: groupRef.current.rotation.z,
            scale: groupRef.current.scale.x
          });
        }
      }}
    >
      <group ref={groupRef}>
         {scene ? <primitive object={scene} /> : (
           <mesh>
             <boxGeometry args={[1, 0.4, 0.5]} />
             <meshStandardMaterial color="#F27D26" />
           </mesh>
         )}
      </group>
    </TransformControls>
  );
}

// Live Face Rig attached to webcam
function LiveFaceRig({ isPaused }: { isPaused: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame(() => {
    if (isPaused) return;

    const faceLandmarker = getFaceLandmarker();
    const video = document.getElementById('creator-video') as HTMLVideoElement;
    if (!faceLandmarker || !video || !groupRef.current || video.readyState < 2) return;

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
      groupRef.current.position.z -= 10; // offset slightly back 
      groupRef.current.visible = true;
    } else {
      groupRef.current.visible = false;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh>
        <sphereGeometry args={[0.01, 8, 8]} />
        <meshBasicMaterial color="#F27D26" wireframe transparent opacity={0} />
      </mesh>
    </group>
  );
}

export default function Creator() {
  const [filterType, setFilterType] = useState<'2d_filter' | '3d'>('2d_filter');
  const [filterName, setFilterName] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // 3D config
  const [scale, setScale] = useState(1);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [z, setZ] = useState(0);
  const [rotX, setRotX] = useState(0);
  const [rotY, setRotY] = useState(0);
  const [rotZ, setRotZ] = useState(0);
  
  // Transform Controls mode
  const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  
  // Video and AI
  const [isPaused, setIsPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const { fetchAssets } = useStore();

  useEffect(() => {
    // Start Webcam
    navigator.mediaDevices.getUserMedia({ 
      video: { width: 1280, height: 720, facingMode: 'user' } 
    }).then(stream => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    }).catch(e => console.error(e));

    initializeFaceLandmarker();

    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      
      if (filterType === '2d_filter') {
        const reader = new FileReader();
        reader.onload = (ev) => setPreviewImage(ev.target?.result as string);
        reader.readAsDataURL(selected);
      } else {
        setPreviewImage(URL.createObjectURL(selected));
      }
    }
    // reset input so same file can be selected again
    e.target.value = '';
  };

  const handleGenerate = async () => {
    if (!aiPrompt) return;
    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, type: filterType })
      });
      const data = await res.json();
      if (data.dataUrl) {
        setPreviewImage(data.dataUrl);
        const svgData = decodeURIComponent(data.dataUrl.split(',')[1]);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const newFile = new File([blob], 'ai-filter.svg', { type: 'image/svg+xml' });
        setFile(newFile);
        if (!filterName) setFilterName('AI: ' + aiPrompt);
      } else {
        alert(data.error || 'Failed to generate');
      }
    } catch (e) {
      alert('Error generating asset.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!file || !filterName) return;
    setIsUploading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', filterType);
    formData.append('name', filterName);
    
    // Config differs by type
    const config = filterType === '3d' 
      ? { scale, x, y, z, rotX, rotY, rotZ }
      : { scale, x, y };

    formData.append('config', JSON.stringify(config));

    try {
      await fetch('/api/assets', {
        method: 'POST',
        body: formData
      });
      await fetchAssets();
      
      navigate('/admin/library');
    } catch (e) {
      console.error(e);
      alert('Failed to save filter.');
      setIsUploading(false);
    }
  };

  return (
    <div className="absolute inset-0 flex bg-brand-bg text-white face-grid overflow-hidden font-sans">
      <PanelGroup orientation="horizontal" className="w-full h-full flex-1">
        <Panel defaultSize={20} minSize={15} maxSize={30} className="flex flex-col glass z-10 border-r border-white/10 shrink-0 relative p-6 hide-scrollbar overflow-y-auto">
          <h3 className="text-[11px] uppercase tracking-[0.2em] opacity-40 mb-6 flex items-center gap-2">
            <Settings2 className="w-4 h-4" /> Asset Settings
          </h3>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-brand-orange">Asset Name</label>
              <input 
                type="text" 
                value={filterName}
                onChange={e => setFilterName(e.target.value)}
                placeholder="e.g. Neon Gala Border"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 placeholder-white/20 text-white focus:outline-none focus:border-brand-orange transition-colors text-sm font-light"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-brand-orange">Asset Type</label>
              <select 
                value={filterType}
                onChange={(e) => {
                  setFilterType(e.target.value as any);
                  setFile(null);
                  setPreviewImage(null);
                }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-orange transition-colors text-sm font-light appearance-none"
              >
                <option value="2d_filter">2D Overlay / Sticker</option>
                <option value="3d">3D Face Attachment</option>
              </select>
            </div>

            {filterType === '2d_filter' && (
              <div className="pt-6 border-t border-white/10 space-y-4">
                <h3 className="text-[11px] uppercase tracking-[0.2em] opacity-80 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-brand-orange" /> Magic Generator
                </h3>
                <div className="space-y-2">
                  <textarea 
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    placeholder="Describe a filter (e.g. 'A gold sparkling photo frame border')"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-orange transition-colors text-sm font-light resize-none"
                    rows={3}
                  />
                  <button 
                    onClick={handleGenerate}
                    disabled={isGenerating || !aiPrompt}
                    className="w-full py-3 bg-brand-orange/20 text-brand-orange hover:bg-brand-orange/30 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isGenerating ? <Disc3 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {isGenerating ? 'Generating...' : 'Generate with AI'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-auto pt-6 flex flex-col gap-4">
            <input 
              ref={fileInputRef}
              type="file" 
              accept={filterType === '2d_filter' ? 'image/png' : '.glb,.gltf'}
              className="hidden" 
              onChange={handleFileChange}
            />
            <button 
              onClick={handleSave}
              disabled={!file || !filterName || isUploading}
              className="w-full h-14 bg-gradient-to-r from-brand-orange to-brand-gold text-black font-bold text-[10px] uppercase tracking-[0.2em] rounded-xl glow-orange disabled:opacity-50 disabled:grayscale transition-all flex items-center justify-center gap-3 shrink-0"
            >
              {isUploading ? <Disc3 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isUploading ? 'Publishing...' : 'Publish Asset'}
            </button>
          </div>
        </Panel>

        <DragHandle />

        {/* Workspace Canvas Panel */}
        <Panel className="relative flex flex-col items-center justify-center bg-black/60 p-4 sm:p-8">
           <div className={`absolute inset-4 sm:inset-8 rounded-3xl overflow-hidden glass border border-white/10 glow-gold shadow-2xl transition-opacity duration-1000 ${previewImage ? 'opacity-100' : 'opacity-20 bg-black/60 backdrop-blur-sm'}`}>
              
              {/* Upload CTA Header if nothing loaded */}
              {!previewImage && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 pointer-events-none text-center">
                    <div className="w-24 h-24 rounded-full glass border border-white/20 flex items-center justify-center opacity-70">
                       <Upload className="w-10 h-10 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-serif italic mb-2">Upload Asset</h2>
                      <p className="text-sm opacity-60 max-w-sm">Use the panel on the right or click below to upload your {filterType === '3d' ? '3D Model (.glb/.gltf)' : '2D PNG Image'}.</p>
                    </div>
                    <button 
                       onClick={() => fileInputRef.current?.click()}
                       className="pointer-events-auto px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/20 shadow-xl rounded-full text-xs font-bold uppercase tracking-widest transition-colors backdrop-blur-md glow-orange"
                    >
                      Select File
                    </button>
                </div>
              )}

              {/* Webcam Video Feed */}
              {filterType === '3d' && (
                <video 
                  id="creator-video"
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className={`absolute inset-0 w-full h-full object-cover scale-x-[-1] transition-opacity ${isPaused ? 'opacity-30' : 'opacity-100'}`}
                />
              )}

             {filterType === '3d' && previewImage && (
               <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 glass px-4 py-2 rounded-full border border-white/10 pointer-events-auto">
                  <button 
                    data-active={mode === 'translate'} 
                    onClick={() => setMode('translate')}
                    className="p-2 rounded hover:bg-white/10 text-white/50 data-[active=true]:text-brand-orange data-[active=true]:bg-brand-orange/20 transition-all pointer-events-auto"
                    title="Translate"
                  >
                    <Move className="w-4 h-4" />
                  </button>
                  <button 
                    data-active={mode === 'rotate'} 
                    onClick={() => setMode('rotate')}
                    className="p-2 rounded hover:bg-white/10 text-white/50 data-[active=true]:text-brand-orange data-[active=true]:bg-brand-orange/20 transition-all pointer-events-auto"
                    title="Rotate"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <button 
                    data-active={mode === 'scale'} 
                    onClick={() => setMode('scale')}
                    className="p-2 rounded hover:bg-white/10 text-white/50 data-[active=true]:text-brand-orange data-[active=true]:bg-brand-orange/20 transition-all pointer-events-auto"
                    title="Scale"
                  >
                    <Maximize className="w-4 h-4" />
                  </button>
               </div>
             )}

             {filterType === '3d' && previewImage && (
               <div className="absolute top-6 right-6 z-20 flex items-center gap-4 glass px-4 py-2 rounded-full border border-white/10 pointer-events-auto">
                  <span className="text-[10px] uppercase tracking-widest font-bold opacity-60 flex items-center gap-2">
                    <Video className="w-3 h-3" /> Live Face Tracking
                  </span>
                  <button 
                    onClick={() => setIsPaused(!isPaused)}
                    className={`p-2 rounded text-white ${isPaused ? 'bg-brand-orange/20 text-brand-orange' : 'hover:bg-white/10'} pointer-events-auto`}
                    title={isPaused ? "Resume Live Tracking" : "Pause Tracking to adjusting scale/position easily"}
                  >
                    {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  </button>
               </div>
             )}

              {filterType === '2d_filter' ? (
                <div 
                   className="absolute inset-0 w-full h-full flex flex-col items-center justify-center cursor-pointer"
                   onClick={!previewImage ? () => fileInputRef.current?.click() : undefined}
                >
                  {previewImage && (
                    <div className="absolute inset-0 w-full h-full pointer-events-none" style={{ transform: `scale(${scale}) translate(${x}%, ${y}%)`, transformOrigin: 'center' }}>
                      <img src={previewImage} className="w-full h-full object-contain p-4 drop-shadow-2xl" alt="Preview" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="absolute inset-0 w-full h-full z-10 pointer-events-auto">
                   <Canvas camera={{ position: [0, 0, 50], fov: 45 }} gl={{ alpha: true }}>
                      <ambientLight intensity={1.5} />
                      <directionalLight position={[10, 10, 10]} intensity={3} />
                      <OrbitControls makeDefault enablePan={!previewImage} enableZoom={!previewImage} enableRotate={!previewImage} />
                      
                      {!previewImage && (
                        <group position={[0,0,0]}>
                           <mesh position={[0, -0.5, 0]}>
                             <cylinderGeometry args={[2, 2, 4, 32]} />
                             <meshBasicMaterial color="#ffffff" wireframe opacity={0.3} transparent />
                           </mesh>
                        </group>
                      )}

                      {previewImage && (
                        <group>
                           {/* Add FaceRig to ensure we track properly */}
                           <LiveFaceRig isPaused={isPaused} />
                           {/* Load model but we let TransformControls manage it */}
                           <LoadedModel 
                             url={previewImage} 
                             scale={scale} 
                             x={x} y={y} z={z} 
                             rotX={rotX} rotY={rotY} rotZ={rotZ} 
                             mode={mode}
                             onUpdate={(newVals: any) => {
                               setX(newVals.x);
                               setY(newVals.y);
                               setZ(newVals.z);
                               setRotX(newVals.rotX);
                               setRotY(newVals.rotY);
                               setRotZ(newVals.rotZ);
                               setScale(newVals.scale);
                             }}
                           />
                        </group>
                      )}
                    </Canvas>
                </div>
              )}

              {filterType === '2d_filter' && previewImage && (
                <button onClick={() => { setPreviewImage(null); setFile(null); }} className="absolute top-4 right-4 bg-black/50 backdrop-blur px-3 py-1 text-[10px] uppercase font-bold rounded-full text-white/60 hover:text-white border border-white/10 z-20 transition-colors">Clear Overlay</button>
              )}
           </div>

           {/* Manual Sliders Overlay for 2D Mode */}
           {filterType === '2d_filter' && previewImage && (
             <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-sm glass p-6 rounded-3xl border border-white/10 z-30 shadow-2xl bg-black/40 backdrop-blur-xl">
               <h3 className="text-[11px] uppercase tracking-[0.2em] opacity-80 mb-4 font-bold text-center">Transform Settings</h3>
               <div className="space-y-4">
                 {[{ label: 'Scale Factor', val: scale, set: setScale, min: 0.1, max: 3, step: 0.1 },
                   { label: 'Offset X (%)', val: x, set: setX, min: -100, max: 100, step: 1 },
                   { label: 'Offset Y (%)', val: y, set: setY, min: -100, max: 100, step: 1 }
                 ].map((ctrl) => (
                   <div className="space-y-1" key={ctrl.label}>
                     <div className="flex justify-between text-[10px] uppercase tracking-widest opacity-60">
                       <span>{ctrl.label}</span>
                       <span>{ctrl.val}</span>
                     </div>
                     <input type="range" min={ctrl.min} max={ctrl.max} step={ctrl.step} value={ctrl.val} onChange={e => ctrl.set(parseFloat(e.target.value))} className="w-full accent-brand-orange" />
                   </div>
                 ))}
               </div>
             </div>
           )}

        </Panel>
        
        {/* Helper Panel optionally for future expansion or 3D specific settings */}
        <DragHandle />
        
        <Panel defaultSize={20} minSize={15} maxSize={30} className="flex flex-col glass z-10 border-l border-white/10 p-6 hide-scrollbar overflow-y-auto">
            <h3 className="text-[11px] uppercase tracking-[0.2em] opacity-40 mb-6 flex items-center gap-2">
              <Box className="w-4 h-4" /> Properties
            </h3>
            
            {filterType === '3d' && previewImage ? (
               <div className="space-y-6">
                 <div>
                   <p className="text-xs font-light opacity-60 leading-relaxed mb-6">
                     Use the gizmos directly in the canvas to visually position your model. To freeze the face from moving while editing, click the Pause button above the camera preview.
                   </p>
                 </div>
                 <div className="space-y-4 pt-6 border-t border-white/10">
                    {[{ label: 'Scale', val: scale, set: setScale, min: 0.1, max: 10, step: 0.1 },
                      { label: 'Translation X', val: x, set: setX, min: -10, max: 10, step: 0.1 },
                      { label: 'Translation Y', val: y, set: setY, min: -10, max: 10, step: 0.1 },
                      { label: 'Translation Z', val: z, set: setZ, min: -10, max: 10, step: 0.1 }
                    ].map((ctrl) => (
                      <div className="space-y-1" key={ctrl.label}>
                        <div className="flex justify-between text-[10px] uppercase tracking-widest opacity-60">
                          <span>{ctrl.label}</span>
                          <span>{ctrl.val.toFixed(2)}</span>
                        </div>
                        <input type="range" min={ctrl.min} max={ctrl.max} step={ctrl.step} value={ctrl.val} onChange={e => ctrl.set(parseFloat(e.target.value))} className="w-full accent-brand-orange" />
                      </div>
                    ))}
                 </div>
                 <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-4 mt-4 glass border border-white/10 hover:bg-white/10 transition-colors uppercase tracking-[0.2em] text-[10px] font-bold rounded-xl"
                 >
                   Replace 3D Model
                 </button>
               </div>
            ) : (
               <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
                  <Settings2 className="w-8 h-8 mb-4 border border-white/20 p-1.5 rounded-full" />
                  <p className="text-xs uppercase tracking-widest">Select an asset to view advanced properties.</p>
               </div>
            )}
        </Panel>
      </PanelGroup>
    </div>
  );
}
