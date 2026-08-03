// 手动启动看错误
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `echo "[1] 完整日志"
cat /tmp/zzmm-3004.log 2>&1 | tail -30
echo "[2] .next/standalone 内容"
ls /data_s001/docker/zzmm-search/.next/standalone/ 2>&1 | head -20
echo "[3] 看 server.js 头部 (require 啥)"
head -30 /data_s001/docker/zzmm-search/.next/standalone/server.js
echo "[4] node_modules 情况"
ls /data_s001/docker/zzmm-search/.next/standalone/node_modules 2>&1 | head -10 || echo "无 node_modules"
ls /data_s001/docker/zzmm-search/node_modules 2>&1 | head -5
echo "[5] 直接跑 server.js 看错"
cd /data_s001/docker/zzmm-search/.next/standalone
PORT=3004 HOSTNAME=0.0.0.0 timeout 5 /usr/local/bin/node server.js 2>&1 | head -30
`;
fs.writeFileSync('C:\\temp_zzmm\\debug-remote.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\debug-remote.sh ${NAS_USER}@${NAS_HOST}:/tmp/debug-remote.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/debug-remote.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 90000 });
} catch (e) {
  console.log('ERR:', e.message.slice(0, 200));
}
