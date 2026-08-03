// 2026-07-23: NAS 端批量匹配触发器
// POST: spawn match-direct.mjs 后台进程, 立即返回
// GET: 读取日志 + PID 状态
import { NextRequest, NextResponse } from 'next/server';
import { spawn, execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;  // spawn + 返回, 应该秒级

// 2026-07-25: NAS systemd 部署, 不是 Docker. 改用绝对路径
const PROJECT_ROOT = process.env.ZZMM_PROJECT_ROOT || '/data_s001/docker/zzmm-search';
const SCRIPT_PATH = `${PROJECT_ROOT}/scripts/match-direct.mjs`;
const LOG_FILE = `${PROJECT_ROOT}/logs/match.log`;
const PID_FILE = `${PROJECT_ROOT}/logs/match.pid`;

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
    // kill -0 只检查进程是否存在, 不真杀
    execSync(`kill -0 ${pid} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number {
  if (!existsSync(PID_FILE)) return 0;
  try {
    const content = readFileSync(PID_FILE, 'utf8').trim();
    return parseInt(content) || 0;
  } catch {
    return 0;
  }
}

// POST: 启动后台匹配
export async function POST(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // 1) 检查是否已有任务在跑
  const existingPid = readPid();
  if (existingPid > 0 && isProcessAlive(existingPid)) {
    return NextResponse.json({
      error: '已有匹配任务在跑',
      pid: existingPid,
      running: true,
    }, { status: 409 });
  }

  // 2) 解析参数
  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(2000, Math.max(50, parseInt(body.batchSize) || 500));
  const dryRun = body.dryRun === true;

  // 3) 检查脚本是否存在
  if (!existsSync(SCRIPT_PATH)) {
    return NextResponse.json({
      error: `脚本不存在: ${SCRIPT_PATH} (容器 mount 没配?)`,
    }, { status: 500 });
  }

  // 4) spawn 后台进程
  const args = [SCRIPT_PATH, '--batch', String(batchSize), '--log', LOG_FILE, '--pid', PID_FILE];
  if (dryRun) args.push('--dry-run');

  try {
    const child = spawn('node', args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ENV_FILE: '/app/.env.production' },
    });
    child.unref();

    return NextResponse.json({
      ok: true,
      pid: child.pid,
      batchSize,
      dryRun,
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
      // 取最后 20 行
      logTail = lines.slice(-20);
      // 解析 startedAt (从第一行 [timestamp] start: ... 提取)
      if (lines[0]) {
        const m = lines[0].match(/^\[([^\]]+)\]/);
        if (m) startedAt = m[1];
      }
      if (lines.length > 0) lastLine = lines[lines.length - 1];
    } catch {}
  }

  return NextResponse.json({
    running,
    pid: pid || null,
    startedAt,
    lastLine,
    logSize,
    logTail,
    scriptPath: SCRIPT_PATH,
    logFile: LOG_FILE,
  });
}

// DELETE: 杀掉当前任务
export async function DELETE(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const pid = readPid();
  if (pid <= 0 || !isProcessAlive(pid)) {
    return NextResponse.json({ ok: true, killed: false, reason: 'no running task' });
  }

  try {
    execSync(`kill ${pid}`);
    return NextResponse.json({ ok: true, killed: true, pid });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
