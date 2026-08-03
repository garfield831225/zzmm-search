// NAS 端 .next/static 看
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PSCP = 'C:\\Program Files\\PuTTY\\pscp.exe';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `echo "[1] .next/static/chunks"
ls /data_s001/docker/zzmm-search/.next/static/chunks/ 2>&1 | head -10
echo "[2] 找 vip page chunk"
find /data_s001/docker/zzmm-search/.next/static -name "*vip*" 2>/dev/null | head -10
echo "[3] /_next/static/ 直接 curl"
curl -sS -o /tmp/s.html -w "code=%{http_code} size=%{size_download}\\n" "http://localhost:3004/_next/static/chunks/app/vip/page.js"
echo "[4] /vip 完整 HTML 头部"
curl -sS -L -o /tmp/v.html -w "code=%{http_code} size=%{size_download}\\n" -H "Cookie: zzmm_token=fake" "http://localhost:3004/vip"
head -c 800 /tmp/v.html
echo ""
echo "[5] /login 后状态"
curl -sS -o /tmp/l.html -w "code=%{http_code} size=%{size_download}\\n" "http://localhost:3004/login"
head -c 200 /tmp/l.html
`;
fs.writeFileSync('C:\\temp_zzmm\\nas-static-check.sh', script);
execSync(`"${PSCP}" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\nas-static-check.sh ${NAS_USER}@${NAS_HOST}:/tmp/nas-static-check.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/nas-static-check.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
