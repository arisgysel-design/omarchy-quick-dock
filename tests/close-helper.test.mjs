// Runs bin/quick-dock-close against stub `hyprctl` and `omarchy-shell`
// commands, so no real window or shell is touched.
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const helper = fileURLToPath(new URL('../bin/quick-dock-close', import.meta.url));
const script = readFileSync(helper, 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const qml = readFileSync(new URL('../QuickDock.qml', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

// Real `hyprctl layers -j` is pretty-printed; JSON.stringify(_, null, 4) matches its shape.
const layers = (namespaces, pad = 0) => JSON.stringify({
  'eDP-1': {
    levels: {
      0: [{ namespace: 'omarchy-background' }],
      3: [...namespaces.map(namespace => ({ namespace })), ...Array.from({ length: pad }, (_, i) => ({ namespace: `filler-${i}` }))]
    }
  }
}, null, 4);

const CLOSE_WINDOW = 'hyprctl dispatch hl.dsp.window.close()';

// Stubs log each call as one line to calls.log.
function run(t, { layersOutput = layers([]), layersExit = 0, slowLayers = false, shellHangs = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'quick-dock-close-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'calls.log');
  writeFileSync(join(dir, 'layers.json'), layersOutput);

  const stub = (name, body) => {
    const path = join(dir, name);
    writeFileSync(path, `#!/usr/bin/env bash\necho "${name} $*" >> '${log}'\n${body}\n`);
    chmodSync(path, 0o755);
  };
  const file = join(dir, 'layers.json');
  // A slow writer is still writing after a reader such as `grep -q` has
  // exited; `exec cat` then fails on the closed pipe, as hyprctl would.
  const printLayers = layersExit !== 0 ? `cat '${file}'; exit ${layersExit}`
    : slowLayers ? `head -c 4096 '${file}'; sleep 0.3; exec cat '${file}'`
    : `exec cat '${file}'`;
  stub('hyprctl', `[[ $1 == layers ]] && { ${printLayers}; }\nexit 0`);
  stub('omarchy-shell', shellHangs ? 'sleep 30' : 'exit 0');

  const started = Date.now();
  const result = spawnSync(helper, [], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: 'utf8',
    timeout: 15000
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  return { status: result.status, error: result.error, calls, elapsedMs: Date.now() - started };
}

// --- consistency ------------------------------------------------------------

test('the helper is executable, as the README keybinding requires', () => {
  assert.ok(statSync(helper).mode & 0o111, 'bin/quick-dock-close lost its exec bit');
});

test('the helper, manifest, QML and README agree on the plugin id and namespace', () => {
  assert.equal(script.match(/PLUGIN_ID="([^"]+)"/)[1], manifest.id);
  assert.equal(script.match(/LAYER_NAMESPACE="([^"]+)"/)[1], qml.match(/layerNamespace: "([^"]+)"/)[1]);
  assert.ok(readme.includes(`omarchy-shell shell toggle ${manifest.id}`));
  assert.ok(readme.includes(`plugins/${manifest.id}/bin/quick-dock-close`));
});

// --- behavior ---------------------------------------------------------------

test('an open dock is hidden and no window is closed', t => {
  const { status, error, calls } = run(t, { layersOutput: layers(['quick-dock']) });
  assert.ifError(error);
  assert.equal(status, 0);
  assert.deepEqual(calls, ['hyprctl layers -j', `omarchy-shell shell hide ${manifest.id}`]);
});

test('an open dock is detected even when hyprctl is still writing after the match', t => {
  const { calls } = run(t, { layersOutput: layers(['quick-dock'], 5000), slowLayers: true });
  assert.equal(calls.at(-1), `omarchy-shell shell hide ${manifest.id}`);
});

test('without the dock the active window is closed', t => {
  const { status, calls } = run(t, { layersOutput: layers(['omarchy-bar']) });
  assert.equal(status, 0);
  assert.deepEqual(calls, ['hyprctl layers -j', CLOSE_WINDOW]);
});

test('a similar namespace does not count as the dock', t => {
  const { calls } = run(t, { layersOutput: layers(['quick-dock-preview', 'my-quick-dock']) });
  assert.equal(calls.at(-1), CLOSE_WINDOW);
});

test('unreadable layer output still closes the window', t => {
  for (const layersOutput of ['', 'not json', '[]']) {
    const { calls } = run(t, { layersOutput });
    assert.equal(calls.at(-1), CLOSE_WINDOW, `for ${JSON.stringify(layersOutput)}`);
  }
});

test('a failing layers query still closes the window', t => {
  const { calls } = run(t, { layersOutput: layers(['quick-dock']), layersExit: 1 });
  assert.equal(calls.at(-1), CLOSE_WINDOW);
});

test('a hung shell cannot block the key, and the window under the dock survives', t => {
  const { status, calls, elapsedMs } = run(t, { layersOutput: layers(['quick-dock']), shellHangs: true });
  assert.equal(status, 0);
  assert.ok(elapsedMs < 5000, `took ${elapsedMs} ms`);
  assert.ok(!calls.includes(CLOSE_WINDOW));
});
