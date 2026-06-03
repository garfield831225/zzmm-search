const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath).split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && !process.env[key.trim()]) process.env[key.trim()] = vals.join('=').trim();
  });
}

const payload = JSON.stringify({
  gitSource: {
    repo: 'garfield831225/zzmm-search',
    ref: 'fix/reset-yuancategory',
    type: 'github'
  }
});

const teamId = process.env.VERCEL_TEAM_ID || 'team_DlMKN8uIThqCJLdM9aJyR1iB';
const token = process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN;

console.log('Team ID:', teamId);
console.log('Token exists:', !!token);

const options = {
  hostname: 'api.vercel.com',
  path: `/v13/deployments?teamId=${teamId}`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const json = JSON.parse(data);
      console.log('URL:', json.url || json.id || json.message);
    } catch(e) { console.log('Response:', data); }
  });
});
req.on('error', e => console.error(e));
req.write(payload);
req.end();
