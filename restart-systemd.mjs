// 重启 + 看日志
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `echo "[1] 重启"
systemctl restart zzmm-search.service
sleep 10
systemctl is-active zzmm-search.service
echo "[2] 端口"
ss -tlnp 2>&1 | grep ":3004 "
echo "[3] /vip"
curl -sS -o /tmp/v.html -w "vip code=%{http_code} size=%{size_download}\\n" http://localhost:3004/vip
echo "[4] /api/catalog?section=tg"
curl -sS "http://localhost:3004/api/catalog?section=tg&pageSize=2&zone=library" | head -c 500
echo ""
echo "[5] 日志"
tail -15 /tmp/zzmm-3004.log
`;
fs.writeFileSync('C:\\temp_zzmm\\restart-remote.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\restart-remote.sh ${NAS_USER}@${NAS_HOST}:/tmp/restart-remote.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/restart-remote.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 90000 });
} catch (e) {
  console.log('ERR:', e.message.slice(0, 200));
}
