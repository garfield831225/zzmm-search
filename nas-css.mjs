// NAS 静态资源 + 模拟登录跑 vip API
import { execSync } from 'child_process';
import * as fs from 'fs';

const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';
const script = `set -e
echo "[1] CSS 文件"
ls /data_s001/docker/zzmm-search/.next/static/css/ 2>&1
echo "[2] 模拟登录 admin 拿 token"
curl -sS -X POST "http://localhost:3004/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"zzmm2026","captcha":"1234"}' \\
  -c /tmp/c.txt -o /tmp/lj.json
head -c 200 /tmp/lj.json
echo ""
echo "[3] /api/vip 模拟带 token"
TOKEN=$(curl -sS -X POST "http://localhost:3004/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"zzmm2026","captcha":"1234"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo "TOKEN=${TOKEN}" | head -c 60
curl -sS "http://localhost:3004/api/vip?pageSize=2&sort=smart" \\
  -H "Authorization: Bearer $TOKEN" -o /tmp/vip.json -w "code=%{http_code} size=%{size_download}\\n"
head -c 600 /tmp/vip.json
echo ""
echo "[4] /vip page 完整 HTML"
curl -sS "http://localhost:3004/vip" -o /tmp/v.html -w "code=%{http_code} size=%{size_download}\\n"
head -c 400 /tmp/v.html
echo ""
echo "[5] CSS 直接访问"
curl -sS -o /dev/null -w "css code=%{http_code}\\n" "http://localhost:3004/_next/static/css/785ee0dd9573a1cf.css"
`;

fs.writeFileSync('C:\\temp_zzmm\\css.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P 10000 -l 13381064903 -pw @G831225dd -hostkey "${hostkey}" C:\\temp_zzmm\\css.sh 13381064903@223.72.106.229:/tmp/css.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', '10000', '-l', '13381064903', '-pw', '@G831225dd', '-hostkey', hostkey, '-no-antispoof', '223.72.106.229', `echo '@G831225dd' | sudo -S -p '' bash /tmp/css.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
