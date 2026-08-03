// NAS 上验证 /api/vip 是不是返回数据
import { execSync } from 'child_process';
import * as fs from 'fs';

const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';
const hostkey = 'ed25519 256 AAAAC3NzaC1lZDI1NTE5AAAAIB9S7B48xvaF+9GQFg8TOIjBYJWTZFarSuJiJzGNemMB';
const script = `set -e
echo "[1] /api/vip 模拟 (不鉴权)"
curl -sS "http://localhost:3004/api/vip?pageSize=2&sort=smart" -o /tmp/a.json -w "code=%{http_code} size=%{size_download}\\n"
head -c 500 /tmp/a.json
echo ""
echo ""
echo "[2] 看 xx_vip_resources 数量 (DB)"
sudo -u 13381064903 PGPASSWORD=npg_2KcMmEWjnXd3 psql -h ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech -U neondb_owner -d neondb -c "SELECT COUNT(*) FROM xx_vip_resources" 2>&1 | head -5
echo "[3] xx_vip_links 数量"
sudo -u 13381064903 PGPASSWORD=npg_2KcMmEWjnXd3 psql -h ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech -U neondb_owner -d neondb -c "SELECT COUNT(*) FROM xx_vip_links" 2>&1 | head -5
`;

fs.writeFileSync('C:\\temp_zzmm\\vip-api.sh', script);
execSync(`"C:\\Program Files\\PuTTY\\pscp.exe" -P 10000 -l 13381064903 -pw @G831225dd -hostkey "${hostkey}" C:\\temp_zzmm\\vip-api.sh 13381064903@223.72.106.229:/tmp/vip-api.sh`, { encoding: 'utf-8', stdio: 'inherit' });
const args = ['-ssh', '-P', '10000', '-l', '13381064903', '-pw', '@G831225dd', '-hostkey', hostkey, '-no-antispoof', '223.72.106.229', `echo '@G831225dd' | sudo -S -p '' bash /tmp/vip-api.sh`];
try {
  execSync(`"${PLINK}" ${args.map(a => `"${a}"`).join(' ')}`, { encoding: 'utf-8', stdio: 'inherit', timeout: 60000 });
} catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
