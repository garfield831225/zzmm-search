'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useParams, usePathname } from 'next/navigation';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

interface ApprovedItem {
  resourceId: number;
  name: string;
  source: string;
  link: string;
  linkCode: string;
  category: string;
  accessLevel: string;
  createdAt: string;
}

interface PendingItem {
  pendingId: number;
  name: string;
  type: string;
  links: string[];
  size: string | null;
  sizeUnit: string | null;
  note: string | null;
  status: string;
  submittedAt: string;
}

interface CurrentUser {
  id: number;
  group: string;
  username: string;
}

interface Tmdb {
  id: number;
  tmdbId: number;
  tmdbType: string;
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  releaseDate: string | null;
}

const TOKEN = () => typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || localStorage.getItem('adminToken') || localStorage.getItem('token') || '') : '';

const VALID_TYPES = ['4K原盘', '原盘', 'REMUX', '4K', '杜比视界', '1080P', '720P', '低分辨率'];
const VALID_UNITS = ['GB', 'TB', 'MB'];

export default function UpcomingDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id);
  const pathname = usePathname();

  const [tmdb, setTmdb] = useState<Tmdb | null>(null);
  const [approved, setApproved] = useState<ApprovedItem[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 上传弹窗
  const [showUpload, setShowUpload] = useState(false);
  const [uploadType, setUploadType] = useState('1080P');
  const [uploadLinks, setUploadLinks] = useState<string[]>(['']);
  const [uploadSize, setUploadSize] = useState('');
  const [uploadUnit, setUploadUnit] = useState('GB');
  const [uploadNote, setUploadNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/upcoming/${id}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${TOKEN()}` },
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const d = await r.json();
      setTmdb(d.tmdb);
      setApproved(d.approved || []);
      setPending(d.pending || []);
      setCurrentUser(d.currentUser);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchData();
  }, [id, pathname]);

  const addLinkField = () => {
    if (uploadLinks.length >= 10) return;
    setUploadLinks([...uploadLinks, '']);
  };
  const removeLinkField = (idx: number) => {
    if (uploadLinks.length <= 1) return;
    setUploadLinks(uploadLinks.filter((_, i) => i !== idx));
  };
  const updateLinkField = (idx: number, value: string) => {
    setUploadLinks(uploadLinks.map((l, i) => i === idx ? value : l));
  };

  const onUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      setSubmitMsg('❌ 请先登录');
      return;
    }
    const validLinks = uploadLinks.map(l => l.trim()).filter(l => l);
    if (validLinks.length === 0) {
      setSubmitMsg('❌ 至少填 1 个链接');
      return;
    }

    setSubmitting(true);
    setSubmitMsg(null);
    try {
      // 2026-08-05: size 入库前 .toFixed(2) 保留两位小数
      const sizeNormalized = uploadSize ? parseFloat(uploadSize).toFixed(2) : '';
      const r = await fetch(`/api/upcoming/${id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify({
          type: uploadType,
          links: validLinks,
          size: sizeNormalized || null,
          size_unit: sizeNormalized ? uploadUnit : null,
          note: uploadNote || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setSubmitMsg('❌ ' + (d.error || `HTTP ${r.status}`));
        setSubmitting(false);  // 2026-08-05: 失败立即解除 disabled, 之前 finally 之前 return 卡住
        return;
      }
      setSubmitMsg('✅ ' + d.message);
      // 清空表单
      setUploadType('1080P');
      setUploadLinks(['']);
      setUploadSize('');
      setUploadUnit('GB');
      setUploadNote('');
      // 刷新
      await fetchData();
    } catch (e: any) {
      setSubmitMsg('❌ ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] text-white/40 text-sm">加载中...</div>;
  }
  if (error || !tmdb) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
        <div className="max-w-4xl mx-auto">
          <Link href="/upcoming" className="text-white/60 hover:text-white text-sm">← 返回最新上映</Link>
          <div className="mt-6 text-red-400">❌ {error || '数据加载失败'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-gradient-to-b from-[#0a0a0f] to-[#0a0a0f]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/upcoming" className="text-white/60 hover:text-white text-sm">← 返回最新上映</Link>
          {currentUser ? (
            <div className="text-xs text-white/40">
              {currentUser.username} ({currentUser.group})
              {currentUser.group === 'admin' && <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded text-[10px]">✅ 直入</span>}
              {currentUser.group !== 'admin' && <span className="ml-2 px-1.5 py-0.5 bg-cyan-500/20 text-cyan-300 rounded text-[10px]">⏳ 需审核</span>}
            </div>
          ) : (
            <Link href="/login" className="text-xs text-amber-300 hover:text-amber-200">🔐 登录后上传</Link>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* TMDB 顶部信息 */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          {tmdb.posterUrl && (
            <img src={tmdb.posterUrl} alt={tmdb.title} className="w-32 sm:w-40 rounded-lg flex-shrink-0" />
          )}
          <div>
            <h1 className="text-2xl font-bold mb-1">{tmdb.title}</h1>
            <div className="text-xs text-white/40 mb-3">
              {tmdb.tmdbType === 'tv' ? '剧集' : '电影'} · TMDB #{tmdb.tmdbId} · {tmdb.releaseDate}
            </div>
            {tmdb.overview && (
              <p className="text-sm text-white/70 leading-relaxed line-clamp-4">{tmdb.overview}</p>
            )}
          </div>
        </div>

        {/* 上传按钮 + 弹窗 */}
        <div className="mb-6">
          {!showUpload ? (
            <button
              onClick={() => setShowUpload(true)}
              className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 rounded-lg font-semibold">
              📤 上传网盘链接 {currentUser ? '' : '(请先登录)'}
            </button>
          ) : (
            <form onSubmit={onUpload} className="bg-white/5 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-cyan-300">📤 上传网盘链接</div>
                <button type="button" onClick={() => setShowUpload(false)} className="text-xs text-white/40 hover:text-white">收起</button>
              </div>

              {/* 类型 */}
              <div>
                <label className="text-xs text-white/60">类型 (必选) *</label>
                <select
                  value={uploadType}
                  onChange={e => setUploadType(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm">
                  {VALID_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* 链接 (多条) */}
              <div>
                <label className="text-xs text-white/60">网盘链接 (必填, 自动识别 115/百度/阿里/夸克/磁力, 可多条) *</label>
                {uploadLinks.map((link, idx) => (
                  <div key={idx} className="flex gap-2 mt-1">
                    <input
                      type="text"
                      value={link}
                      onChange={e => updateLinkField(idx, e.target.value)}
                      placeholder={idx === 0 ? "https://pan.baidu.com/s/xxx 或 magnet:?" : "另一个链接 (可选)"}
                      className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm font-mono"
                    />
                    {uploadLinks.length > 1 && (
                      <button type="button" onClick={() => removeLinkField(idx)} className="px-2 py-1 bg-red-500/20 text-red-300 rounded text-xs">×</button>
                    )}
                  </div>
                ))}
                {uploadLinks.length < 10 && (
                  <button type="button" onClick={addLinkField} className="mt-1 text-xs text-cyan-400 hover:underline">+ 加一个链接</button>
                )}
              </div>

              {/* 大小 */}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-xs text-white/60">大小 (可选, 保留 2 位小数)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={uploadSize}
                    onChange={e => setUploadSize(e.target.value)}
                    placeholder="例: 4.50"
                    className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60">单位</label>
                  <select
                    value={uploadUnit}
                    onChange={e => setUploadUnit(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm">
                    {VALID_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {/* 备注 */}
              <div>
                <label className="text-xs text-white/60">备注 (可选, 最多 50 字)</label>
                <input
                  type="text"
                  maxLength={50}
                  value={uploadNote}
                  onChange={e => setUploadNote(e.target.value)}
                  placeholder="例: 国语中字 / 杜比音效 / 蓝光原盘"
                  className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm"
                />
                <div className="text-[10px] text-white/40 mt-0.5 text-right">{uploadNote.length}/50</div>
              </div>

              {submitMsg && (
                <div className={`text-sm rounded px-3 py-2 ${submitMsg.startsWith('✅') ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                  {submitMsg}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting || !currentUser}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded font-semibold text-sm">
                  {submitting ? '提交中...' : '提交'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowUpload(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded text-sm">
                  取消
                </button>
              </div>
            </form>
          )}
        </div>

        {/* 已入库 (approved) */}
        <div className="mb-6">
          <div className="text-sm font-semibold mb-2 flex items-center gap-2">
            ✅ 已入库资源
            <span className="text-xs text-white/40">({approved.length})</span>
          </div>
          {approved.length === 0 ? (
            <div className="text-center text-white/30 py-6 text-xs bg-white/5 rounded-lg">还没资源, 上面传一个</div>
          ) : (
            <div className="space-y-2">
              {approved.map(a => (
                <div key={a.resourceId} className="bg-white/5 rounded px-3 py-2 flex items-center gap-3">
                  {a.source && (
                    <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 rounded text-xs flex-shrink-0">{a.source}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" title={a.name}>{a.name}</div>
                    <div className="text-[10px] text-white/40 font-mono truncate">{a.link}</div>
                  </div>
                  <span className="text-[10px] text-white/40 flex-shrink-0">{a.category}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 我的 pending */}
        {currentUser && (
          <div className="mb-6">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              ⏳ 我提交的待审核
              <span className="text-xs text-white/40">({pending.length})</span>
            </div>
            {pending.length === 0 ? (
              <div className="text-center text-white/30 py-6 text-xs bg-white/5 rounded-lg">还没提交, 上面填一下</div>
            ) : (
              <div className="space-y-2">
                {pending.map(p => (
                  <div key={p.pendingId} className="bg-amber-500/5 border border-amber-500/20 rounded px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-amber-500/30 text-amber-300 rounded text-xs">{p.type}</span>
                      <span className="text-[10px] text-white/40">{p.links.length} 个链接</span>
                      {p.size && <span className="text-[10px] text-white/40">{Number(p.size).toFixed(2)} {p.sizeUnit}</span>}
                    </div>
                    <div className="text-[10px] text-white/40 font-mono truncate">{p.links.join(' | ')}</div>
                    {p.note && <div className="text-[10px] text-white/50 mt-0.5">📝 {p.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
