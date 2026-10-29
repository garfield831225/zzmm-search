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
//
// 2026-10-30 霓虹改版:
// - 输入框用 .neon-input (紫→青描边 + 焦点辉光)
// - 搜索按钮用 .neon-btn (紫青渐变 + 发光)
// - 图标聚焦时变青, 加发光
export default function SearchBox({ initial = '', placeholder = '输入片名、类型、分类搜索...', onSearch, size = 'lg' }: SearchBoxProps) {
  const [q, setQ] = useState(initial);
  const [focused, setFocused] = useState(false);

  const sizeCls = size === 'lg'
    ? 'px-6 py-4 pl-14 text-base rounded-2xl'
    : 'px-4 py-2 pl-10 text-sm rounded-xl';

  return (
    <div className="relative w-full max-w-3xl mx-auto">
      {/* 外层霓虹辉光 (聚焦时亮起) */}
      <div
        className={`absolute inset-0 rounded-2xl pointer-events-none transition-all duration-300 ${
          focused ? 'shadow-[0_0_28px_rgba(34,211,238,0.35)]' : 'shadow-[0_0_0px_rgba(34,211,238,0)]'
        }`}
      />
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSearch(q); }}
        placeholder={placeholder}
        className={`neon-input relative w-full ${sizeCls} text-white focus:outline-none transition-all duration-300 backdrop-blur-sm`}
      />
      <Search
        size={size === 'lg' ? 20 : 16}
        className={`absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-300 ${
          focused ? 'text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]' : 'text-white/35'
        }`}
      />
      <button
        onClick={() => onSearch(q)}
        className={`neon-btn absolute right-2 top-1/2 -translate-y-1/2 ${
          size === 'lg' ? 'px-5 py-2.5 text-sm' : 'px-3 py-1 text-xs'
        }`}
      >
        搜索
      </button>
    </div>
  );
}
