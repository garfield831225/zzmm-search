// 2026-08-01: lib/neon-raw.ts - raw Neon HTTP API client (绕开 neon() SDK fetch cache)
// 背景: Neon serverless SDK 7.x 把 fetchConnectionCache 改 always true, fetchOptions.cache 不再生效
//   → SQL 响应被 SDK 内部 cache 5 分钟 (memory #9)
// 修法: 用 raw fetch 调 Neon HTTP endpoint, 加 `Cache-Control: no-store` 强制 no cache

const CS = process.env.DATABASE_URL || '';

interface NeonRow {
  [key: string]: any;
}

interface NeonResp {
  fields?: Array<{ name: string }>;
  rows?: any[][];
  rowAsArray?: boolean;
}

function parseNeonUrl(cs: string): { url: string; host: string } {
  // postgresql://user:pass@host/db?sslmode=require
  const u = new URL(cs);
  // 2026-08-01: Neon serverless SDK 实际 endpoint 是 https://api.<host>/sql, 不带 path (dbname)
  // SDK line 1017-1019: t.replace(/^[^.]+\./, "api.") + "/sql"
  // 例: ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech
  //   → https://api.c-2.ap-southeast-1.aws.neon.tech/sql (注意: /sql, 不是 /<dbname>/sql)
  const apiHost = u.host.replace(/^[^.]+\./, 'api.');
  return {
    url: cs,
    host: `https://${apiHost}/sql`,
  };
}

const { host: NEON_HTTP_URL } = parseNeonUrl(CS);

/**
 * 用 raw fetch 调 Neon HTTP API, 强制 no cache
 * @param sql SQL 字符串 (参数已 inline 替换, 不支持 $1/$2)
 * @returns rows 数组
 *
 * 2026-08-01: Neon HTTP API 不支持 params 参数化查询 (返 "query is not supported")
 *   → 必须用 inline 值. SQL injection 风险: 调用方负责, 内部 helper 已 escape.
 */
function escapeSql(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  // 字符串: 单引号 escape
  return `'${String(v).replace(/'/g, "''")}'`;
}

export async function rawNeon<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  // 占位符 $1, $2 ... 替换为 escape 后的值
  let actualSql = sql;
  if (params.length > 0) {
    actualSql = sql.replace(/\$(\d+)/g, (m, idx) => {
      const i = parseInt(idx, 10) - 1;
      if (i < 0 || i >= params.length) throw new Error(`rawNeon: missing param $${idx}`);
      return escapeSql(params[i]);
    });
  }
  const r = await fetch(NEON_HTTP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': CS,
      'Neon-Array-Mode': 'true',         // 必须, 否则返 "query is not supported"
      'Neon-Raw-Text-Output': 'true',   // 必须, 否则 body 格式不同
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
    body: JSON.stringify({ query: actualSql }),
    // 关键: Next.js fetch 层不 cache
    cache: 'no-store',
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Neon HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  const j: NeonResp = await r.json();
  if (j.rowAsArray === false && j.fields) {
    // 返 object
    return (j.rows || []).map((r: any) => {
      const o: any = {};
      j.fields!.forEach((f, i) => { o[f.name] = r[i]; });
      return o;
    });
  }
  return (j.rows || []) as any;
}
