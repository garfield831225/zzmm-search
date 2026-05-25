import { neon } from '@neondatabase/serverless';

// 延迟初始化，避免 build 时 env 未注入报错
function createSql() {
  if (!process.env.DATABASE_URL) {
    // build 时不抛出，返回一个无害的 mock
    return ((strings: any) => strings) as ReturnType<typeof neon>;
  }
  return neon(process.env.DATABASE_URL);
}

export const sql = createSql();