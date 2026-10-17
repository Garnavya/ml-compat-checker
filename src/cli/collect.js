const fs = require('fs');
const { collect } = require('../collector');

const args = process.argv.slice(2);
// Every value that follows the given flag; the flag may repeat.
const flagValues = (flag) =>
  args.reduce((acc, a, i) => (a === flag && args[i + 1] ? [...acc, args[i + 1]] : acc), []);

const outFile = flagValues('--out')[0] || null;
const pythonPaths = flagValues('--python');

collect({ pythonPaths })
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