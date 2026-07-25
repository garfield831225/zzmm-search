// NAS 端看 /vip 路由文件
import { execSync } from 'child_process';
import * as fs from 'fs';
const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

const script = `echo "[1] 源码 src/app/vip"
ls -la /data_s001/docker/zzmm-search/src/app/vip/ 2>&1
echo "[2] build .next/standalone/.next/server/app/vip"
ls -la /data_s001/docker/zzmm-search/.next/standalone/.next/server/app/vip/ 2>&1
echo "[3] build .next/server/app/vip"
ls -la /data_s001/docker/zzmm-search/.next/server/app/vip/ 2>&1
echo "[4] /vip 直接访问"
curl -sS -o /tmp/v.html -w "code=%{http_code} size=%{size_download}\\n" -H "Host: zzmm-search.uk" http://localhost:3004/vip
head -c 400 /tmp/v.html
echo ""
echo "[5] 详细 build id"
cat /data_s001/docker/zzmm-search/.next/BUILD_ID
echo ""
echo "[6] 全部 vip 路由"
find /data_s001/docker/zzmm-search/.next -name "*vip*" -type d 2>/dev/null | head -10
`;
fs.writeFileSync('C:\\temp_zzmm\\nas-vip-check.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\nas-vip-check.sh ${NAS_USER}@${NAS_HOST}:/tmp/nas-vip-check.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/nas-vip-check.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
