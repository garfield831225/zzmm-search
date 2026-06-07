'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Filter, Star, Calendar, Flame, ChevronDown, X, Library } from 'lucide-react';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMG_LARGE = 'https://image.tmdb.org/t/p/original';

const CATS = [
  { key: 'all',     label: '全部' },
  { key: 'movie',   label: '电影' },
  { key: 'tv',      label: '剧集' },
  { key: 'anime',   label: '动漫' },
  { key: 'doc',     label: '纪录片' },
  { key: 'variety', label: '综艺' },
];

const SORTS = [
  { key: 'smart',        label: '智能',   icon: Sparkles },
  { key: 'release_date', label: '上映时间', icon: Calendar },
  { key: 'popularity',   label: '热度',   icon: Flame },
  { key: 'rating',       label: '评分',   icon: Star },
];

const YEARS = ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020', '2010-2019', '2000-2009'];

const LINK_TYPES = [
  { key: 'all',   label: '全部网盘' },
  { key: '115',   label: '💜 115' },
  { key: 'baidu', label: '💙 百度' },
  { key: 'aliyun',label: '💚 阿里' },
  { key: 'quark', label: '🩷 夸克' },
];

const MOVIE_GENRES = ['动作','冒险','动画','喜剧','犯罪','纪录片','剧情','家庭','奇幻','历史','恐怖','音乐','悬疑','爱情','科幻','惊悚','战争','西部'];
const TV_GENRES = ['动作冒险','动画','喜剧','犯罪','纪录片','剧情','家庭','悬疑','儿童','新闻','真人秀','科幻奇幻','肥皂剧','脱口秀','战争政治'];

// 简化的 lucide 图标（用 emoji 替代避免再装包）
function Sparkles(props: any) { return <span {...props}>✨</span>; }

interface Block1Item {
  block: 1;
  sub_types?: string[];
  tmdb_id: number;
  tmdb_type: string;
  title: string;
  original_title?: string;
  poster_path?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  popularity: number;
  genres: string[];
  origin_country: string[];
  has_resource: true;
  link_count: number;
}
interface Block2Item {
  block: 2;
  id: number;
  name: string;
  link: string;
  link_code: string;
  source: string;
  category: string;
  size: string;
  has_resource: true;
  has_tmdb: false;
}
interface Block3Item {
  block: 3;
  tmdb_id: number;
  tmdb_type: string;
  title: string;
  original_title?: string;
  poster_path?: string;
  release_date?: string;
  vote_average: number;
  popularity: number;
  genres: string[];
  has_resource: false;
}
type Item = Block1Item | Block2Item | Block3Item;

export default function TmdbFilmsPage() {
  const router = useRouter();
  const [type, setType] = useState('movie');  // movie | tv
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('smart');
  const [year, setYear] = useState('全部');
  const [genre, setGenre] = useState('');
  const [linkType, setLinkType] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState({ block1: 0, block2: 0, block3: 0 });
  const [loading, setLoading] = useState(false);
  const [showFilter, setShowFilter] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type, category, sort, linkType, q: keyword, page: String(page), pageSize: '200',
      });
      if (year !== '全部') params.set('year', year);
      if (genre) params.set('genre', genre);
      const r = await fetch(`/api/tmdb-films?${params}`);
      const d = await r.json();
      setItems(d.items || []);
      setCounts(d.counts || { block1: 0, block2: 0, block3: 0 });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [type, category, sort, year, genre, linkType, keyword, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const resetPage = (fn: () => void) => { setPage(1); fn(); };

  const currentGenres = type === 'tv' ? TV_GENRES : MOVIE_GENRES;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0a0f] via-[#0d0d18] to-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0a0a0f]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href="/" className="p-2 hover:bg-white/10 rounded-lg transition">
                <Library className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">
                  🎬 TMDB 影视
                </h1>
                <p className="text-xs text-white/40">全量电影 + 您的导入 + 实时更新</p>
              </div>
            </div>
            {/* 搜索框 */}
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  value={keyword}
                  onChange={e => { setKeyword(e.target.value); setPage(1); }}
                  placeholder="搜索电影 / 剧集..."
                  className="w-full bg-white/5 border border-white/10 rounded-full pl-9 pr-4 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-violet-500"
                />
                {keyword && (
                  <button onClick={() => setKeyword('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowFilter(!showFilter)}
              className="md:hidden p-2 hover:bg-white/10 rounded-lg"
            >
              <Filter className="w-5 h-5" />
            </button>
          </div>

          {/* 分类 tabs */}
          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
            {CATS.map(c => (
              <button
                key={c.key}
                onClick={() => { resetPage(() => setCategory(c.key)); setType(c.key === 'tv' || c.key === 'anime' || c.key === 'doc' || c.key === 'variety' ? 'tv' : 'movie'); setGenre(''); }}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition ${
                  category === c.key
                    ? 'bg-gradient-to-r from-violet-600 to-pink-600 text-white shadow-lg shadow-violet-500/30'
                    : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* 筛选条（桌面端始终显示，移动端可折叠） */}
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3 ${showFilter ? 'block' : 'hidden md:block'}`}>
          <div className="flex flex-wrap items-center gap-2">
            {/* 排序 */}
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              {SORTS.map(s => (
                <button
                  key={s.key}
                  onClick={() => { resetPage(() => setSort(s.key)); }}
                  className={`px-3 py-1 rounded text-xs transition ${
                    sort === s.key ? 'bg-violet-500/30 text-violet-300' : 'text-white/50 hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {/* 年份 */}
            <select
              value={year}
              onChange={e => { resetPage(() => setYear(e.target.value)); }}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
            >
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {/* 类型 */}
            <select
              value={genre}
              onChange={e => { resetPage(() => setGenre(e.target.value)); }}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
            >
              <option value="">全部类型</option>
              {currentGenres.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            {/* 网盘类型 */}
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              {LINK_TYPES.map(l => (
                <button
                  key={l.key}
                  onClick={() => { resetPage(() => setLinkType(l.key)); }}
                  className={`px-3 py-1 rounded text-xs transition ${
                    linkType === l.key ? 'bg-violet-500/30 text-violet-300' : 'text-white/50 hover:text-white'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 块标签 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        <div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
          <span className="px-2 py-1 bg-green-500/10 text-green-400 rounded">
            ⭐ 您的导入·已匹配 <span className="ml-1 text-green-300 font-bold">{counts.block1}</span>
          </span>
          <span className="px-2 py-1 bg-amber-500/10 text-amber-400 rounded">
            📝 您的导入·未匹配 <span className="ml-1 text-amber-300 font-bold">{counts.block2}</span>
          </span>
          <span className="px-2 py-1 bg-white/5 text-white/50 rounded">
            🎬 TMDB 推荐 <span className="ml-1 text-white/70 font-bold">{counts.block3}</span>
          </span>
        </div>
      </div>

      {/* 主区 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <div className="text-center py-20 text-white/40">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-white/40">无结果</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {items.map((it, idx) => {
              let key: string;
              if (it.block === 2) key = `b2-${(it as Block2Item).id}`;
              else if (it.block === 1) key = `b1-${(it as Block1Item).tmdb_id}-${(it as Block1Item).tmdb_type}`;
              else key = `b3-${(it as Block3Item).tmdb_id}-${(it as Block3Item).tmdb_type}`;
              return <Card key={key} item={it} idx={idx} router={router} />;
            })}
          </div>
        )}

        {/* 总数提示（一次拉完所有） */}
        {items.length > 0 && (
          <div className="mt-8 text-center text-sm text-white/40">
            共 {items.length} 条 · 滚动浏览全部
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 卡片组件 ──────────────────────────────────────────────────────────
function Card({ item, idx, router }: { item: Item; idx: number; router: any }) {
  if (item.block === 1) {
    const r = item;
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.02 }}
        onClick={() => router.push(`/tmdb-films/${r.tmdb_id}?type=${r.tmdb_type}`)}
        className="group cursor-pointer"
      >
        <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-gray-800 transition-all duration-300 group-hover:scale-105 group-hover:shadow-2xl group-hover:shadow-violet-500/30 group-hover:ring-2 group-hover:ring-violet-500/50">
          {r.poster_path ? (
            <img src={`${TMDB_IMG}${r.poster_path}`} alt={r.title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-4xl text-gray-500">🎬</div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
          {/* 评分徽章 */}
          {r.vote_average > 0 && (
            <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full">
              <Star className="w-3 h-3 text-black fill-black" />
              <span className="text-black font-bold text-xs">{r.vote_average.toFixed(1)}</span>
            </div>
          )}
          {/* 链接数角标（绿色脉冲） */}
          <div className="absolute top-2 right-2 px-2 py-1 bg-green-500/90 rounded-full text-xs font-bold text-black shadow-lg shadow-green-500/30">
            📦 {r.link_count}
          </div>
          {/* 块标签 */}
          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-green-500/30 text-green-300 rounded text-[10px] font-medium">
            ⭐ 您的导入
          </div>
          {/* sub_types 标签（如 连载/剧集） */}
          {r.sub_types && r.sub_types.length > 0 && (
            <div className="absolute bottom-2 right-2 flex flex-wrap gap-1 max-w-[60%] justify-end">
              {r.sub_types.filter((s: string) => s !== '剧集' && s !== '电影').map((s: string) => (
                <span key={s} className="px-1.5 py-0.5 bg-cyan-500/40 text-cyan-200 rounded text-[10px] font-medium">{s}</span>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2">
          <h3 className="text-white text-sm font-medium line-clamp-2 group-hover:text-violet-300 transition">{r.title}</h3>
          <p className="text-white/40 text-xs mt-0.5">{(r.release_date || r.first_air_date || '').slice(0, 4)}</p>
        </div>
      </motion.div>
    );
  }

  if (item.block === 2) {
    const r = item;
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.02 }}
        onClick={() => router.push(`/tmdb-films/b2/${r.id}`)}
        className="group cursor-pointer"
      >
        <div className="aspect-[2/3] rounded-xl overflow-hidden bg-gradient-to-br from-amber-900/30 to-amber-700/10 border border-amber-500/20 transition-all duration-300 group-hover:scale-105 group-hover:border-amber-500/50 p-3 flex flex-col">
          <div className="flex-1 flex flex-col justify-between min-h-0">
            <div className="text-xs text-amber-300/80 font-mono break-all line-clamp-4 overflow-hidden">
              {r.name}
            </div>
            <div className="space-y-1 mt-2">
              {r.size && <div className="text-[10px] text-amber-200/70">📦 {r.size}</div>}
              {r.source && <div className="text-[10px] text-amber-200/70">🌐 {r.source}</div>}
              {r.category && <div className="text-[10px] text-amber-200/70">🏷️ {r.category}</div>}
              {r.link_code && <div className="text-[10px] text-amber-300 font-mono">🔑 {r.link_code}</div>}
            </div>
          </div>
          <div className="mt-2 px-2 py-0.5 bg-amber-500/30 text-amber-300 rounded text-[10px] font-medium text-center">
            📝 未匹配
          </div>
        </div>
        <div className="mt-2">
          <h3 className="text-white/80 text-xs line-clamp-2 group-hover:text-amber-300 transition">{r.name}</h3>
        </div>
      </motion.div>
    );
  }

  // block === 3
  const r = item;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.02 }}
      onClick={() => router.push(`/tmdb-films/${r.tmdb_id}?type=${r.tmdb_type}`)}
      className="group cursor-pointer"
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-gray-800 transition-all duration-300 group-hover:scale-105 group-hover:shadow-2xl group-hover:shadow-pink-500/30 group-hover:ring-2 group-hover:ring-pink-500/50">
        {r.poster_path ? (
          <img src={`${TMDB_IMG}${r.poster_path}`} alt={r.title} className="w-full h-full object-cover opacity-80" loading="lazy" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-4xl text-gray-500">🎬</div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
        {r.vote_average > 0 && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full">
            <Star className="w-3 h-3 text-black fill-black" />
            <span className="text-black font-bold text-xs">{r.vote_average.toFixed(1)}</span>
          </div>
        )}
        <div className="absolute top-2 right-2 px-2 py-1 bg-white/20 backdrop-blur rounded-full text-xs font-medium text-white">
          暂无链接
        </div>
        <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-white/10 text-white/60 rounded text-[10px] font-medium">
          🎬 TMDB 推荐
        </div>
      </div>
      <div className="mt-2">
        <h3 className="text-white text-sm font-medium line-clamp-2 group-hover:text-pink-300 transition">{r.title}</h3>
        <p className="text-white/40 text-xs mt-0.5">{(r.release_date || '').slice(0, 4)}</p>
      </div>
    </motion.div>
  );
}
