'use client';

import { useState, useEffect, useCallback } from 'react';

interface CatalogItem {
  id: number;
  name: string;
  displayCategory: string;
  category: string;
  docSheet: string;
  size?: string;
  type?: string;
  tags?: string[];
  tmdbIdRaw?: string;
  source: string;
  sourceDisplay: string;
  createdAt: string;
  importChannel?: string;
  accessLevel?: string;
  poster: string | null;
  voteAverage: number | null;
  releaseDate: string | null;
  tmdbStatus: string | null;
}

const SECTIONS = [
  { key: '', label: '全部', icon: '📂', desc: '所有资源' },
  { key: 'zezhe', label: '泽泽妈妈115文档', icon: '👑', desc: 'basic 也可以直接打开' },
  { key: 'vip', label: 'VIP 区', icon: '🔒', desc: 'VIP 可直接打开，basic 看到 VIP 锁' },
  { key: 'code', label: '单独付费区', icon: '💎', desc: '需消耗流明解锁' },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];

const SECTION_BADGE: Record<string, string> = {
  zezhe: 'bg-gradient-to-r from-pink-500 to-purple-500 text-white',
  vip: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white',
  code: 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white',
};

const CATEGORY_ICONS: Record<string, string> = {
  '电影': '🎬', '剧集': '📺', '动漫': '🗾', '纪录片': '🎥', '综艺': '🎤',
  '演唱会': '🎵', '音乐': '🎶', '体育': '⚽', '少儿频道': '🧒', '连载': '📡',
  '原盘': '💿', 'REMUX': '📀', '系列电影': '🎞️', '合集': '📚',
  '电子书': '📖', '精品课': '🎓', '文档': '📄',
};

// 把 ISO 时间格式化成 "2026-01-15 12:34"
function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 10);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return iso.slice(0, 10);
  }
}

export default function TitlesPage() {
  const [section, setSection] = useState<SectionKey>('');
  const [category, setCategory] = useState<string>('全部');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'asc' | 'desc'>('asc');  // 2026-07-20: 默认按添加时间正序
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const fetchItems = useCallback(async (p = 1, reset = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: p.toString(),
        pageSize: pageSize.toString(),
        sort,
      });
      if (query) params.set('q', query);
      if (section) params.set('section', section);
      if (category !== '全部') params.set('category', category);
      const res = await fetch(`/api/catalog?${params}`);
      const data = await res.json();
      const newItems = data.items || [];
      if (reset) setItems(newItems);
      else setItems(prev => [...prev, ...newItems]);
      setTotal(data.total || 0);
      setPage(p);
      setHasMore((p * pageSize) < (data.total || 0));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [query, section, category, pageSize, sort]);

  useEffect(() => { fetchItems(1, true); }, [query, section, category, sort]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchItems(1, true);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* 顶部 — 极简, 不含任何跳转主页的链接 */}
      <header className="border-b border-white/5 bg-[#12121a]/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-2xl">
              📑
            </div>
            <div>
              <h1 className="text-2xl font-bold">资源目录</h1>
              <p className="text-sm text-white/50 mt-0.5">共 {total.toLocaleString()} 个资源 · 实时同步 xx_resources</p>
            </div>
          </div>
          {/* 排序切换 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/50">排序:</span>
            <button
              onClick={() => setSort('asc')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                sort === 'asc'
                  ? 'bg-gradient-to-r from-violet-600 to-pink-600 text-white'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              ↑ 添加时间正序
            </button>
            <button
              onClick={() => setSort('desc')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                sort === 'desc'
                  ? 'bg-gradient-to-r from-violet-600 to-pink-600 text-white'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              ↓ 添加时间倒序
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6">
        {/* 4 个区切换 (跟 /library 一样) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          {SECTIONS.map(s => (
            <button
              key={s.key}
              onClick={() => { setSection(s.key); setCategory('全部'); }}
              className={`p-5 rounded-xl border text-left transition ${
                section === s.key
                  ? 'border-violet-500/50 bg-gradient-to-br from-violet-500/10 to-pink-500/10'
                  : 'border-white/5 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="flex items-center gap-3 mb-1.5">
                <span className="text-3xl">{s.icon}</span>
                <span className="text-base font-semibold">{s.label}</span>
              </div>
              <p className="text-sm text-white/50">{s.desc}</p>
            </button>
          ))}
        </div>

        {/* 搜索 */}
        <form onSubmit={handleSearch} className="mb-4 flex gap-3">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`搜索 ${section === 'zezhe' ? '泽泽妈妈115文档' : section === 'vip' ? 'VIP区' : section === 'code' ? '单独付费区' : '全部'}...`}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-5 py-3 text-base text-white placeholder-white/40 focus:outline-none focus:border-violet-500/50"
          />
          <button
            type="submit"
            className="px-8 py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl text-base font-semibold hover:opacity-90"
          >
            搜索
          </button>
        </form>

        {/* 分类按钮 */}
        <div className="flex flex-wrap gap-2 mb-4">
          {['全部', '电影', '剧集', '动漫', '纪录片', '综艺', '演唱会', '音乐', '体育',
            '少儿频道', '连载', '原盘', 'REMUX', '系列电影', '合集', '电子书', '精品课', '文档'].map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                category === c
                  ? 'bg-gradient-to-r from-violet-600 to-pink-600 text-white'
                  : 'bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* 表格 — 字体加大, 间距加宽, 显示真实日期 */}
        <div className="bg-white/5 border border-white/5 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[80px_90px_1fr_110px_90px_160px_70px] gap-3 px-5 py-3 bg-white/5 border-b border-white/10 text-sm font-semibold text-white/60">
            <div>分类</div>
            <div>标签</div>
            <div>名称</div>
            <div>来源</div>
            <div>大小</div>
            <div>添加时间</div>
            <div>状态</div>
          </div>

          {items.length === 0 && !loading ? (
            <div className="text-center py-16 text-white/40 text-base">暂无数据</div>
          ) : (
            items.map(item => {
              // 泽泽妈妈115文档: 分类列用 doc_sheet (21-sheet 库的 sheet 名)
              // 其他: 用 category 字段
              const showCategory = section === 'zezhe'
                ? (item.docSheet || item.category)
                : item.category;
              const showIcon = CATEGORY_ICONS[showCategory] || '📁';
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[80px_90px_1fr_110px_90px_160px_70px] gap-3 px-5 py-3.5 border-b border-white/5 hover:bg-white/5 transition text-base items-center"
                >
                  {/* 分类 */}
                  <div>
                    <div className="text-2xl leading-none">{showIcon}</div>
                    <div className="text-xs text-white/50 truncate mt-1" title={showCategory}>{showCategory}</div>
                  </div>
                  {/* 标签 (大区角标) */}
                  <div>
                    {section === 'zezhe' ? (
                      <div className={`px-2 py-1 rounded text-xs font-semibold text-center ${SECTION_BADGE.zezhe}`}>👑 ZEZHE</div>
                    ) : section === 'vip' ? (
                      <div className={`px-2 py-1 rounded text-xs font-semibold text-center ${SECTION_BADGE.vip}`}>🔒 VIP</div>
                    ) : section === 'code' ? (
                      <div className={`px-2 py-1 rounded text-xs font-semibold text-center ${SECTION_BADGE.code}`}>💎 CODE</div>
                    ) : (
                      <div className="text-xs text-white/30 text-center">—</div>
                    )}
                  </div>
                  {/* 名称 */}
                  <div className="min-w-0">
                    <div className="text-white font-medium text-base leading-snug line-clamp-2" title={item.name}>{item.name}</div>
                    {item.tmdbIdRaw && item.tmdbIdRaw !== 'NOMATCH' && item.tmdbIdRaw !== 'GARBLED' && item.tmdbIdRaw.length >= 4 && (
                      <div className="text-xs text-green-400 font-mono mt-1">🎬 TMDB: {item.tmdbIdRaw}</div>
                    )}
                  </div>
                  {/* 来源 */}
                  <div className="text-sm text-white/70 truncate">{item.sourceDisplay}</div>
                  {/* 大小 */}
                  <div className="text-sm text-white/50 truncate">{item.size || '—'}</div>
                  {/* 添加时间 (真实日期) */}
                  <div className="text-sm text-white/70 font-mono">{fmtDate(item.createdAt)}</div>
                  {/* 状态 */}
                  <div className="text-sm text-white/70 truncate">
                    {item.accessLevel === 'code' ? '💎 付费' : item.accessLevel === 'vip' ? '🔒 VIP' : '✅ 直开'}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 加载更多 */}
        {hasMore && (
          <div className="text-center mt-5">
            <button
              onClick={() => fetchItems(page + 1, false)}
              disabled={loading}
              className="px-8 py-3 bg-white/5 border border-white/10 rounded-xl text-white/60 hover:bg-white/10 disabled:opacity-50"
            >
              {loading ? '加载中...' : `加载更多 (${items.length}/${total})`}
            </button>
          </div>
        )}

        <footer className="mt-10 text-center text-sm text-white/40">
          <p>共 {total.toLocaleString()} 条 · 第 {page} 页 · 实时同步 xx_resources (无登录无链接)</p>
        </footer>
      </main>
    </div>
  );
}
