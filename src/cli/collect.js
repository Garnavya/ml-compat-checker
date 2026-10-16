const fs = require('fs');
const { collect } = require('../collector');

const outIdx = process.argv.indexOf('--out');
const outFile = outIdx !== -1 ? process.argv[outIdx + 1] : null;

collect()
  .then((spec) => {
    const json = JSON.stringify(spec, null, 2);
    if (outFile) {
      fs.writeFileSync(outFile, json, 'utf8');
      console.log(`Wrote ${outFile}`);
    } else {
      console.log(json);
    }
  })
  .catch((err) => {
    console.error('Collection failed:', err);
    process.exit(1);
  });