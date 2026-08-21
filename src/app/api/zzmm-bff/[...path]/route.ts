import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BFF_BASE = process.env.BFF_BASE_URL || 'http://127.0.0.1:3007';

function buildPath(params: { path?: string | string[] }): string {
  const p = params.path;
  if (Array.isArray(p)) return p.join('/');
  if (typeof p === 'string') return p;
  return '';
}

async function proxy(req: NextRequest, params: { path?: string | string[] }): Promise<NextResponse> {
  const subPath = buildPath(params);
  const search = req.nextUrl.search || '';
  const target = `${BFF_BASE}/api/${subPath}${search}`;

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === 'host' || lk === 'connection' || lk === 'content-length') return;
    headers[k] = v;
  });

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: 'no-store',
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      init.body = await req.text();
    } catch {
      /* no body */
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e: any) {
    return NextResponse.json(
      { error: 'bff_unreachable', target, message: e?.message || String(e) },
      { status: 502, headers: corsHeaders() }
    );
  }

  const buf = await upstream.arrayBuffer();
  const respHeaders = new Headers(corsHeaders());
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === 'content-encoding' || lk === 'transfer-encoding' || lk === 'connection') return;
    respHeaders.set(k, v);
  });

  return new NextResponse(buf, {
    status: upstream.status,
    headers: respHeaders,
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}

export async function GET(req: NextRequest, ctx: { params: { path?: string | string[] } }) {
  return proxy(req, ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: { path?: string | string[] } }) {
  return proxy(req, ctx.params);
}
export async function PUT(req: NextRequest, ctx: { params: { path?: string | string[] } }) {
  return proxy(req, ctx.params);
}
export async function DELETE(req: NextRequest, ctx: { params: { path?: string | string[] } }) {
  return proxy(req, ctx.params);
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
