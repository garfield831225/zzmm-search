// 2026-10-15: Neon HTTP client shim
// webpack alias @neondatabase/serverless → 这个文件
// 用 raw fetch 调用本地 Neon HTTP proxy (http://127.0.0.1:4444/sql), 绕开 Neon client.
//
// 关键: Neon HTTP proxy 返回的 rows 是 array 格式 ([val1, val2, ...])，
//       但 Neon client 默认期望 object 格式 ({col1: val1, col2: val2})。
//       我们手动把 array 转 object (用 fields.name 作为 key).

const PROXY_URL = 'http://127.0.0.1:4444/sql';

async function rawQuery(query, params = []) {
  let res;
  try {
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, params }),
      cache: 'no-store',
      keepalive: false,
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new Error(`DB fetch failed: ${e.message} (query=${query.slice(0, 80)})`);
  }
  if (!res.ok) {
    let txt = '';
    try { txt = await res.text(); } catch (e) { txt = '<read-failed:' + e.message + '>'; }
    throw new Error(`DB HTTP ${res.status}: ${String(txt).slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`DB error: ${json.error} (query=${query.slice(0, 80)})`);
  }
  // 把 array rows 转成 object rows (用 fields.name)
  // 2026-10-22 fix: boolean 字段必须转成真正的 true/false
  //   背景: zzm-neon-proxy 的 pg type parser 对 OID 16 (bool) 返回 raw text 't'/'f'
  //   → shim 原样透传 → 前端拿到字符串 'f'
  //   → JS 里 'f' 是 truthy! → `!item.is_used` 恒为 false
  //   → 后果: 邀请码列表所有码都显示"已用", 行操作按钮/复选框全部不渲染 (用户报"无法编辑")
  //   → 同类问题波及所有 boolean 字段 (unlocked / is_verified / active ...)
  //   修法: 按 fields.dataTypeID === 16 (bool) 转 true/false
  const BOOL_OID = 16;
  const fields = json.fields || [];
  const rows = (json.rows || []).map((row) => {
    if (Array.isArray(row)) {
      const obj = {};
      fields.forEach((f, i) => {
        let v = row[i];
        if (f && f.dataTypeID === BOOL_OID) {
          // 't'/'true'/true → true; 'f'/'false'/false → false; 其他保持原样
          if (v === 't' || v === 'true' || v === true) v = true;
          else if (v === 'f' || v === 'false' || v === false) v = false;
        }
        obj[f.name] = v;
      });
      return obj;
    }
    return row;
  });
  return rows;
}

function taggedToSQL(strings, values) {
  const params = [];
  let query = strings[0];
  for (let i = 0; i < values.length; i++) {
    params.push(values[i]);
    query += `$${i + 1}` + (strings[i + 1] || '');
  }
  return { query, params };
}

function makeSql() {
  const sql = (stringsOrQuery, ...values) => {
    let query;
    let params;
    if (typeof stringsOrQuery === 'string') {
      query = stringsOrQuery;
      params = (values[0] && Array.isArray(values[0])) ? values[0] : values;
    } else if (Array.isArray(stringsOrQuery)) {
      const t = taggedToSQL(stringsOrQuery, values);
      query = t.query;
      params = t.params;
    } else {
      throw new Error('sql() invalid input');
    }
    return rawQuery(query, params);
  };
  sql.transaction = async () => { throw new Error('sql.transaction() not implemented'); };
  sql.unsafe = sql;
  return sql;
}

export const neonConfig = {
  fetchConnectionCache: false,
  fetchEndpoint: () => PROXY_URL,
  poolQueryViaFetch: false,
};

export function neon(_url, _opts) {
  return makeSql();
}

export class Pool {
  constructor(_url, _opts) {
    this.url = _url;
    this.opts = _opts || {};
  }
  async query(query, params) {
    const rows = await rawQuery(query, params);
    return { rows, rowCount: rows.length, command: 'SELECT' };
  }
  async transaction(fn) {
    return fn(this);
  }
  end() {}
  async connect() {
    return { query: (q, p) => this.query(q, p), release: () => {} };
  }
}

// 2026-10-20: 兼容老代码用 Client alias (games/route.ts 等)
//   @neondatabase/serverless 的 Client 是 wire-protocol, shim 没真 pg client
//   这里 mock: connect() noop, query() 返空. games 业务暂返空数据 (后续可改用 neon())
export class Client {
  constructor(opts) {
    this.connectionString = opts && opts.connectionString;
  }
  async connect() { this.connected = true; }
  async query(_sql, _params) {
    // shim 里没真 pg client, 老代码用 Client 的路由会返空集 + console.warn
    console.warn('[neon-shim] Client.query not supported, use neon() instead (rows=0)');
    return { rows: [], rowCount: 0 };
  }
  async end() { /* noop */ }
}

export default { neon, neonConfig, Pool, Client };