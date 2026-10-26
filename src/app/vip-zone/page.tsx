"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

// VIP 多网盘浏览页 (2026-10-16 P12: 升级为 5 行筛选 + SORT 3 按钮 + Per Page)
//   - 路由: /vip-zone
//   - 来源: 首页 "VIP 多网盘" 区块 "查看更多" 入口
//   - 数据: /api/catalog?section=vip (access_level='vip' 的多网盘资源, 36万+ 条)
//   - 2026-10-16 加筛选: 分类(sheet 透传到 api/catalog?category=) / source / region / year / matchStatus
//   - SORT: 上映/上架/最惠 (release_date / added_time / rating)
//   - Per Page: 30 / 90 / 150
//   - 卡片: 简洁文本卡 (无海报), 显示 link + 提取码, basic 显示 VIP 锁

interface VipItem {
  id: number;
  name: string;
  displayCategory?: string;
  category?: string;
  source?: string;
  sourceDisplay?: string;
  size?: string;
  createdAt?: string;
  accessLevel?: string;
  payType?: string;
  unlocked?: boolean;
  links?: Array<{
    source?: string;
    url?: string;
    password?: string;
    sort?: number;
  }>;
}

// 2026-10-16: 5 行筛选 — 跟首页影视专区一致
// vip-zone 数据是 access_level='vip' 的多网盘资源, 没有电影/剧集分类
// category 改成 sheet 显示 (原盘/REMUX/系列电影/合集 等), 否则用全部
const CATEGORIES = ['全部', '原盘', 'REMUX', '系列电影', '连载', '电影', '剧集', '动漫', '纪录片', '综艺'];
const SOURCES = ['全部', '百度网盘', '夸克网盘', '阿里云盘', '115网盘', '磁力链接', 'ed2k链接'];
const REGIONS = ['全部', '大陆', '欧美', '日韩', '港澳台'];
const YEARS = ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020', '2010-2019', '2000-2009'];
const MATCH_STATUSES = ['全部', '已批配', '未匹配'];

export default function VipZonePage() {
  // 5 行筛选状态
  const [category, setCategory] = useState('全部');
  const [source, setSource] = useState('全部');
  const [region, setRegion] = useState('全部');
  const [year, setYear] = useState('全部');
  const [matchStatus, setMatchStatus] = useState('全部');
  const [sort, setSort] = useState<'release_date' | 'added_time' | 'rating'>('added_time');
  const [pageSize, setPageSize] = useState(30);
  const [page, setPage] = useState(1);
  // 数据
  const [items, setItems] = useState<VipItem[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [userGroup, setUserGroup] = useState<string>('user');

  // 鉴权
  useEffect(() => {
    const t = document.cookie.match(/zzmm_token=([^;]+)/)?.[1] ||
              localStorage.getItem('zzmm_token');
    if (!t) return;
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })
      .then(r => r.json())
      .then(d => { if (d?.user_group) setUserGroup(d.user_group); })
      .catch(() => {});
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        section: 'vip',
        page: String(page),
        pageSize: String(pageSize),
        zone: 'library',
        sort,
        region,
        year,
        matchStatus,
      });
      // category → sheet (zezhe 分类字段, vip 资源也有 sheet)
      if (category !== '全部') params.set('sheet', category);
      if (source !== '全部') params.set('source', source);
      if (query.trim()) params.set('q', query.trim());
      params.set('_t', String(Date.now()));
      const r = await fetch(`/api/catalog?${params}`);
      const j = await r.json();
      setItems(j.items || []);
      setTotal(j.total || 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, query, source, category, region, year, matchStatus, sort]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // 任意筛选变化 → 重置 page=1
  const resetPage = () => setPage(1);

  const isVipLocked = (item: VipItem): boolean => {
    if (userGroup === 'admin' || userGroup === 'vip' || userGroup === 'svip') return false;
    return true;
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-gradient-to-b from-[#0a0a0f] to-[#0a0a0f]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-white/60 hover:text-white text-sm">← 返回首页</Link>
              <h1 className="text-lg font-bold flex items-center gap-2">
                <span className="text-base">💎</span>
                VIP 多网盘专区
              </h1>
            </div>
            <div className="text-xs text-white/40">
              共 {total.toLocaleString()} 条 · {userGroup === 'vip' || userGroup === 'admin' || userGroup === 'svip' ? '已解锁可直开' : '需 VIP 会员解锁'}
            </div>
          </div>

          {/* 搜索框 */}
          <div className="mb-3 flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
            <Search size={16} className="text-white/40" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); resetPage(); }}
              placeholder="搜索片名 / 分类..."
              className="flex-1 bg-transparent outline-none text-sm placeholder-white/30"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-white/40 hover:text-white text-xs">
                清空
              </button>
            )}
          </div>

          {/* 5 行筛选 — 跟首页影视专区一致 */}
          <div className="flex flex-col gap-1.5 mb-3 p-2 rounded-2xl bg-white/[0.02] border border-white/[0.04] backdrop-blur-sm">
            {/* 分类 */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              {CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => { setCategory(cat); resetPage(); }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition shrink-0 ${category === cat
                    ? 'bg-gradient-to-r from-violet-500/25 to-fuchsia-500/25 text-white border border-violet-400/40 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                    : 'bg-white/[0.03] text-white/55 hover:text-white/85 hover:bg-white/[0.06] border border-transparent'}`}>{cat}</button>
              ))}
            </div>
            {/* 来源 */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              {SOURCES.map((src) => (
                <button key={src} onClick={() => { setSource(src); resetPage(); }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${source === src
                    ? 'bg-gradient-to-r from-pink-500/25 to-rose-500/25 text-white border border-pink-400/40'
                    : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{src}</button>
              ))}
            </div>
            {/* 地区 */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              <span className="text-[10px] text-white/30 self-center mr-0.5 shrink-0 tracking-wider">地区</span>
              {REGIONS.map((r) => (
                <button key={r} onClick={() => { setRegion(r); resetPage(); }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${region === r
                    ? 'bg-gradient-to-r from-orange-500/25 to-amber-500/25 text-white border border-orange-400/40'
                    : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{r}</button>
              ))}
            </div>
            {/* 年份 */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              <span className="text-[10px] text-white/30 self-center mr-0.5 shrink-0 tracking-wider">年份</span>
              {YEARS.map((y) => (
                <button key={y} onClick={() => { setYear(y); resetPage(); }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${year === y
                    ? 'bg-gradient-to-r from-cyan-500/25 to-teal-500/25 text-white border border-cyan-400/40'
                    : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{y}</button>
              ))}
            </div>
            {/* 批配状态 */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              <span className="text-[10px] text-white/30 self-center mr-0.5 shrink-0 tracking-wider">批配</span>
              {MATCH_STATUSES.map((ms) => (
                <button key={ms} onClick={() => { setMatchStatus(ms); resetPage(); }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${matchStatus === ms
                    ? 'bg-gradient-to-r from-emerald-500/25 to-teal-500/25 text-white border border-emerald-400/40'
                    : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{ms}</button>
              ))}
            </div>
          </div>

          {/* Sort + Per Page */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/40 tracking-wider uppercase">Sort</span>
              <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                <button onClick={() => { setSort('release_date'); resetPage(); }}
                  className={`px-3 py-1 rounded-lg text-xs transition ${sort === 'release_date'
                    ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white shadow-[0_0_8px_rgba(168,85,247,0.2)]'
                    : 'text-white/50 hover:text-white/85'}`}>🎬 上映</button>
                <button onClick={() => { setSort('added_time'); resetPage(); }}
                  className={`px-3 py-1 rounded-lg text-xs transition ${sort === 'added_time'
                    ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white shadow-[0_0_8px_rgba(168,85,247,0.2)]'
                    : 'text-white/50 hover:text-white/85'}`}>📅 上架</button>
                <button onClick={() => { setSort('rating'); resetPage(); }}
                  className={`px-3 py-1 rounded-lg text-xs transition ${sort === 'rating'
                    ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white shadow-[0_0_8px_rgba(168,85,247,0.2)]'
                    : 'text-white/50 hover:text-white/85'}`}>⭐ 最惠</button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/40 hidden sm:inline tracking-wider uppercase">Per Page</span>
              <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                {[30, 90, 150].map((s) => (
                  <button key={s} onClick={() => { setPageSize(s); resetPage(); }}
                    className={`px-3 py-1 rounded-lg text-xs transition ${pageSize === s
                      ? 'bg-gradient-to-r from-pink-500/30 to-rose-500/30 text-white shadow-[0_0_8px_rgba(236,72,153,0.2)]'
                      : 'text-white/50 hover:text-white/85'}`}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        {loading ? (
          <div className="text-center text-white/40 py-12">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center text-white/40 py-12">暂无数据 · 当前筛选下没有结果</div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const locked = isVipLocked(item);
              const link = item.links?.[0];
              return (
                <div
                  key={item.id}
                  className={`bg-white/5 border border-white/10 rounded-lg p-3 flex items-center gap-3 ${
                    locked ? 'opacity-70' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {item.sourceDisplay && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                          {item.sourceDisplay}
                        </span>
                      )}
                      {item.category && item.category !== '其他' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                          {item.category}
                        </span>
                      )}
                      <span className="font-medium text-sm truncate">{item.name}</span>
                      {locked && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          🔒 VIP 锁
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/40 mt-1 flex items-center gap-3 flex-wrap">
                      {item.size && <span>大小: {item.size}</span>}
                      {item.createdAt && (
                        <span>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {locked ? (
                      <Link
                        href="/upgrade"
                        className="px-3 py-1.5 rounded text-xs bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium hover:opacity-90"
                      >
                        开通 VIP
                      </Link>
                    ) : link?.url ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded text-xs bg-amber-500 text-black font-medium hover:bg-amber-400"
                      >
                        打开 ↗
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-white/5 rounded text-sm disabled:opacity-30 hover:bg-white/10 transition"
            >上一页</button>
            <span className="px-4 py-2 text-sm text-white/60">
              第 {page} 页 · 共 {totalPages} 页
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-4 py-2 bg-white/5 rounded text-sm disabled:opacity-30 hover:bg-white/10 transition"
            >下一页</button>
          </div>
        )}
      </div>
    </div>
  );
}