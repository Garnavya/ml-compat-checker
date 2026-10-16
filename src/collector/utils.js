const { execFile } = require('child_process');

// Runs a command and resolves to its output, or null if it fails.
// Never throws, so one missing tool can't crash the whole collection.
function run(cmd, args = [], timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

module.exports = { run };