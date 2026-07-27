import type { Metadata, Viewport } from 'next';
import './globals.css';
import AuthGuard from './AuthGuard';

export const metadata: Metadata = {
  title: '泽泽妈妈资源库',
  description: '海量影视资源一站式搜索',
};

// 2026-07-27: 加 viewport meta (mobile 适配基础)
// 不加 user-scalable=no (iOS 辅助功能需要缩放, Apple HIG 反对禁缩放)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0a0a0f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* PWA 基础 (2026-07-27) - 不做 service worker, 仅 manifest */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="泽泽妈资源库" />
      </head>
      <body className="antialiased">
        <AuthGuard />
        {children}
      </body>
    </html>
  );
}
