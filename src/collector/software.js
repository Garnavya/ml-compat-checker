const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./utils');

const PROBE = path.join(__dirname, 'probe_torch.py');
const MAX_CANDIDATES = 8;

// Replace the home folder with "~" so the spec never contains a username.
function redactHome(p, home = os.homedir()) {
  if (!p || !home) return p ?? null;
  return p.toLowerCase().startsWith(home.toLowerCase()) ? `~${p.slice(home.length)}` : p;
}

// Output of `py -0p` (Windows Python launcher): one installed Python per line.
function parseLauncherList(text = '') {
  const paths = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/([A-Za-z]:\\.*?pythonw?\.exe)\s*$/i);
    if (m) paths.push(m[1].trim());
  }
  return paths;
}

// ~/.conda/environments.txt lists one environment folder per line.
function parseCondaEnvFile(text = '') {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

const interpreterIn = (prefix) =>
  process.platform === 'win32' ? path.join(prefix, 'python.exe') : path.join(prefix, 'bin', 'python');

async function candidateInterpreters(userPaths = []) {
  const list = [...userPaths];

  for (const prefix of [process.env.VIRTUAL_ENV, process.env.CONDA_PREFIX]) {
    if (prefix) list.push(interpreterIn(prefix));
  }

  list.push(...(process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']));

  if (process.platform === 'win32') {
    const out = await run('py', ['-0p']);
    list.push(...parseLauncherList(out || ''));
  }

  try {
    const text = fs.readFileSync(path.join(os.homedir(), '.conda', 'environments.txt'), 'utf8');
    list.push(...parseCondaEnvFile(text).map(interpreterIn));
  } catch {
    /* no conda environments file */
  }

  const seen = new Set();
  return list
    .filter((p) => {
      const key = p.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CANDIDATES);
}

async function probe(cmd) {
  const out = await run(cmd, [PROBE], 60000); // importing torch can take a while
  if (!out) return null; // not runnable (e.g. the Microsoft Store python stub)
  try {
    return JSON.parse(out.split(/\r?\n/).pop());
  } catch {
    return null;
  }
}

// Best environment: working CUDA PyTorch, then working PyTorch, then broken PyTorch, then any Python.
function pickBest(envs) {
  return (
    envs.find((e) => e.torch_found && e.cuda_available) ||
    envs.find((e) => e.torch_found && !e.torch_error) ||
    envs.find((e) => e.torch_found) ||
    envs[0] ||
    null
  );
}

async function getSoftware({ pythonPaths = [] } = {}) {
  const notes = [];
  const envs = [];
  const seenExe = new Set();

  for (const cmd of await candidateInterpreters(pythonPaths)) {
    if (seenExe.has(cmd.toLowerCase())) continue; // already probed this interpreter
    const r = await probe(cmd);
    if (!r) continue;
    const key = String(r.executable).toLowerCase();
    if (seenExe.has(key)) continue;
    seenExe.add(key);
    envs.push(r);
    if (r.torch_found && r.cuda_available) break; // a working GPU setup is enough
  }

  const best = pickBest(envs);
  if (!best) notes.push('no working Python 3 found');
  if (best?.torch_error) notes.push(`torch import failed: ${best.torch_error}`);

  const nvcc = await run('nvcc', ['--version']);
  const m = nvcc && nvcc.match(/release\s+([\d.]+)/i);

  return {
    software: {
      python: best?.python ?? null,
      python_path: redactHome(best?.executable),
      torch_installed: best ? best.torch_found : null,
      torch: best?.torch ?? null,
      torch_cuda: best?.torch_cuda ?? null,
      torch_cuda_available: best?.cuda_available ?? null,
      torch_arch_list: best?.arch_list ?? null,
      torch_error: best?.torch_error ?? null,
      cuda_toolkit: m ? m[1] : null,
      environments: envs.map((e) => ({
        python: e.python,
        path: redactHome(e.executable),
        torch_found: e.torch_found,
        torch: e.torch ?? null,
        cuda_available: e.cuda_available ?? null,
        error: e.torch_error ?? null,
      })),
    },
    notes,
  };
}

module.exports = { getSoftware, parseLauncherList, parseCondaEnvFile, redactHome };