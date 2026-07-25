// 找 .next/server/src/middleware.js
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `set -e
echo "[1] middleware 实际位置"
ls -la /data_s001/docker/zzmm-search/.next/server/src/middleware.js
stat /data_s001/docker/zzmm-search/.next/server/src/middleware.js | head -7
echo "[2] 中间件是否含 VIP"
grep -c "VIP_ALLOWED_GROUPS" /data_s001/docker/zzmm-search/.next/server/src/middleware.js
echo "[3] 关键代码 (查 /vip 鉴权)"
grep -A 1 "vip" /data_s001/docker/zzmm-search/.next/server/src/middleware.js | head -10
echo "[4] 看 systemd 实际跑的 PID"
systemctl show zzmm-search -p MainPID
echo "[5] systemd 状态"
systemctl status zzmm-search --no-pager | head -8
`;

fs.writeFileSync('C:\\temp_zzmm\\mw2.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\mw2.sh ${NAS_USER}@${NAS_HOST}:/tmp/mw2.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/mw2.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
