'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';

interface SearchBoxProps {
  initial?: string;
  placeholder?: string;
  onSearch: (q: string) => void;
  size?: 'sm' | 'md' | 'lg';
}

// 2026-08-14: 搜索框从 nav 顶部挪到 hero 区域上方
// - 大尺寸 (lg): hero 上方, 玻璃态输入框 (跟原 nav 搜索框体验一致)
// - 圆角放大, padding 加宽, 焦点状态更明显
export default function SearchBox({ initial = '', placeholder = '输入片名、类型、分类搜索...', onSearch, size = 'lg' }: SearchBoxProps) {
  const [q, setQ] = useState(initial);

  const sizeCls = size === 'lg'
    ? 'px-6 py-4 pl-14 text-base rounded-2xl'
    : 'px-4 py-2 pl-10 text-sm rounded-xl';

  return (
    <div className="relative w-full max-w-3xl mx-auto">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSearch(q); }}
        placeholder={placeholder}
        className={`w-full bg-white/[0.04] border border-white/[0.08] ${sizeCls} text-white placeholder-white/30 focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20 focus:bg-white/[0.06] transition backdrop-blur-sm`}
      />
      <Search size={size === 'lg' ? 20 : 16} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
      <button
        onClick={() => onSearch(q)}
        className={`absolute right-2 top-1/2 -translate-y-1/2 ${size === 'lg' ? 'px-5 py-2.5 text-sm' : 'px-3 py-1 text-xs'} bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-90 rounded-xl text-white font-medium transition shadow-[0_0_12px_rgba(168,85,247,0.2)]`}
      >
        搜索
      </button>
    </div>
  );
}
