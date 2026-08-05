'use client';
// 2026-08-05: 通用上传按钮 (全站用)
//   - props: tmdbId, tmdbType, tmdbTitle, mode='icon'|'button'
//   - 弹 modal 提交到 /api/upload
//   - mode='icon': 卡片右上角小图标 (Section 列表用)
//   - mode='button': 大按钮 (详情页用)
import { useState } from 'react';
import { Upload, X, Check, AlertCircle } from 'lucide-react';

const VALID_TYPES = ['4K原盘', '原盘', 'REMUX', '4K', '杜比视界', '1080P', '720P', '低分辨率'];
const VALID_UNITS = ['GB', 'TB', 'MB'];

interface UploadButtonProps {
  tmdbId: string | number;
  tmdbType: 'movie' | 'tv';
  tmdbTitle: string;
  posterPath?: string | null;
  releaseDate?: string | null;
  mode?: 'icon' | 'button';
  onSuccess?: () => void;
}

export default function UploadButton({ tmdbId, tmdbType, tmdbTitle, posterPath, releaseDate, mode = 'icon', onSuccess }: UploadButtonProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('1080P');
  const [uploadLinks, setUploadLinks] = useState<string[]>(['']);
  const [size, setSize] = useState('');
  const [sizeUnit, setSizeUnit] = useState('GB');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const addLink = () => {
    if (uploadLinks.length >= 10) return;
    setUploadLinks([...uploadLinks, '']);
  };
  const removeLink = (i: number) => {
    if (uploadLinks.length <= 1) return;
    setUploadLinks(uploadLinks.filter((_, idx) => idx !== i));
  };
  const updateLink = (i: number, v: string) => {
    setUploadLinks(uploadLinks.map((l, idx) => idx === i ? v : l));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const validLinks = uploadLinks.map(l => l.trim()).filter(l => l);
    if (validLinks.length === 0) {
      setMsg({ ok: false, text: '❌ 至少填 1 个链接' });
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          tmdb_id: String(tmdbId),
          tmdb_type: tmdbType,
          tmdb_title: tmdbTitle,
          type,
          links: validLinks,
          size: size || null,
          size_unit: size ? sizeUnit : null,
          note: note || null,
          poster_path: posterPath || null,
          release_date: releaseDate || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ ok: false, text: '❌ ' + (d.error || `HTTP ${r.status}`) });
        setSubmitting(false);
        return;
      }
      setMsg({ ok: true, text: d.message || '✅ 提交成功' });
      // 3 秒后自动关闭
      setTimeout(() => {
        setOpen(false);
        setMsg(null);
        // 重置表单
        setType('1080P');
        setUploadLinks(['']);
        setSize('');
        setSizeUnit('GB');
        setNote('');
        onSuccess?.();
      }, 2500);
    } catch (e: any) {
      setMsg({ ok: false, text: '❌ ' + e.message });
    } finally {
      setSubmitting(false);
    }
  };

  // icon 模式: 小图标按钮
  if (mode === 'icon') {
    return (
      <>
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
          className="absolute top-1.5 right-1.5 z-20 w-6 h-6 rounded-full bg-cyan-600/90 hover:bg-cyan-500 text-white flex items-center justify-center shadow-md backdrop-blur-sm transition"
          title="上传网盘链接"
        >
          <Upload size={12} />
        </button>
        {open && <UploadModal open={open} onClose={() => setOpen(false)} {...{ type, setType, uploadLinks, addLink, removeLink, updateLink, size, setSize, sizeUnit, setSizeUnit, note, setNote, submitting, msg, onSubmit }} />}
      </>
    );
  }

  // button 模式: 大按钮 (详情页用)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 rounded-lg font-semibold text-white shadow-lg"
      >
        📤 上传网盘链接
      </button>
      {open && <UploadModal open={open} onClose={() => setOpen(false)} {...{ type, setType, uploadLinks, addLink, removeLink, updateLink, size, setSize, sizeUnit, setSizeUnit, note, setNote, submitting, msg, onSubmit }} />}
    </>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  type: string;
  setType: (v: string) => void;
  uploadLinks: string[];
  addLink: () => void;
  removeLink: (i: number) => void;
  updateLink: (i: number, v: string) => void;
  size: string;
  setSize: (v: string) => void;
  sizeUnit: string;
  setSizeUnit: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  submitting: boolean;
  msg: { ok: boolean; text: string } | null;
  onSubmit: (e: React.FormEvent) => void;
}

function UploadModal({ open, onClose, type, setType, uploadLinks, addLink, removeLink, updateLink, size, setSize, sizeUnit, setSizeUnit, note, setNote, submitting, msg, onSubmit }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#12121a] border border-white/10 rounded-xl p-5 max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-cyan-300">📤 上传网盘链接</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {/* 类型 */}
          <div>
            <label className="text-xs text-white/60">类型 *</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm text-white"
            >
              {VALID_TYPES.map(t => <option key={t} value={t} className="bg-[#12121a]">{t}</option>)}
            </select>
          </div>

          {/* 链接 */}
          <div>
            <label className="text-xs text-white/60">网盘链接 * (1-10 个, 自动识别 115/百度/阿里/夸克/磁力)</label>
            {uploadLinks.map((link, i) => (
              <div key={i} className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={link}
                  onChange={e => updateLink(i, e.target.value)}
                  placeholder={i === 0 ? 'https://pan.baidu.com/s/xxx 或 magnet:?' : '另一个链接 (可选)'}
                  className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm font-mono text-white"
                />
                {uploadLinks.length > 1 && (
                  <button type="button" onClick={() => removeLink(i)} className="px-2 bg-red-500/20 text-red-300 rounded text-xs">×</button>
                )}
              </div>
            ))}
            {uploadLinks.length < 10 && (
              <button type="button" onClick={addLink} className="mt-1 text-xs text-cyan-400 hover:underline">+ 加一个链接</button>
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
                value={size}
                onChange={e => setSize(e.target.value)}
                placeholder="例: 4.50"
                className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-white/60">单位</label>
              <select
                value={sizeUnit}
                onChange={e => setSizeUnit(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm text-white"
              >
                {VALID_UNITS.map(u => <option key={u} value={u} className="bg-[#12121a]">{u}</option>)}
              </select>
            </div>
          </div>

          {/* 备注 */}
          <div>
            <label className="text-xs text-white/60">备注 (可选, 最多 50 字)</label>
            <input
              type="text"
              maxLength={50}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="例: 国语中字 / 杜比音效"
              className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm text-white"
            />
          </div>

          {msg && (
            <div className={`text-sm rounded px-3 py-2 ${msg.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
              {msg.text}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded font-semibold text-sm text-white"
            >
              {submitting ? '提交中...' : '提交'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded text-sm text-white"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
