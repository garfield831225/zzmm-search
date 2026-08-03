// 看 NAS .next/standalone 内容
import { execSync } from 'child_process';
import * as fs from 'fs';
const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `echo "[1] ls .next/standalone"
ls -la /data_s001/docker/zzmm-search/.next/standalone/
echo "[2] ls .next/standalone/node_modules"
ls /data_s001/docker/zzmm-search/.next/standalone/node_modules/ 2>&1 | head -20
echo "[3] find next package"
find /data_s001/docker/zzmm-search -name "package.json" -path "*/next/*" 2>/dev/null | head -3
echo "[4] /data_s001/docker/zzmm-search 顶层"
ls /data_s001/docker/zzmm-search/ | head -30
echo "[5] 完整 stat"
stat /data_s001/docker/zzmm-search/.next/standalone/server.js 2>&1 | head -3
echo "[6] trymv"
ls /data_s001/docker/zzmm-search/.next/standalone/.next 2>&1 | head -5
`;
fs.writeFileSync('C:\\temp_zzmm\\debug2.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\debug2.sh ${NAS_USER}@${NAS_HOST}:/tmp/debug2.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/debug2.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) {}
