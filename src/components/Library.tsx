import { useEffect } from 'react';
import { useStore } from '../store';
import { QRCodeSVG } from 'qrcode.react';
import { Share, ExternalLink } from 'lucide-react';

export default function Library() {
  const { assets, fetchAssets } = useStore();

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="absolute inset-0 overflow-y-auto p-8 hide-scrollbar face-grid">
      <div className="max-w-6xl mx-auto space-y-8 pb-12">
        <div className="glass p-8 rounded-3xl border border-white/10 glow-orange text-center max-w-2xl mx-auto mt-8">
          <h1 className="text-3xl font-serif italic text-white mb-2">Experiences Library</h1>
          <p className="text-[10px] uppercase tracking-[0.2em] opacity-60">Manage your published AR Filters and Photo Frames</p>
        </div>

        {assets.length === 0 ? (
          <div className="text-center p-12 glass rounded-2xl border border-white/10">
            <p className="opacity-50 text-[11px] uppercase tracking-widest">No experiences published yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {assets.map((asset) => {
              const experienceUrl = `${origin}/experience/${asset.id}`;
              
              return (
                <div key={asset.id} className="glass rounded-2xl border border-white/10 overflow-hidden flex flex-col group hover:glow-gold transition-all">
                  
                  {/* Thumbnail */}
                  <div className="aspect-video bg-black/40 relative flex items-center justify-center border-b border-white/10 overflow-hidden">
                    {asset.type === '2d_filter' && asset.url ? (
                       <img src={asset.url} className="absolute inset-0 w-full h-full object-contain p-4 drop-shadow-xl" alt={asset.name} />
                    ) : (
                      <div className="font-serif italic text-xl opacity-60 text-brand-gold">
                        3D Asset
                      </div>
                    )}
                    <div className="absolute top-4 right-4 bg-brand-bg/80 backdrop-blur text-[9px] uppercase tracking-widest px-3 py-1 rounded-full border border-white/10 text-brand-orange">
                      {asset.type === '2d_filter' ? '2D Photo Frame' : '3D Face Tracking'}
                    </div>
                  </div>

                  <div className="p-6 flex flex-col gap-6">
                    <div>
                      <h3 className="font-serif italic text-2xl text-white mb-1 group-hover:text-brand-orange transition-colors">{asset.name}</h3>
                      <p className="text-[10px] font-mono text-white/40 break-all">{asset.id}</p>
                    </div>

                    <div className="glass p-6 rounded-xl border border-white/5 flex flex-col items-center justify-center gap-4 bg-white/5">
                      <div className="bg-white p-4 rounded-xl shadow-xl">
                        <QRCodeSVG value={experienceUrl} size={150} fgColor="#000" bgColor="#fff" />
                      </div>
                      <p className="text-[9px] uppercase tracking-[0.2em] opacity-60">Scan to Launch</p>
                    </div>

                    <div className="flex gap-3">
                       <button 
                         onClick={() => {
                           navigator.clipboard.writeText(experienceUrl);
                           alert('Link copied to clipboard!');
                         }}
                         className="flex-1 py-3 glass hover:bg-white/10 border border-white/10 rounded-xl flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest transition-colors font-bold"
                       >
                         <Share className="w-4 h-4" /> Copy Link
                       </button>
                       <a 
                         href={experienceUrl}
                         target="_blank"
                         rel="noreferrer"
                         className="flex-1 py-3 bg-gradient-to-r from-brand-orange to-brand-gold hover:opacity-90 text-black rounded-xl flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest transition-colors font-bold"
                       >
                         <ExternalLink className="w-4 h-4" /> Open
                       </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
