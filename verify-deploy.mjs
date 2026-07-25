// 部署 + 强制重新 build standalone
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
const REMOTE_TMP = '/tmp/zzmm-search.tar.gz';

function plinkRun(cmd) {
  const args = ['-ssh', '-P', NAS_PORT, '-l', NAS_USER, '-pw', NAS_PASS, '-hostkey', hostkey, '-no-antispoof', NAS_HOST, cmd];
  console.log(`  [NAS] ${cmd.substring(0, 100).replace(/\n/g, ' ')}`);
  try {
    return execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 120000 });
  } catch (e) {
    return null;
  }
}

const script = `set -e
echo "[1] 删除旧 .next/standalone 让 standalone 重新 build"
rm -rf ${NAS_PROJECT_DIR}/.next/standalone
echo "[2] 看 .next 还有什么"
ls -la ${NAS_PROJECT_DIR}/.next/ 2>&1 | head -10
echo "[3] systemctl 状态"
systemctl status zzmm-search.service --no-pager | head -10
echo "[4] 直接 curl NAS 3004 看 API"
curl -sS "http://localhost:3004/api/catalog?section=tg&pageSize=2&zone=library" | head -c 600
echo ""
`;

fs.writeFileSync('C:\\temp_zzmm\\verify-remote.sh', script);
execSync(`"${PSCP}" -P ${NAS_PORT} -l ${NAS_USER} -pw ${NAS_PASS} -hostkey "${hostkey}" C:\\temp_zzmm\\verify-remote.sh ${NAS_USER}@${NAS_HOST}:/tmp/verify-remote.sh`, { encoding: 'utf-8', stdio: 'inherit' });
plinkRun(`echo '${NAS_PASS}' | sudo -S -p '' bash /tmp/verify-remote.sh`);
