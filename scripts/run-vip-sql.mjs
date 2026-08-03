#!/usr/bin/env node
// 2026-07-24 跑 zzmm-vip 建表 SQL 到 Neon
// 用法: node run-vip-sql.mjs

import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as path from 'path';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('❌ DATABASE_URL not set (读 .env.production)');
  process.exit(1);
}

const sqlPath = path.join('C:', 'temp_zzmm', 'zzmm-search', 'db', 'migrations', '2026-07-24-vip-tables.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ SQL 文件不存在:', sqlPath);
  process.exit(1);
}

const sqlText = fs.readFileSync(sqlPath, 'utf-8');
console.log('▶ 读取 SQL:', sqlText.length, '字节');

// Neon serverless 不支持多语句一次执行, 必须拆成单条
function splitSql(text) {
  // 简单 split: 按分号 + 换行; 但要保留 $$ ... $$ 块 (PL/pgSQL 函数)
  const statements = [];
  let buf = '';
  let inDollar = false;
  let inLineComment = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    // 行注释
    if (c === '-' && next === '-' && !inDollar) {
      inLineComment = true;
    }
    if (c === '\n') inLineComment = false;
    if (inLineComment) continue;

    // $$ ... $$ 块
    if (c === '$' && next === '$') {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }
    buf += c;

    // 语句结束 (分号 + 换行)
    if (c === ';' && !inDollar) {
      const trimmed = buf.trim();
      if (trimmed && !trimmed.startsWith('--') && trimmed !== ';') {
        statements.push(trimmed);
      }
      buf = '';
    }
  }
  // 末尾
  const tail = buf.trim();
  if (tail && !tail.startsWith('--')) {
    statements.push(tail);
  }
  return statements;
}

const stmts = splitSql(sqlText);
console.log('▶ 解析出', stmts.length, '条 SQL 语句');

const sql = neon(DB_URL);

let ok = 0, fail = 0;
for (let i = 0; i < stmts.length; i++) {
  const s = stmts[i];
  const preview = s.slice(0, 60).replace(/\n/g, ' ');
  try {
    await sql(s);
    ok++;
    console.log(`  [${i + 1}/${stmts.length}] ✅ ${preview}...`);
  } catch (e) {
    fail++;
    console.error(`  [${i + 1}/${stmts.length}] ❌ ${preview}...`);
    console.error('    错误:', e.message);
    // 一些 IF NOT EXISTS 重复跑会报 "already exists" — 这种忽略
    if (e.message.includes('already exists') || e.message.includes('does not exist')) {
      fail--;
      console.log('    (忽略: 重复/兼容)');
    }
  }
}

console.log(`\n📊 完成: 成功 ${ok}, 失败 ${fail}`);

// 验证表是否存在
try {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'xx_vip_%'
    ORDER BY table_name`;
  console.log('\n✅ 已存在的 vip 表:');
  rows.forEach((r) => console.log('  -', r.table_name));
} catch (e) {
  console.error('❌ 验证失败:', e.message);
}

process.exit(fail > 0 ? 1 : 0);
