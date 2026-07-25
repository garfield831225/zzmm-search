#!/usr/bin/env node
// watchdog-tunnel.mjs
// 监控 trycloudflare URL 变化, 自动更新 Cloudflare Worker script
// 跑在 NAS 上, 通过 cron 每分钟跑一次
//
// 流程:
//   1) 读 cf-quick-zzmm 容器日志, 提取最新 trycloudflare URL
//   2) 跟 /data_s001/docker/zzmm-search/logs/trycf-url.txt 对比
//   3) 不一样就调 CF API 更新 Worker script, 写新 URL 到文件
//
// 依赖: docker, curl, jq 可选 (用 grep -oE 也行)

import { readFileSync as rf, writeFileSync as wf, existsSync as ef } from 'fs';
import { execSync } from 'child_process';

const WORKER_NAME = 'zzmm-reverse';
const CF_API_TOKEN = process.env.CF_API_TOKEN || 'PLACEHOLDER_CF_API_TOKEN';
const CF_ACCOUNT_ID = 'b2ef6ab0b2b7c59b84719e0c22bea79a';
const STATE_FILE = '/data_s001/docker/zzmm-search/logs/trycf-url.txt';
const CONTAINER_NAME = 'cf-quick-zzmm';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { wf('/data_s001/docker/zzmm-search/logs/watchdog.log', line + '\n', { flag: 'a' }); } catch {}
}

function getCurrentUrl() {
  try {
    // docker logs 容器, 找 https://xxx.trycloudflare.com
    const out = execSync(`docker logs ${CONTAINER_NAME} 2>&1 | grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' | tail -1`, { encoding: 'utf8' });
    return out.trim();
  } catch (e) {
    return null;
  }
}

function getLastUrl() {
  if (!ef(STATE_FILE)) return null;
  try {
    return rf(STATE_FILE, 'utf8').trim();
  } catch { return null; }
}

async function getWorkerScript() {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`, {
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
  });
  if (!r.ok) return null;
  return await r.text();
}

function buildNewScript(targetUrl) {
  return `export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrl = '${targetUrl}' + url.pathname + url.search;
    const newReq = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
    });
    try {
      const resp = await fetch(newReq);
      const newHeaders = new Headers(resp.headers);
      newHeaders.set('x-proxied-by', 'cloudflare-worker');
      newHeaders.set('x-trycf-source', '${targetUrl}');
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response('zzmm-search proxy error: ' + e.message, { status: 502 });
    }
  },
};
`;
}

async function updateWorkerScript(newUrl) {
  const script = buildNewScript(newUrl);
  // 手动构造 multipart/form-data (CF API 需要 metadata + script 两个 part)
  const boundary = '----ZZMMWatchdog' + Math.random().toString(16).slice(2);
  const meta = JSON.stringify({
    main_module: 'index.js',
    bindings: [],
    compatibility_date: '2024-01-01',
  });
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="metadata"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    meta + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="script"; filename="index.js"\r\n` +
    `Content-Type: application/javascript+module\r\n\r\n` +
    script + `\r\n` +
    `--${boundary}--\r\n`;

  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const t = await r.text();
  if (!r.ok) {
    log(`Worker PUT failed: ${r.status} ${t.slice(0, 200)}`);
    return false;
  }
  log(`✅ Worker script updated to ${newUrl}`);
  return true;
}

async function main() {
  const current = getCurrentUrl();
  const last = getLastUrl();

  if (!current) {
    log('no trycloudflare URL found in container logs');
    return;
  }

  if (current === last) {
    log(`URL unchanged: ${current}`);
    return;
  }

  log(`URL changed: ${last || '(none)'} → ${current}`);
  const ok = await updateWorkerScript(current);
  if (ok) {
    wf(STATE_FILE, current);
    log(`state saved to ${STATE_FILE}`);
  } else {
    log('update failed, state NOT saved');
  }
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
