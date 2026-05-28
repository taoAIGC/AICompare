const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const pluginSourceDir = path.join(repoRoot, '.hermes', 'plugins', 'ai-compare-hard-router');
const hermesRepoRoot = path.join(process.env.HOME || '', '.hermes', 'hermes-agent');
const hermesPython = path.join(hermesRepoRoot, 'venv', 'bin', 'python');

function copyDirRecursive(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

test('Hermes project plugin loads and registers ai_compare_search', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicompare-hermes-plugin-'));
  const hermesHome = path.join(tempRoot, '.hermes-home');
  const projectRoot = path.join(tempRoot, 'project');
  const pluginTarget = path.join(projectRoot, '.hermes', 'plugins', 'ai-compare-hard-router');
  const runnerTarget = path.join(projectRoot, 'openclaw', 'ai-compare-openclaw-fast.js');
  fs.mkdirSync(projectRoot, { recursive: true });
  copyDirRecursive(pluginSourceDir, pluginTarget);
  fs.mkdirSync(path.dirname(runnerTarget), { recursive: true });
  fs.writeFileSync(runnerTarget, 'console.log("{}");\n');

  const pluginContext = {
    HERMES_HOME: hermesHome,
    HERMES_ENABLE_PROJECT_PLUGINS: 'true',
    PYTHONPATH: hermesRepoRoot,
  };

  const pythonCode = `
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, ${JSON.stringify(hermesRepoRoot)})
os.chdir(${JSON.stringify(projectRoot)})

from hermes_cli.plugins import PluginManager
import importlib.util

mgr = PluginManager()
mgr.discover_and_load()
loaded = mgr._plugins.get("ai-compare-hard-router")
tool_names = sorted(mgr._plugin_tool_names)
tools_path = Path(${JSON.stringify(pluginTarget)}) / "tools.py"
spec = importlib.util.spec_from_file_location("ai_compare_tools", tools_path)
tools_module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(tools_module)
pre_results = mgr.invoke_hook(
    "pre_llm_call",
    session_id="s1",
    user_message="搜索一下 OpenAI",
    conversation_history=[],
    is_first_turn=True,
    model="test-model",
    platform="cli",
)
print(json.dumps({
    "loaded": bool(loaded and loaded.enabled),
    "tool_names": tool_names,
    "hook_count": len(pre_results),
    "hint": pre_results[0]["context"] if pre_results else "",
    "runner_path": str(tools_module.RUNNER_PATH),
}, ensure_ascii=False))
`;

  const result = spawnSync(hermesPython, ['-c', pythonCode], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...pluginContext,
    },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    assert.fail(`python plugin load failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.loaded, true);
  assert.deepEqual(payload.tool_names, ['ai_compare_search']);
  assert.equal(payload.hook_count, 1);
  assert.match(payload.hint, /ai_compare_search/);
  assert.equal(fs.realpathSync(payload.runner_path), fs.realpathSync(runnerTarget));
});
