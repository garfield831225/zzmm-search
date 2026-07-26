// 2026-07-26: NAS 端 vip TMDB 同步触发器 (跟 match-now 同款)
// POST: spawn vip-tmdb-sync.sh 后台进程, 立即返回
// GET: 读取日志 + PID 状态
// DELETE: 杀掉
import { NextRequest, NextResponse } from 'next/server';
import { spawn, execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PROJECT_ROOT = process.env.ZZMM_PROJECT_ROOT || '/data_s001/docker/zzmm-search';
const SCRIPT_PATH = `${PROJECT_ROOT}/scripts/vip-sync-tmdb.sh`;
const LOG_FILE = `${PROJECT_ROOT}/logs/vip-sync.log`;
const PID_FILE = `${PROJECT_ROOT}/logs/vip-sync.pid`;

function authAdmin(req: NextRequest) {
  let token: string | null = null;
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ') && auth.length > 7) {
    token = auth.slice(7);
  } else {
    token = req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value || null;
  }
  if (!token) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cLWhs2015') as any;
    if (String(payload.user_group || payload.group || '').toLowerCase() !== 'admin') {
      return { error: '需要 admin', status: 403 };
    }
    return { userId: String(payload.id) };
  } catch {
    return { error: 'token 无效', status: 401 };
  }
}

function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    execSync(`kill -0 ${pid} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number {
  if (!existsSync(PID_FILE)) return 0;
  try {
    return parseInt(readFileSync(PID_FILE, 'utf8').trim()) || 0;
  } catch { return 0; }
}

function writePid(pid: number) {
  try {
    require('fs').writeFileSync(PID_FILE, String(pid));
  } catch {}
}

function clearPid() {
  try {
    if (existsSync(PID_FILE)) require('fs').unlinkSync(PID_FILE);
  } catch {}
}

// POST: 启动后台同步
export async function POST(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // 1) 检查是否已有任务在跑
  const existingPid = readPid();
  if (existingPid > 0 && isProcessAlive(existingPid)) {
    return NextResponse.json({
      error: '已有同步任务在跑',
      pid: existingPid,
      running: true,
    }, { status: 409 });
  }

  // 2) 解析参数 (pagesPerTask 默认 5)
  const body = await req.json().catch(() => ({}));
  const pagesPerTask = Math.min(50, Math.max(1, parseInt(body.pagesPerTask) || 5));

  // 3) 检查脚本是否存在
  if (!existsSync(SCRIPT_PATH)) {
    return NextResponse.json({
      error: `脚本不存在: ${SCRIPT_PATH} (容器 mount 没配?)`,
    }, { status: 500 });
  }

  // 4) spawn 后台进程 (用 bash, 脚本自己处理 env + 多任务)
  try {
    const child = spawn('bash', [SCRIPT_PATH, String(pagesPerTask)], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
    writePid(child.pid || 0);

    return NextResponse.json({
      ok: true,
      pid: child.pid,
      pagesPerTask,
      startedAt: new Date().toISOString(),
      logFile: LOG_FILE,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 300) }, { status: 500 });
  }
}

// GET: 查询状态
export async function GET(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const pid = readPid();
  const running = pid > 0 && isProcessAlive(pid);
  let logTail: string[] = [];
  let logSize = 0;
  let startedAt: string | null = null;
  let lastLine: string | null = null;

  if (existsSync(LOG_FILE)) {
    try {
      const content = readFileSync(LOG_FILE, 'utf8');
      logSize = content.length;
      const lines = content.split('\n').filter(Boolean);
      logTail = lines.slice(-30);
      // 解析 startedAt (最近一个 'sync start' 行)
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = lines[i].match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] VIP TMDB sync start/);
        if (m) { startedAt = m[1]; break; }
      }
      if (lines.length > 0) lastLine = lines[lines.length - 1];
    } catch {}
  }

  // 解析统计 (page 5/30: ok=100 fail=0 / page 30/30: ok=600 fail=0 / DONE:)
  const stats = parseStats(logTail);

  return NextResponse.json({
    running,
    pid: pid || null,
    startedAt,
    lastLine,
    logSize,
    logTail,
    scriptPath: SCRIPT_PATH,
    logFile: LOG_FILE,
    stats,
  });
}

// DELETE: 杀掉当前任务
export async function DELETE(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const pid = readPid();
  if (pid <= 0 || !isProcessAlive(pid)) {
    clearPid();
    return NextResponse.json({ ok: true, killed: false, reason: 'no running task' });
  }

  try {
    execSync(`kill ${pid}`);
    clearPid();
    return NextResponse.json({ ok: true, killed: true, pid });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}

function parseStats(logTail: string[]) {
  let totalSuccess = 0;
  let totalFail = 0;
  let lastPage = 0;
  let done = false;

  for (const line of logTail) {
    const m = line.match(/ok=(\d+)/g);
    if (m) {
      const nums = m.map(s => parseInt(s.split('=')[1]));
      // 取最大 (最后一次的累计)
      if (nums.length > 0) totalSuccess = Math.max(totalSuccess, nums[nums.length - 1]);
    }
    const m2 = line.match(/fail=(\d+)/g);
    if (m2) {
      const nums = m2.map(s => parseInt(s.split('=')[1]));
      if (nums.length > 0) totalFail = Math.max(totalFail, nums[nums.length - 1]);
    }
    const m3 = line.match(/page (\d+)\/(\d+)/);
    if (m3) lastPage = parseInt(m3[2]);
    if (line.includes('DONE:') || line.includes('sync done')) done = true;
  }
  return { totalSuccess, totalFail, lastPage, done };
}
