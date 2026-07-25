// 看 NAS 上的 BUILD_ID
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `set -e
echo "[1] 顶层 .next/BUILD_ID"
cat /data_s001/docker/zzmm-search/.next/BUILD_ID
echo "[2] standalone .next/BUILD_ID"
cat /data_s001/docker/zzmm-search/.next/standalone/.next/BUILD_ID 2>&1
echo "[3] standalone middleware.js mtime + size"
stat -c '%y %s' /data_s001/docker/zzmm-search/.next/standalone/.next/server/src/middleware.js
echo "[4] 进程 PID + 启动时间"
systemctl show zzmm-search -p MainPID,ActiveEnterTimestamp
echo "[5] 强制 systemctl restart 后 /vip 测试"
systemctl restart zzmm-search.service
sleep 5
curl -sS -o /tmp/v.html -w "vip code=%{http_code} size=%{size_download}\\n" "http://localhost:3004/vip"
head -c 300 /tmp/v.html
echo ""
echo "[6] 不带 cookie 测"
curl -sS -o /tmp/v2.html -w "vip(no cookie) code=%{http_code} size=%{size_download}\\n" "http://localhost:3004/vip"
head -c 100 /tmp/v2.html
`;

fs.writeFileSync('C:\\temp_zzmm\\mw5.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\mw5.sh ${NAS_USER}@${NAS_HOST}:/tmp/mw5.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/mw5.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
