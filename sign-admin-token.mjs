// 从 Vercel 拉 env 拿 JWT_SECRET
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL || '');

// 从 xx_users 找一个 admin 用户的 id
const r = await sql`SELECT id, username, user_group FROM xx_users WHERE user_group = 'admin' LIMIT 1`;
if (!r[0]) { console.log('no admin'); process.exit(1); }

// 用 env JWT_SECRET 签 token (跟服务端一样)
const secret = process.env.JWT_SECRET || 'cLWhs2015';
const token = jwt.sign(
  { id: r[0].id, username: r[0].username, user_group: r[0].user_group, group: r[0].user_group },
  secret,
  { expiresIn: '7d' }
);
console.log('USER_ID=' + r[0].id);
console.log('TOKEN=' + token);
process.exit(0);
