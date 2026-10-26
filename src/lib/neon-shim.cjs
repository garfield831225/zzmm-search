// 2026-10-15: Neon HTTP client (@neondatabase/serverless) 在 Next.js 14 standalone + undici fetch
//   环境下 SELECT/INSERT 都 hang. 用 raw fetch 调用本地 Neon HTTP proxy 绕开 Neon client.
//
//   加载方式: neon-patch.cjs 在 server.js 启动前 require, 把 shim 注入 require.cache

const PROXY_URL = process.env.NEON_HTTP_PROXY_URL || 'http://127.0.0.1:4444/sql';

async function rawQuery(query, params) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params: params || [] }),
    cache: 'no-store',
    keepalive: false,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DB HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`DB error: ${json.error}`);
  }
  return json.rows;
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

const neonConfig = {
  fetchConnectionCache: false,
  fetchEndpoint: () => PROXY_URL,
  poolQueryViaFetch: false,
};

function neon(_url, _opts) {
  return makeSql();
}

class Pool {
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

module.exports = { neon, neonConfig, Pool };
module.exports.default = module.exports;