// 看 NAS 上 /vip 中间件 build 时间戳
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `set -e
echo "[1] 中间件 build 文件 mtime"
ls -la /data_s001/docker/zzmm-search/.next/standalone/.next/server/middleware*.js 2>&1
echo "[2] middleware.js 大小"
stat /data_s001/docker/zzmm-search/.next/standalone/.next/server/middleware.js 2>&1 | head -3
echo "[3] 中间件代码: 找 vip 鉴权代码"
grep -c "VIP_ALLOWED_GROUPS" /data_s001/docker/zzmm-search/.next/standalone/.next/server/middleware.js 2>&1
echo "[4] Build ID"
cat /data_s001/docker/zzmm-search/.next/BUILD_ID
echo "[5] systemd 状态"
systemctl status zzmm-search.service --no-pager | head -5
`;

fs.writeFileSync('C:\\temp_zzmm\\build-check.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\build-check.sh ${NAS_USER}@${NAS_HOST}:/tmp/build-check.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/build-check.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
