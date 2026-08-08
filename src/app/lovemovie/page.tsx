// 2026-08-08: VIP 影视 2 区 (主站 path /lovemovie -> 子域名 lovemovie.zzmm-search.uk)
// 2026-08-08 修: 之前是占位页"建设中", 用户访问 zzmm-search.uk/lovemovie 看的是占位页
// 2026-08-08 修: CF tunnel 配了 lovemovie.zzmm-search.uk 子域名 -> NAS 172.17.0.1:8688 (server.py)
// 2026-08-08 修: 主站 /lovemovie 跳子域名, 不再显示占位页
// 2026-08-08 修: cookie 加 domain='.zzmm-search.uk' 让子域名共享登录态 (上一 commit 30f9a55a)
//
// redirect 是 server-side 307 跳, 浏览器看到的是 lovemovie.zzmm-search.uk
// iframe 嵌入方案废弃 (跟子域名方案重复, 直接跳更干净)

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function LoveMoviePage() {
  // 307 跳子域名 (影视站 mirror, server.py 在 NAS 8688)
  redirect('https://lovemovie.zzmm-search.uk/');
}
