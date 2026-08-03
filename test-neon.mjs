import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://x:y@z.w/db');

// Test 1: Raw string + values array
const q1 = sql('SELECT * FROM x WHERE y = $1 AND z = $2', ['val1', 'val2']);
console.log('raw string q1:', JSON.stringify(q1?.parameterizedQuery, null, 2));

// Test 2: Tagged template literal (normal)
const q2 = sql`SELECT * FROM x WHERE y = ${'val1'}`;
console.log('template q2:', JSON.stringify(q2?.parameterizedQuery, null, 2));

// Test 3: Mix - template + raw string in one query (does it work?)
// Probably need to do template tag with values as `${value}` placeholders
