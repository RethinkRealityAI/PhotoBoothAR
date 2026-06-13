export interface Post {
  id: string;
  type: 'image' | 'video';
  url: string;
  createdAt: number;
  message?: string;
}

export interface ARAsset {
  id: string;
  type: '3d' | '2d_filter';
  name: string;
  url: string;
  config?: any;
}
