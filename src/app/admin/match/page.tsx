'use client'

import { useState, useEffect, useCallback } from 'react';

const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w200';

const CATEGORIES = ['全部', '电影', '剧集', '动漫', '少儿频道', '综艺', '纪录片', '演唱会', '原盘', 'REMUX', '系列电影', '连载', '音乐', '体育', '合集'];
const TMDB_TYPES = ['movie', 'tv'];

export default function MatchManagePage() {
  const [tab, setTab] = useState<'matched' | 'unmatched'>('matched');
  const [category, setCategory] = useState('全部');
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // 搜索状态
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [tmdbType, setTmdbType] = useState('movie');
  const [searchSource, setSearchSource] = useState('');

  // 详情弹窗
  const [detailItem, setDetailItem] = useState<any>(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const cat = category === '全部' ? '' : category;
      const res = await fetch(`/api/admin/match-manage?tab=${tab}&category=${cat}&page=${p}`);
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(p);
    } catch {}
    setLoading(false);
  }, [tab, category]);

  useEffect(() => { load(1); }, [tab, category]);

  const handleSearch = async () => {
    if (!searchQ.trim()) return;
    const cat = category === '全部' ? '' : category;
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/admin/match-search?q=${encodeURIComponent(searchQ)}&category=${cat}&type=${tmdbType}`);
      const data = await res.json();
      setSearchResults(data.results || []);
      setSearchSource(data.source || '');
    } catch {}
    setSearchLoading(false);
  };

  const handleBind = async (itemId: number, result: any) => {
    try {
      await fetch('/api/admin/match-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: itemId,
          tmdb_id: result.id,
          tmdb_type: result.type,
          title: result.title,
          poster_path: result.poster,
          vote_average: result.vote,
          release_date: result.year,
        }),
      });
      load(page);
      setSearchResults([]);
      setSearchQ('');
    } catch {}
  };

  const handleUnbind = async (id: number) => {
    try {
      await fetch('/api/admin/match-manage', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      load(page);
    } catch {}
  };

  const getSourceLabel = (src: string) => {
    if (src === 'tmdb') return 'TMDB';
    if (src === 'musicbrainz') return 'MusicBrainz';
    return src;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => window.location.href = '/admin'} className="p-2 hover:bg-white/10 rounded-lg">←</button>
          <h1 className="text-2xl font-bold">🎬 TMDB 匹配管理</h1>
        </div>

        {/* 分类筛选 */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => { setCategory(c); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${category === c ? 'bg-violet-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white/60'}`}>
              {c}
            </button>
          ))}
        </div>

        {/* Tab切换 */}
        <div className="flex gap-4 mb-4 border-b border-white/10">
          <button onClick={() => setTab('unmatched')} className={`pb-3 px-2 text-sm font-medium ${tab === 'unmatched' ? 'text-violet-400 border-b-2 border-violet-400' : 'text-white/40'}`}>
            未匹配 ({tab === 'unmatched' ? total : '...'})
          </button>
          <button onClick={() => setTab('matched')} className={`pb-3 px-2 text-sm font-medium ${tab === 'matched' ? 'text-violet-400 border-b-2 border-violet-400' : 'text-white/40'}`}>
            已匹配 ({tab === 'matched' ? total : '...'})
          </button>
        </div>

        {/* 搜索区（仅未匹配tab） */}
        {tab === 'unmatched' && (
          <div className="bg-white/5 rounded-xl p-4 mb-4 space-y-3">
            <div className="flex gap-2 items-center">
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="输入名称搜索..." className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/40" />
              <select value={tmdbType} onChange={e => setTmdbType(e.target.value)}
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white">
                {TMDB_TYPES.map(t => <option key={t} value={t} style={{color:'#fff',background:'#1a1a2e'}}>{t}</option>)}
              </select>
              <button onClick={handleSearch} disabled={searchLoading}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm disabled:opacity-50">
                {searchLoading ? '搜索中...' : '搜索'}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                <div className="text-xs text-white/40">{searchResults.length} 个结果（{searchSource}）</div>
                {searchResults.map(r => (
                  <div key={r.id} className="flex items-center gap-3 p-2 bg-white/5 rounded-lg hover:bg-white/10">
                    {r.poster && <img src={r.poster.startsWith('http') ? r.poster : TMDB_IMAGE + r.poster} alt="" className="w-10 h-14 object-cover rounded" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.title}</div>
                      <div className="text-xs text-white/40">{r.year} ★{r.vote?.toFixed(1)} · {getSourceLabel(r.source)}</div>
                    </div>
                    <button onClick={() => detailItem && handleBind(detailItem.id, r)}
                      className="px-3 py-1 bg-violet-600 hover:bg-violet-500 rounded text-xs shrink-0">
                      绑定
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 列表 */}
        {loading ? (
          <div className="text-center py-12 text-white/40">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-white/40">暂无数据</div>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <div key={item.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl hover:bg-white/10">
                {(item.poster_path || item.poster) && (
                  <img src={item.poster_path?.startsWith('http') ? item.poster_path : TMDB_IMAGE + item.poster_path} alt="" className="w-10 h-14 object-cover rounded shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{item.name}</div>
                  <div className="flex gap-2 text-xs text-white/40 mt-1">
                    <span>{item.category}</span>
                    {item.title && <span>★ {item.vote_average?.toFixed(1)} · {item.title}</span>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {tab === 'matched' && item.tmdb_id && (
                    <>
                      <button onClick={() => { setDetailItem(item); setSearchResults([]); setSearchQ(item.name); }}
                        className="px-3 py-1 bg-cyan-600/30 hover:bg-cyan-600/50 rounded text-xs">换源</button>
                      <button onClick={() => handleUnbind(item.id)}
                        className="px-3 py-1 bg-red-600/30 hover:bg-red-600/50 rounded text-xs">取消</button>
                    </>
                  )}
                  {tab === 'unmatched' && (
                    <button onClick={() => { setDetailItem(item); setSearchResults([]); setSearchQ(item.name); }}
                      className="px-3 py-1 bg-violet-600 hover:bg-violet-500 rounded text-xs">匹配</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 分页 */}
        {total > 20 && (
          <div className="flex justify-center gap-2 mt-4">
            <button onClick={() => load(page - 1)} disabled={page <= 1} className="px-3 py-1 bg-white/10 rounded text-sm disabled:opacity-30">上一页</button>
            <span className="px-3 py-1 text-sm text-white/40">{page} / {Math.ceil(total / 20)}</span>
            <button onClick={() => load(page + 1)} disabled={page >= Math.ceil(total / 20)} className="px-3 py-1 bg-white/10 rounded text-sm disabled:opacity-30">下一页</button>
          </div>
        )}
      </div>
    </div>
  );
}