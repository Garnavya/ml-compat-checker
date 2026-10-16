const fs = require('fs');
const { evaluateAll } = require('../scoring/engine');

const file = process.argv[2] || 'spec.json';
const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
const { tasks, notes } = evaluateAll(spec);

const label = { good: 'GOOD', limited: 'LIMITED', not_recommended: 'NOT RECOMMENDED' };

for (const t of tasks) {
  console.log(`\n${t.name}`);
  console.log(`  Verdict:    ${label[t.verdict]}`);
  if (t.bottleneck) console.log(`  Bottleneck: ${t.bottleneck}`);
  if (t.estimate) console.log(`  Estimate:   ${t.estimate}`);
  if (t.speed_estimate) console.log(`  Speed:      ${t.speed_estimate}`);
  if (t.software_status) console.log(`  Software:   ${t.software_status}`);
  t.reasons.forEach((r) => console.log(`  - ${r}`));
}

if (notes.length) {
  console.log('\nNotes');
  notes.forEach((n) => console.log(`  - ${n}`));
}