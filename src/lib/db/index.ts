import { sql } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

const client = sql;
export const db = drizzle(client);