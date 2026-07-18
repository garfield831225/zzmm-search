// 调 trigger-match 强制创建 task, 然后循环调 match-task
const TRIGGER = 'https://zzmm-search.cc.cd/api/admin/trigger-match';
const MATCH = 'https://zzmm-search.cc.cd/api/cron/match-task';
const ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInVzZXJfZ3JvdXAiOiJhZG1pbiIsImdyb3VwIjoiYWRtaW4iLCJpYXQiOjE3ODQzNjE4NzUsImV4cCI6MTc4NDk2NjY3NX0.amnM-3IclFXlPlGHNZ1-26jQwVTYfHt0kztOrB5CPQM';

async function trigger() {
  if (!ADMIN_TOKEN) {
    console.log('[err] 没 ADMIN_TOKEN');
    return false;
  }
  const r = await fetch(TRIGGER, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ total: 220000 }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json();
  console.log('[trigger]', d);
  return d;
}

async function match() {
  const r = await fetch(MATCH, { signal: AbortSignal.timeout(55000) });
  const d = await r.json();
  return d;
}

async function stats() {
  const r = await fetch('https://zzmm-search.cc.cd/api/admin/match-stats', { signal: AbortSignal.timeout(10000) });
  return await r.json();
}

console.log('--- 1. trigger 创建 task ---');
await trigger();

console.log('\n--- 2. 循环跑 match-task 端点 (直到 done=true) ---');
let totalIter = 0;
let lastMatched = 0;
let noProgress = 0;
while (true) {
  totalIter++;
  const d = await match();
  if (d.done) {
    console.log(`[iter ${totalIter}] done=true (msg=${d.msg})`);
    break;
  }
  if (d.matched !== undefined) {
    if (d.matched === lastMatched) noProgress++;
    else { noProgress = 0; lastMatched = d.matched; }
  }
  if (totalIter % 20 === 0) {
    const s = await stats();
    console.log(`[iter ${totalIter}] d=`, d, '\n   stats NULL:', s.buckets.find(b => b.bucket === 'NULL')?.cnt);
  } else {
    console.log(`[iter ${totalIter}] d=`, d);
  }
  if (noProgress > 5) {
    console.log('[loop] 5次无进度, break');
    break;
  }
}

console.log('\n--- 3. 最终 stats ---');
console.log(JSON.stringify(await stats(), null, 2));
process.exit(0);
