// 测试登录后访问 /vip + RSC fetch
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PSCP = 'C:\\Program Files\\PuTTY\\pscp.exe';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `set -e
echo "[1] 模拟登录拿 cookie"
curl -sS -X POST "http://localhost:3004/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"zzmm2026","captcha":"1234"}' \\
  -c /tmp/cookies.txt -o /tmp/login.json
cat /tmp/login.json
echo ""
echo "[2] 带 cookie 访问 /vip (HTML 模式)"
curl -sS -b /tmp/cookies.txt "http://localhost:3004/vip" -o /tmp/v.html -w "code=%{http_code} size=%{size_download}\\n"
head -c 600 /tmp/v.html
echo ""
echo "[3] RSC fetch (RSC: 1 header)"
curl -sS -b /tmp/cookies.txt \\
  -H "RSC: 1" \\
  -H "Accept: text/x-component" \\
  "http://localhost:3004/vip" -o /tmp/rsc.html -w "code=%{http_code} size=%{size_download}\\n"
head -c 300 /tmp/rsc.html
echo ""
echo "[4] 不带 cookie 访问 /vip (应该 307 → /login)"
curl -sS "http://localhost:3004/vip" -o /tmp/v0.html -w "code=%{http_code} size=%{size_download}\\n"
head -c 100 /tmp/v0.html
`;

fs.writeFileSync('C:\\temp_zzmm\\vip-test.sh', script);
execSync(`"${PSCP}" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\vip-test.sh ${NAS_USER}@${NAS_HOST}:/tmp/vip-test.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/vip-test.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
