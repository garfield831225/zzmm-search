import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    JWT_SECRET_set: Boolean(process.env.JWT_SECRET),
    TMDB_API_KEY_set: Boolean(process.env.TMDB_API_KEY),
    DATABASE_URL_set: Boolean(process.env.DATABASE_URL),
    REDIS_HOST_set: Boolean(process.env.REDIS_HOST),
    SITE_NAME: process.env.SITE_NAME || '',

  });
}