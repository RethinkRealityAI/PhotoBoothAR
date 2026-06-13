import { useEffect, useState, useRef } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { Play, Grid } from 'lucide-react';

export default function Wall() {
  const { posts, fetchPosts } = useStore();
  const [mode, setMode] = useState<'grid' | 'slideshow'>('grid');
  const [currentIndex, setCurrentIndex] = useState(0);
  const prevPostsLength = useRef(posts.length);

  useEffect(() => {
    fetchPosts();
    const interval = setInterval(fetchPosts, 5000);
    return () => clearInterval(interval);
  }, [fetchPosts]);

  useEffect(() => {
    if (posts.length > prevPostsLength.current) {
      // Stream animation (confetti for now)
      confetti({
        particleCount: 50,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#F27D26', '#D4AF37', '#ffffff']
      });
      confetti({
        particleCount: 50,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#F27D26', '#D4AF37', '#ffffff']
      });
      prevPostsLength.current = posts.length;
    }
  }, [posts.length]);

  useEffect(() => {
    if (mode === 'slideshow' && posts.length > 0) {
      const timer = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % posts.length);
      }, 5000); // 5 seconds per slide
      return () => clearInterval(timer);
    }
  }, [mode, posts.length]);

  return (
    <div className="absolute inset-0 overflow-y-auto w-full h-full p-6 sm:p-10 hide-scrollbar face-grid relative">
      {/* Background Glow Blobs for wider screens */}
      <div className="fixed top-0 left-0 w-[80vw] h-[80vw] max-w-[800px] max-h-[800px] bg-brand-orange/30 blur-[150px] rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2 z-0" />
      <div className="fixed bottom-0 right-0 w-[80vw] h-[80vw] max-w-[800px] max-h-[800px] bg-brand-gold/30 blur-[150px] rounded-full pointer-events-none translate-x-1/4 translate-y-1/4 z-0" />

      <div className="max-w-7xl mx-auto flex flex-col h-full relative z-10">
        {mode === 'grid' && (
          <div className="mb-10 text-center glass py-12 rounded-3xl border border-white/10 glow-gold relative shrink-0">
            <div className="absolute top-6 right-6 flex items-center gap-4">
               <button onClick={() => setMode('slideshow')} className="p-3 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 transition-colors text-white">
                 <Play className="w-5 h-5 ml-1" />
               </button>
            </div>
            <h1 className="text-4xl sm:text-6xl font-serif italic tracking-wide text-white mb-4 drop-shadow-xl text-transparent">
              Live Photo Wall
            </h1>
            <p className="text-[11px] uppercase tracking-[0.2em] opacity-50">
              Capturing the spirit of the SCAGO Hope Gala 2026.
            </p>
          </div>
        )}

        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/40 text-[11px] uppercase tracking-[0.2em] flex-1">
            <p>No posts yet! Be the first to take a photo at the Booth.</p>
          </div>
        ) : mode === 'slideshow' ? (
          <div className="flex-1 relative flex items-center justify-center overflow-hidden min-h-[600px] bg-black/40 rounded-3xl border border-white/10 glass">
             <div className="absolute top-6 right-6 z-50">
               <button onClick={() => setMode('grid')} className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 transition-colors text-white text-[10px] uppercase tracking-widest font-bold flex items-center gap-2">
                 <Grid className="w-4 h-4" /> View Grid
               </button>
             </div>
             <AnimatePresence mode="wait">
                <motion.div
                  key={currentIndex}
                  initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
                  transition={{ duration: 0.8, ease: "easeInOut" }}
                  className="w-full h-full max-w-4xl max-h-[80vh] flex flex-col relative items-center justify-center p-8 group"
                >
                  {posts[currentIndex].type === 'video' ? (
                    <video 
                      src={posts[currentIndex].url} 
                      autoPlay loop muted playsInline
                      className="max-w-full max-h-full object-contain rounded-2xl drop-shadow-2xl border border-white/10"
                    />
                  ) : (
                    <img 
                      src={posts[currentIndex].url} 
                      className="max-w-full max-h-full object-contain rounded-2xl drop-shadow-2xl border border-white/10"
                      loading="lazy"
                    />
                  )}
                  {posts[currentIndex].message && (
                    <div className="absolute bottom-16 inset-x-0 mx-auto w-max max-w-xl text-center glass px-8 py-6 rounded-2xl border border-white/10 glow-orange">
                       <p className="font-serif italic text-2xl text-white">{posts[currentIndex].message}</p>
                    </div>
                  )}
                </motion.div>
             </AnimatePresence>
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-6 space-y-6 pb-20">
            {posts.map((post, i) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="w-full break-inside-avoid relative group rounded-2xl overflow-hidden glass border border-white/10"
              >
                {post.type === 'video' ? (
                  <video 
                    src={post.url} autoPlay loop muted playsInline
                    className="w-full h-auto object-cover opacity-90"
                  />
                ) : (
                  <img 
                    src={post.url} alt="Hope Gala entry" 
                    className="w-full h-auto object-cover opacity-90" loading="lazy"
                  />
                )}
                
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6">
                  {post.message && (
                    <p className="font-serif italic text-lg text-white mb-2 line-clamp-3 leading-snug">"{post.message}"</p>
                  )}
                  <span className="font-mono text-[9px] uppercase tracking-widest text-brand-gold">
                    {new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

