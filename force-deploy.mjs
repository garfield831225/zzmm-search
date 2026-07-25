// 强制重部署: 1) rebuild 2) 重新打包 3) 传 4) 解压 5) 重启
import { execSync } from 'child_process';
import * as fs from 'fs';

const NAS_HOST = '223.72.106.229';
const NAS_PORT = '10000';
const NAS_USER = '13381064903';
const NAS_PASS = '@G831225dd';
const NAS_PROJECT_DIR = '/data_s001/docker/zzmm-search';
const PSCP = 'C:\\Program Files\\PuTTY\\pscp.exe';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';
const REMOTE_TMP = '/tmp/zzmm-search-full.tar.gz';

console.log('▶ 1. 重新 build + 打包');
execSync('powershell -Command "cd C:\\\\temp_zzmm\\\\zzmm-search\\\\.next\\\\standalone; tar -czf C:\\\\temp_zzmm\\\\standalone-nm.tar.gz node_modules" 2>$null', { encoding: 'utf-8', stdio: 'inherit', shell: 'powershell' });
// 先清老 tar
try { fs.unlinkSync('C:\\temp_zzmm\\zzmm-search-full.tar.gz'); } catch {}
execSync('powershell -Command "cd C:\\\\temp_zzmm\\\\zzmm-search; npm run build 2>&1 | Select-Object -Last 3; tar -czf ..\\\\zzmm-search-full.tar.gz --exclude=./node_modules --exclude=./.next/standalone/node_modules --exclude=.git --exclude=./.mavis ."', { encoding: 'utf-8', stdio: 'inherit', shell: 'powershell', timeout: 180000 });
console.log('   tar size:', (fs.statSync('C:\\temp_zzmm\\zzmm-search-full.tar.gz').size / 1024 / 1024).toFixed(2), 'MB');
console.log('   本地 BUILD_ID:', fs.readFileSync('C:\\temp_zzmm\\zzmm-search\\.next\\BUILD_ID', 'utf-8').trim());

console.log('\n▶ 2. 传主 tar');
execSync(`"${PSCP}" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\zzmm-search-full.tar.gz ${NAS_USER}@${NAS_HOST}:${REMOTE_TMP}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 180000 });

console.log('\n▶ 3. 传 standalone-nm.tar.gz');
execSync(`"${PSCP}" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\standalone-nm.tar.gz ${NAS_USER}@${NAS_HOST}:/tmp/standalone-nm.tar.gz`, { encoding: 'utf-8', stdio: 'inherit', timeout: 120000 });

const script = `set -e
echo "[A] 备份 + 清空 + 重解压"
mv ${NAS_PROJECT_DIR} ${NAS_PROJECT_DIR}.bak.$(date +%H%M%S) 2>/dev/null || true
mkdir -p ${NAS_PROJECT_DIR}
cd ${NAS_PROJECT_DIR}
tar -xzf ${REMOTE_TMP}
mkdir -p .next/standalone
tar -xzf /tmp/standalone-nm.tar.gz -C .next/standalone/
echo "[B] BUILD_ID"
cat .next/BUILD_ID
ls -la .next/standalone/server.js
echo "[C] 中间件 mtime"
stat -c '%y' .next/standalone/.next/server/src/middleware.js
echo "[D] 中间件代码: 找 /vip 鉴权"
grep -c "VIP_ALLOWED_GROUPS" .next/standalone/.next/server/src/middleware.js || echo "0 (应该 0 = 修复成功)"
echo "[E] 重启"
systemctl restart zzmm-search.service
sleep 8
systemctl is-active zzmm-search.service
echo "[F] 测试 /vip"
curl -sS -o /tmp/v.html -w "code=%{http_code} size=%{size_download}\\n" "http://localhost:3004/vip"
head -c 200 /tmp/v.html
echo ""
`;

fs.writeFileSync('C:\\temp_zzmm\\force-deploy.sh', script);
execSync(`"${PSCP}" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\force-deploy.sh ${NAS_USER}@${NAS_HOST}:/tmp/force-deploy.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, `echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/force-deploy.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 120000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
