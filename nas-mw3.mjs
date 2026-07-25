// 查中间件内容 + systemd 实际 PID
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `set -e
echo "[1] 中间件含 vip 字符串"
grep -n "/vip" /data_s001/docker/zzmm-search/.next/server/src/middleware.js | head -5
echo "[2] systemd 实际 PID 和命令行"
PID=$(systemctl show zzmm-search -p MainPID --value)
echo "PID=$PID"
cat /proc/$PID/cmdline | tr '\\0' ' '
echo ""
echo "[3] 进程 cwd"
ls -la /proc/$PID/cwd 2>&1
echo "[4] systemd service 文件"
cat /etc/systemd/system/zzmm-search.service
`;

fs.writeFileSync('C:\\temp_zzmm\\mw3.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\mw3.sh ${NAS_USER}@${NAS_HOST}:/tmp/mw3.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/mw3.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
