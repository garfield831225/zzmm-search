import { neon } from '@neondatabase/serverless';

// neondatabase v3: 直接导出 tagged template 函数
export const sql = neon(process.env.DATABASE_URL!);