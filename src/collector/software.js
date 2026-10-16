const path = require('path');
const { run } = require('./utils');

async function findPython() {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const out = await run(cmd, ['--version']);
    if (out && /Python\s+3/i.test(out)) return cmd;
  }
  return null;
}

async function getSoftware() {
  const notes = [];
  const software = {
    python: null,
    torch_installed: null, // null = unknown, false = Python found but no torch
    torch: null,
    torch_cuda: null,
    torch_cuda_available: null,
    torch_arch_list: null,
    cuda_toolkit: null,
  };

  const py = await findPython();
  if (!py) {
    notes.push('no Python 3 found on PATH');
  } else {
    // importing torch can take several seconds, so allow a generous timeout
    const out = await run(py, [path.join(__dirname, 'probe_torch.py')], 60000);
    if (!out) {
      notes.push('python probe failed or timed out');
    } else {
      try {
        const r = JSON.parse(out.split(/\r?\n/).pop());
        software.python = r.python ?? null;
        software.torch_installed = r.torch !== null && r.torch !== undefined;
        software.torch = r.torch ?? null;
        software.torch_cuda = r.torch_cuda ?? null;
        software.torch_cuda_available = r.cuda_available ?? null;
        software.torch_arch_list = r.arch_list ?? null;
        if (r.torch_error) notes.push(`torch import failed: ${r.torch_error}`);
      } catch {
        notes.push('python probe returned unreadable output');
      }
    }
  }

  const nvcc = await run('nvcc', ['--version']);
  const m = nvcc && nvcc.match(/release\s+([\d.]+)/i);
  software.cuda_toolkit = m ? m[1] : null;

  return { software, notes };
}

module.exports = { getSoftware };