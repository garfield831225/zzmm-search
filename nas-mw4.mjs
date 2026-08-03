// 进程在跑什么中间件
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `set -e
PID=$(systemctl show zzmm-search -p MainPID --value)
echo "PID=$PID"
echo "[1] 进程打开了哪些 .next 文件"
ls -la /proc/$PID/maps 2>/dev/null | head -3
ls -la /proc/$PID/cwd/.next/server/src/middleware.js 2>&1
echo "[2] middleware.js mtime"
stat -c '%y %s' /data_s001/docker/zzmm-search/.next/standalone/.next/server/src/middleware.js 2>&1
echo "[3] 进程 fd (找 middleware)"
ls -la /proc/$PID/fd 2>&1 | grep -i middleware | head -5
echo "[4] 中间件 mtime + 现在"
date
echo "[5] 看 BUILD_ID"
cat /data_s001/docker/zzmm-search/.next/BUILD_ID
echo "[6] systemd 启动时间"
systemctl show zzmm-search -p ActiveEnterTimestamp
`;

fs.writeFileSync('C:\\temp_zzmm\\mw4.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\mw4.sh ${NAS_USER}@${NAS_HOST}:/tmp/mw4.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/mw4.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
