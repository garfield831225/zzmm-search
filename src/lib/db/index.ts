import { neon } from '@neondatabase/serverless';

export function getDb() {
  return neon(process.env.DATABASE_URL!);
}

export const sql = neon(process.env.DATABASE_URL!);
