const fs = require('fs');
const { run } = require('./utils');

// Windows: ask the OS whether the CPU supports AVX2 (40) and AVX-512F (41).
// Linux: read the flags line from /proc/cpuinfo.
// Returns null for a value we couldn't determine, never a guessed false.
async function getCpuFeatures() {
  if (process.platform === 'win32') {
    const script = [
      `Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int f);' -Name K -Namespace W`,
      `"$([W.K]::IsProcessorFeaturePresent(40)),$([W.K]::IsProcessorFeaturePresent(41))"`,
    ].join('; ');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const out = await run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      15000
    );
    if (!out) return { avx2: null, avx512: null };
    const [a, b] = out.split(',').map((s) => s.trim() === 'True');
    return { avx2: a, avx512: b };
  }

  try {
    const info = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const line = info.split('\n').find((l) => l.startsWith('flags'));
    if (!line) return { avx2: null, avx512: null };
    const flags = line.split(/\s+/);
    return { avx2: flags.includes('avx2'), avx512: flags.includes('avx512f') };
  } catch {
    return { avx2: null, avx512: null };
  }
}

module.exports = { getCpuFeatures };