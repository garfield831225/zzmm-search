// 看 NAS 实际 build id
import { execSync } from 'child_process';
import * as fs from 'fs';

const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';
const script = 'set -e\n' +
  'echo "[1] NAS BUILD_ID"\n' +
  'cat /data_s001/docker/zzmm-search/.next/BUILD_ID\n' +
  'echo "[2] standalone BUILD_ID"\n' +
  'cat /data_s001/docker/zzmm-search/.next/standalone/.next/BUILD_ID\n' +
  'echo "[3] vip page chunk mtime"\n' +
  'stat -c "%y" /data_s001/docker/zzmm-search/.next/standalone/.next/static/chunks/app/vip/page-*.js 2>/dev/null | head -1\n' +
  'echo "[4] restart systemd"\n' +
  'systemctl restart zzmm-search.service\n' +
  'sleep 5\n' +
  'systemctl is-active zzmm-search.service\n' +
  'echo "[5] curl /vip/[id] (1, 任意已有 m3u8 的资源)"\n' +
  'curl -sS -o /tmp/v.html -w "code=%{http_code} size=%{size_download}\\n" "http://localhost:3004/vip/1"\n' +
  'head -c 200 /tmp/v.html\n' +
  '\n';

fs.writeFileSync('C:\\temp_zzmm\\chk.sh', script);
execSync('"C:\\Program Files\\PuTTY\\pscp.exe" -P 10000 -l 13381064903 -pw @G831225dd -hostkey "' + hostkey + '" C:\\temp_zzmm\\chk.sh 13381064903@223.72.106.229:/tmp/chk.sh', { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', '10000', '-l', '13381064903', '-pw', '@G831225dd', '-hostkey', hostkey, '-no-antispoof', '223.72.106.229', "echo '@G831225dd' | sudo -S -p '' bash /tmp/chk.sh"];
try {
  execSync('"' + PLINK + '" ' + args.map(a => '"' + a + '"').join(' '), { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
