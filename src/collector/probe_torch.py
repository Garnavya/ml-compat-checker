import importlib.util
import json
import sys

result = {
    "python": sys.version.split()[0],
    "executable": sys.executable,
    "torch_found": False,
    "torch": None,
}

# find_spec is instant and doesn't import torch, so "installed" and "importable"
# are reported separately.
if importlib.util.find_spec("torch") is not None:
    result["torch_found"] = True
    try:
        import torch

        result["torch"] = torch.__version__
        result["torch_cuda"] = torch.version.cuda
        result["cuda_available"] = torch.cuda.is_available()
        result["arch_list"] = torch.cuda.get_arch_list()
    except Exception as e:
        result["torch_error"] = str(e)[:200]

print(json.dumps(result))