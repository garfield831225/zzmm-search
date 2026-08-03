// 修复: 直接 cp .next/standalone/node_modules 进 NAS
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const PSCP = 'C:\\Program Files\\PuTTY\\pscp.exe';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';

console.log('▶ 1. 打包本地 .next/standalone/node_modules (用 7z, 大文件分卷)');
const tarPath = 'C:\\temp_zzmm\\standalone-nm.tar.gz';
execSync(`powershell -Command "cd C:\\\\temp_zzmm\\\\zzmm-search\\\\.next\\\\standalone; tar -czf C:\\\\temp_zzmm\\\\standalone-nm.tar.gz node_modules"`, { encoding: 'utf-8', stdio: 'inherit', shell: 'powershell' });
const stat = fs.statSync(tarPath);
console.log('  size:', (stat.size / 1024 / 1024).toFixed(2), 'MB');

console.log('\n▶ 2. 传 /tmp/');
execSync(`"${PSCP}" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" ${tarPath} ${NAS_USER}@${NAS_HOST}:/tmp/standalone-nm.tar.gz`, { encoding: 'utf-8', stdio: 'inherit', timeout: 180000 });

console.log('\n▶ 3. NAS 解压 + 重启');
const script = `set -e
cd /data_s001/docker/zzmm-search/.next/standalone
echo "[1] 删旧 (如有)"
rm -rf node_modules
echo "[2] 解压"
tar -xzf /tmp/standalone-nm.tar.gz
ls node_modules/ | head -10
echo "[3] 重启"
systemctl restart zzmm-search.service
sleep 8
systemctl is-active zzmm-search.service
echo "[4] 健康检查"
ss -tlnp 2>&1 | grep ":3004 "
curl -sS -o /tmp/v.html -w "vip code=%{http_code}\\n" http://localhost:3004/vip
curl -sS "http://localhost:3004/api/catalog?section=tg&pageSize=2&zone=library" | head -c 500
echo ""
`;
fs.writeFileSync('C:\\temp_zzmm\\fix-standalone.sh', script);
execSync(`"${PSCP}" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\fix-standalone.sh ${NAS_USER}@${NAS_HOST}:/tmp/fix-standalone.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/fix-standalone.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 180000 });
} catch (e) {
  console.log('ERR:', e.message.slice(0, 200));
}
