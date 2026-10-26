/** @type {import('next').NextConfig} */
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  output: 'standalone',
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
      },
    ],
  },
  cacheMaxMemorySize: 0,
  experimental: {
  },
  // 2026-10-15: 用 webpack alias 把 @neondatabase/serverless 替换为 raw fetch shim
  // 因为 Neon HTTP client 在 Next.js 14 standalone + undici fetch 环境 hang
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@neondatabase/serverless': path.resolve(__dirname, 'src/lib/neon-shim.mjs'),
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default config;