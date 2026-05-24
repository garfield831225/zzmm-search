const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = '/app/data/zzmm_data_compact.json';
const HTML_FILE = '/app/data/zzmm_search.html';

let allData = [], categories = [], categoryCounts = {};
try {
    const p = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    allData = p.d || [];
    categories = p.g || [];
    categoryCounts = p.gc || {};
    console.log('Data loaded:', allData.length, 'items');
} catch(e) {
    console.error('Data load error:', e.message);
    process.exit(1);
}

const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (u.pathname === '/api/search') {
        const q = (u.searchParams.get('q') || '').toLowerCase().trim();
        const cat = u.searchParams.get('cat') || '全部';
        const page = parseInt(u.searchParams.get('page') || '1', 10);
        const pageSize = parseInt(u.searchParams.get('pageSize') || '30', 10);

        const filtered = allData.filter(x => {
            if (cat !== '全部' && x.g !== cat) return false;
            if (!q) return true;
            return x.n.toLowerCase().includes(q) ||
                   (x.t && x.t.toLowerCase().includes(q)) ||
                   x.g.toLowerCase().includes(q);
        });

        const items = filtered.slice((page-1)*pageSize, page*pageSize)
            .map(x => ({ name: x.n, size: x.s, link: x.l, code: x.c, type: x.t, category: x.g }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total: filtered.length, page, pageSize, items, categories, categoryCounts }));
        return;
    }

    if (u.pathname === '/api/meta') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total: allData.length, categories, categoryCounts }));
        return;
    }

    if (u.pathname === '/' || u.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(HTML_FILE, 'utf8'));
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Server running at http://0.0.0.0:3000');
});