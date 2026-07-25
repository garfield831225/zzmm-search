// 找 middleware.js
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `set -e
echo "[1] 找 middleware.js"
find /data_s001/docker/zzmm-search -name "middleware.js" 2>/dev/null
echo "[2] 顶层 .next/server/middleware.js 内容"
ls -la /data_s001/docker/zzmm-search/.next/server/middleware.js 2>&1
stat /data_s001/docker/zzmm-search/.next/server/middleware.js 2>&1 | head -3
echo "[3] middleware.js 是否含 VIP_ALLOWED_GROUPS"
grep -c "VIP_ALLOWED_GROUPS" /data_s001/docker/zzmm-search/.next/server/middleware.js 2>&1
echo "[4] middleware.js 文件 mtime"
stat -c '%y' /data_s001/docker/zzmm-search/.next/server/middleware.js 2>&1
echo "[5] build id"
cat /data_s001/docker/zzmm-search/.next/BUILD_ID
`;

fs.writeFileSync('C:\\temp_zzmm\\mw.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\mw.sh ${NAS_USER}@${NAS_HOST}:/tmp/mw.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/mw.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
