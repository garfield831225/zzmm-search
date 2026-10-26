// 2026-10-15: Neon HTTP client (@neondatabase/serverless) 在 Next.js 14 standalone + undici fetch 环境
//   下 SELECT/INSERT 都 hang (返 undefined 不抛错)。
//   改用 raw fetch 调用本地 Neon HTTP proxy (http://127.0.0.1:4444/sql), 完全绕开 Neon client。
//
//   sql(tag) 和 sql(strings, params) 两种调用形式都兼容:
//     await sql`SELECT * FROM users WHERE id = ${id}`
//     await sql('SELECT * FROM users WHERE id = $1', [id])
//
//   返回格式跟 Neon client 一致: [{col1: val1, ...}, ...]

const PROXY_URL = process.env.NEON_HTTP_PROXY_URL || 'http://127.0.0.1:4444/sql';

async function rawQuery(query: string, params: any[] = []): Promise<any[]> {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
    cache: 'no-store',
    keepalive: false,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DB HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json: any = await res.json();
  if (json.error) {
    throw new Error(`DB error: ${json.error}`);
  }
  // 2026-10-15: Neon HTTP proxy 返 rows 是 array of arrays, 手动转 object (用 fields.name)
  //   否则 rows[0].user_group 永远 undefined, 跟 Neon client 行为不一致
  const fields = json.fields || [];
  const rawRows = json.rows || [];
  return rawRows.map((row: any) => {
    if (Array.isArray(row)) {
      const obj: any = {};
      fields.forEach((f: any, i: number) => { obj[f.name] = row[i]; });
      return obj;
    }
    return row;
  });
}

function taggedToSQL(strings: TemplateStringsArray, values: any[]): { query: string; params: any[] } {
  const params: any[] = [];
  let query = strings[0];
  for (let i = 0; i < values.length; i++) {
    params.push(values[i]);
    query += `$${i + 1}` + (strings[i + 1] || '');
  }
  return { query, params };
}

function createSql(): any {
  const sql: any = async (stringsOrQuery: any, ...values: any[]) => {
    let query: string;
    let params: any[];
    if (typeof stringsOrQuery === 'string') {
      query = stringsOrQuery;
      params = (values[0] && Array.isArray(values[0])) ? values[0] : values;
    } else if (Array.isArray(stringsOrQuery)) {
      const t = taggedToSQL(stringsOrQuery as any, values);
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

export const sql = createSql();