// 找 NAS 上 CSS 实际位置
import { execSync } from 'child_process';
import * as fs from 'fs';

const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';
const script = 'set -e\n' +
  'echo "[1] 全部 CSS 文件"\n' +
  'find /data_s001/docker/zzmm-search -name "*.css" -type f 2>/dev/null\n' +
  'echo "[2] /vip page 实际位置 + 文件名"\n' +
  'ls -la /data_s001/docker/zzmm-search/.next/static/chunks/app/vip/ 2>&1\n' +
  'echo "[3] 全部 vip 相关文件"\n' +
  'find /data_s001/docker/zzmm-search -name "*vip*" 2>/dev/null | head -20\n' +
  'echo "[4] 直接看 _next/static 内容"\n' +
  'ls /data_s001/docker/zzmm-search/.next/static/ 2>&1\n' +
  'echo "[5] 顶层 .next/static/chunks 数量"\n' +
  'ls /data_s001/docker/zzmm-search/.next/static/chunks/ 2>&1 | wc -l\n' +
  'ls /data_s001/docker/zzmm-search/.next/static/chunks/app/ 2>&1 | head -10\n' +
  'echo "[6] standalone 目录 _next/static"\n' +
  'ls /data_s001/docker/zzmm-search/.next/standalone/.next/static/ 2>&1 | head -10\n';

fs.writeFileSync('C:\\temp_zzmm\\css3.sh', script);
execSync('"C:\\Program Files\\PuTTY\\pscp.exe" -P 10000 -l 13381064903 -pw @G831225dd -hostkey "' + hostkey + '" C:\\temp_zzmm\\css3.sh 13381064903@223.72.106.229:/tmp/css3.sh', { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', '10000', '-l', '13381064903', '-pw', '@G831225dd', '-hostkey', hostkey, '-no-antispoof', '223.72.106.229', "echo '@G831225dd' | sudo -S -p '' bash /tmp/css3.sh"];
try {
  execSync('"' + PLINK + '" ' + args.map(a => '"' + a + '"').join(' '), { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
