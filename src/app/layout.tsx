import type { Metadata } from 'next';
import './globals.css';
import AuthGuard from './AuthGuard';

export const metadata: Metadata = {
  title: '泽泽妈妈资源库',
  description: '海量影视资源一站式搜索',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <AuthGuard />
        {children}
      </body>
    </html>
  );
}
