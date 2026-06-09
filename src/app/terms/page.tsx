'use client';

import Link from 'next/link';
import { Home, AlertTriangle, MessageCircle } from 'lucide-react';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">📋 服务条款</h1>
          <Link href="/" className="text-sm text-white/40 hover:text-white/80 inline-flex items-center gap-1">
            <Home className="w-3 h-3" /> 返回首页
          </Link>
        </div>

        <div className="bg-[#12121a] rounded-2xl p-6 sm:p-8 border border-white/5 space-y-6 text-sm leading-relaxed text-white/80">
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-amber-200">
              <b>请仔细阅读：</b>使用本站服务即视为同意以下条款。继续操作代表您已了解并接受全部内容。
            </div>
          </div>

          <section>
            <h2 className="text-lg font-bold text-white mb-2">1. 服务性质</h2>
            <p>泽泽妈妈资源库（以下简称"本站"）是一个<b>个人学习交流平台</b>，所有资源链接均来自互联网公开渠道收集整理，仅供用户<b>个人学习、研究或欣赏</b>。</p>
            <p className="mt-2">本站不存储、不上传、不传播任何资源文件本体，<b>不对资源内容拥有版权</b>。</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-2">2. 用户行为规范</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>用户应遵守所在国家/地区的法律法规</li>
              <li><b>严禁</b>将本站资源用于任何商业用途、二次销售、公开放映</li>
              <li><b>严禁</b>利用本站从事侵犯第三方版权、信息安全、网络安全等违法行为</li>
              <li><b>严禁</b>使用脚本、机器人批量爬取本站数据</li>
              <li><b>严禁</b>转售、共享、出借 VIP 账号或激活码</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-2">3. 版权与下架</h2>
            <p>如您是版权方，认为本站收录的资源链接侵犯了您的合法权益，请通过下方任一方式联系本站，<b>本站将在 24 小时内核实并删除相关链接</b>。</p>
            <p className="mt-2">联系时请提供：</p>
            <ul className="list-disc list-inside space-y-1.5 mt-1">
              <li>您的身份证明（版权方或授权代理人）</li>
              <li>涉嫌侵权资源链接（URL 即可）</li>
              <li>权属证明（版权登记证书、原始链接等）</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-2">4. VIP 会员服务</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>VIP 会员为虚拟商品，<b>一经售出，激活码一经发出，原则上不予退款</b></li>
              <li>因技术故障、不可抗力导致服务中断的，本站有权<b>延长相应 VIP 时长</b>作为补偿</li>
              <li>VIP 会员到期后账号自动降级为普通用户，已解锁的单资源权限保持不变</li>
              <li>激活码一经使用即视为消费完成，不可二次使用</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-2">5. 免责声明</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>本站不对资源链接的可用性、稳定性、内容准确性做任何明示或暗示的担保</li>
              <li>用户因使用本站资源产生的任何直接或间接损失，本站不承担责任</li>
              <li>第三方链接的稳定性、内容合规性由第三方负责</li>
              <li>因网络运营商、DNS 污染、地区屏蔽等导致的访问问题，不属于本站服务故障</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-2">6. 条款变更</h2>
            <p>本站有权根据法律法规变更或运营需要修改本条款。修改后的条款将在本页面发布，立即生效。继续使用本站服务即视为接受修改后的条款。</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-2">7. 联系方式</h2>
            <div className="space-y-2 mt-2 text-white">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-sky-400" />
                <span>Telegram 客服群:</span>
                <a href="https://t.me/ziyuankefuqun" target="_blank" rel="noopener" className="text-sky-400 hover:underline">泽泽客服群</a>
              </div>
              </div>
          </section>

          <div className="text-xs text-white/30 pt-4 border-t border-white/5">
            最后更新: 2026-06-09 · 本站保留最终解释权
          </div>
        </div>
      </div>
    </div>
  );
}
