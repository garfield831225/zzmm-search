// /api/auth/sso/redirect - zzmm-search 端 SSO 跳板
// 跳 https://scraper.cc.cd/api/auth/sso/redirect?source=zzmm-search&target=zzmm-search
// scraper 再走它自己的 Moviezone 登录流程
// Moviezone 登录后 scraper 生成 sso_token 跳回 /api/auth/sso/callback
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SCRAPER_SSO_URL = 'https://scraper.cc.cd/api/auth/sso/redirect';
const ZZMM_CALLBACK_URL = 'https://zzmm-search.cc.cd/api/auth/sso/callback';

export async function GET(request: NextRequest) {
  // 直接中转到 scraper 端 SSO redirect
  // scraper 端认 source 和 target 参数
  const params = new URLSearchParams();
  params.set('source', 'zzmm-search');
  params.set('target', 'zzmm-search');
  params.set('callback', ZZMM_CALLBACK_URL);
  // 注: scraper 端 SSO redirect 处理 source/target/callback 三个参数
  // 我们传 source/target 让 scraper 知道是 zzmm-search 来的
  // callback 是 scraper 登录后跳回的目标 URL
  const target = `${SCRAPER_SSO_URL}?${params.toString()}`;
  return NextResponse.redirect(target, 302);
}
