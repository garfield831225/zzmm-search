// diag-bearer for admin
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';

const env = readFileSync('C:/temp_zzmm/.env', 'utf-8');
const m = env.match(/DATABASE_URL=([^\n]+)/);
const sql = neon(m[1]);

const u = await sql`SELECT id, username, user_group FROM xx_users WHERE username = 'admin' LIMIT 1`;
console.log('[admin user]:', u);

const token = jwt.sign({ id: u[0].id, group: u[0].user_group, username: u[0].username }, 'cLWhs2015', { expiresIn: '1h' });

const r = await fetch('https://zzmm-search.cc.cd/api/search?q=&pageSize=3', {
  headers: { Authorization: `Bearer ${token}` }
});
const data = await r.json();
console.log('[admin search]', { status: r.status, total: data.total, items: data.items?.length, first: data.items?.[0]?.name, error: data.error });

// Test basic user 12
const u2 = await sql`SELECT id, username, user_group FROM xx_users WHERE username = '123123' LIMIT 1`;
const token2 = jwt.sign({ id: u2[0].id, group: u2[0].user_group, username: u2[0].username }, 'cLWhs2015', { expiresIn: '1h' });
const r2 = await fetch('https://zzmm-search.cc.cd/api/search?q=&pageSize=3', {
  headers: { Authorization: `Bearer ${token2}` }
});
const data2 = await r2.json();
console.log('[basic 123123 search]', { status: r2.status, total: data2.total, items: data2.items?.length, first: data2.items?.[0]?.name, error: data2.error });
