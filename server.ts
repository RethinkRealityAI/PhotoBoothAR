import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directories exist
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const ASSETS_DIR = path.join(process.cwd(), 'assets_storage');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// Set up multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (req.originalUrl.includes('assets')) {
      cb(null, ASSETS_DIR);
    } else {
      cb(null, UPLOADS_DIR);
    }
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '';
    const name = crypto.randomUUID();
    cb(null, `${name}${ext}`);
  }
});

const upload = multer({ storage: storage });

interface Post {
  id: string;
  type: 'image' | 'video';
  url: string;
  createdAt: number;
  message?: string;
}
const posts: Post[] = [];

// For the Creator / Asset library
interface ARAsset {
  id: string;
  type: '3d' | '2d_filter';
  name: string;
  url: string; // url to the uploaded filter or 3d model
  config?: any; // e.g. transform properties for 3D items, opacity for 2D.
}
const assets: ARAsset[] = [
  { 
    id: '1', 
    type: '3d', 
    name: 'Virtual Glasses (Procedural)', 
    url: '',
    config: { scale: 1, x: 0, y: 0.2, z: 0.5, rotX: 0, rotY: 0, rotZ: 0 }
  },
  {
    id: '2',
    type: '2d_filter',
    name: 'Hope Gala Elegant Border',
    url: 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFD700" />
          <stop offset="50%" stop-color="#D4AF37" />
          <stop offset="100%" stop-color="#AA8822" />
        </linearGradient>
      </defs>
      <rect x="40" y="40" width="1000" height="1840" fill="none" stroke="url(#gold)" stroke-width="20" rx="40" />
      <text x="540" y="1800" font-family="serif" font-size="80" font-weight="bold" fill="url(#gold)" text-anchor="middle" font-style="italic">HOPE GALA 2026</text>
      <path d="M 90 90 L 120 180 L 210 210 L 120 240 L 90 330 L 60 240 L -30 210 L 60 180 Z" fill="white" transform="scale(0.5) translate(100, 100)" opacity="0.8"/>
      <path d="M 90 90 L 120 180 L 210 210 L 120 240 L 90 330 L 60 240 L -30 210 L 60 180 Z" fill="white" transform="scale(0.5) translate(1900, 100)" opacity="0.8"/>
      <path d="M 90 90 L 120 180 L 210 210 L 120 240 L 90 330 L 60 240 L -30 210 L 60 180 Z" fill="white" transform="scale(0.5) translate(100, 3600)" opacity="0.8"/>
      <path d="M 90 90 L 120 180 L 210 210 L 120 240 L 90 330 L 60 240 L -30 210 L 60 180 Z" fill="white" transform="scale(0.5) translate(1900, 3600)" opacity="0.8"/>
    </svg>`),
    config: { scale: 1, x: 0, y: 0 }
  },
  {
    id: '3',
    type: '2d_filter',
    name: 'Neon Sparkles',
    url: 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
      <path d="M 200 200 L 220 300 L 320 320 L 220 340 L 200 440 L 180 340 L 80 320 L 180 300 Z" fill="#F27D26" opacity="0.8"/>
      <path d="M 800 400 L 810 450 L 860 460 L 810 470 L 800 520 L 790 470 L 740 460 L 790 450 Z" fill="#D4AF37" opacity="0.8"/>
      <path d="M 900 1500 L 920 1600 L 1020 1620 L 920 1640 L 900 1740 L 880 1640 L 780 1620 L 880 1600 Z" fill="#F27D26" opacity="0.8"/>
      <path d="M 150 1600 L 160 1650 L 210 1660 L 160 1670 L 150 1720 L 140 1670 L 90 1660 L 140 1650 Z" fill="#D4AF37" opacity="0.8"/>
    </svg>`),
    config: { scale: 1, x: 0, y: 0 }
  }
];

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(express.json());

  // AI Generator API
  app.post('/api/generate-asset', async (req, res) => {
    try {
      const { prompt, type } = req.body;
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY environment variable is missing.');
      const ai = new GoogleGenAI({ apiKey: key });
      
      if (type === '2d_filter') {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `Create a clean, flat 2D SVG vector graphic based on this request: "${prompt}". 
          IMPORTANT REQUIREMENTS:
          - Output ONLY valid SVG code, no markdown fencing, no explanation.
          - It MUST have a perfectly transparent background.
          - Use a viewBox of "0 0 1080 1920" (mobile vertical).
          - Make it visually polished and high quality for a photo booth overlay.`,
        });
        let svg = response.text || '';
        svg = svg.replace(/^\s*\x60\x60\x60(xml|svg)?|\x60\x60\x60\s*$/gi, '').trim();
        res.json({ success: true, dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` });
      } else {
        res.status(400).json({ error: 'AI generation for 3D is not supported yet.' });
      }
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // API Routes
  app.get('/api/posts', (req, res) => {
    res.json(posts.sort((a, b) => b.createdAt - a.createdAt));
  });

  app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const type = req.body.type as 'image' | 'video';
    const message = req.body.message;
    const newPost: Post = {
      id: crypto.randomUUID(),
      type: type || (req.file.mimetype.startsWith('video') ? 'video' : 'image'),
      url: `/uploads/${req.file.filename}`,
      createdAt: Date.now(),
      message,
    };
    
    posts.push(newPost);
    res.json({ success: true, post: newPost });
  });

  // Assets APIs
  app.get('/api/assets', (req, res) => {
    res.json(assets);
  });

  app.post('/api/assets', upload.single('file'), (req, res) => {
    const { name, type, config } = req.body;
    const newAsset: ARAsset = {
      id: crypto.randomUUID(),
      type: type as '3d' | '2d_filter',
      name: name || 'Unnamed Asset',
      url: req.file ? `/assets_storage/${req.file.filename}` : '',
      config: config ? JSON.parse(config) : {},
    };
    assets.push(newAsset);
    res.json({ success: true, asset: newAsset });
  });

  // Serve uploaded files statically
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use('/assets_storage', express.static(ASSETS_DIR));

  // Vite middleware for development or Static serve for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
