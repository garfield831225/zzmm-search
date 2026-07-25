// 简化版 - 不用 template literal
import { execSync } from 'child_process';
import * as fs from 'fs';

const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

// 用反引号 + \$ 转义
const script = 'set -e\n' +
  'echo "[1] CSS 文件"\n' +
  'ls /data_s001/docker/zzmm-search/.next/static/css/ 2>&1\n' +
  'echo "[2] 模拟登录 admin 拿 token"\n' +
  'curl -sS -X POST "http://localhost:3004/api/auth/login" -H "Content-Type: application/json" -d \'{"username":"admin","password":"zzmm2026","captcha":"1234"}\' -o /tmp/lj.json\n' +
  'head -c 200 /tmp/lj.json\n' +
  'echo ""\n' +
  'echo "[3] 提取 token 调 /api/vip"\n' +
  'TOKEN=$(cat /tmp/lj.json | grep -o \'"token":"[^"]*\' | cut -d\'"\' -f4)\n' +
  'echo "TOKEN len: ${#TOKEN}"\n' +
  'curl -sS "http://localhost:3004/api/vip?pageSize=2&sort=smart" -H "Authorization: Bearer $TOKEN" -o /tmp/vip.json -w "code=%{http_code} size=%{size_download}\\n"\n' +
  'head -c 500 /tmp/vip.json\n' +
  'echo ""\n' +
  'echo "[4] CSS 直接访问"\n' +
  'curl -sS -o /dev/null -w "css code=%{http_code} size=%{size_download}\\n" "http://localhost:3004/_next/static/css/785ee0dd9573a1cf.css"\n' +
  'echo "[5] vip page chunk 直接访问"\n' +
  'curl -sS -o /dev/null -w "page code=%{http_code} size=%{size_download}\\n" "http://localhost:3004/_next/static/chunks/app/vip/page-0eee0908e5973573.js"\n';

fs.writeFileSync('C:\\temp_zzmm\\css2.sh', script);
execSync('"C:\\Program Files\\PuTTY\\pscp.exe" -P 10000 -l 13381064903 -pw @G831225dd -hostkey "' + hostkey + '" C:\\temp_zzmm\\css2.sh 13381064903@223.72.106.229:/tmp/css2.sh', { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', '10000', '-l', '13381064903', '-pw', '@G831225dd', '-hostkey', hostkey, '-no-antispoof', '223.72.106.229', "echo '@G831225dd' | sudo -S -p '' bash /tmp/css2.sh"];
try {
  execSync('"' + PLINK + '" ' + args.map(a => '"' + a + '"').join(' '), { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
