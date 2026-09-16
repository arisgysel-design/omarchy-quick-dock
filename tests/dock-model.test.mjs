import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const model = vm.createContext({});
vm.runInContext(readFileSync(new URL('../DockModel.js', import.meta.url), 'utf8'), model);

// Values created inside the VM context have a different Object prototype;
// round-trip them so deepEqual compares plain data.
const plain = value => JSON.parse(JSON.stringify(value));
const PLUGIN_ID = 'arisgysel-design.quick-dock';

const readApps = config => plain(model.appsFromShellConfig(
  typeof config === 'string' ? config : JSON.stringify(config), PLUGIN_ID));
const withApps = apps => ({ version: 1, plugins: [{ id: PLUGIN_ID, apps }] });

// Mimics Quickshell's DesktopEntries.byId: exact match first, then a
// case-insensitive match that returns the entry under its real id.
function directory(entries) {
  return id => entries.find(e => e.id === id) ?? entries.find(e => e.id.toLowerCase() === id.toLowerCase()) ?? null;
}
const entry = (id, name = id, icon = id.toLowerCase()) => ({ id, name, icon });
const resolve = (apps, entries) => plain(model.resolveApps(plain(apps), directory(entries)));

// --- configured ids -------------------------------------------------------

test('desktop ids are trimmed and keep a trailing .desktop', () => {
  assert.equal(model.normalizeDesktopId(' org.gnome.Nautilus '), 'org.gnome.Nautilus');
  assert.equal(model.normalizeDesktopId('org.telegram.desktop'), 'org.telegram.desktop');
  assert.equal(model.normalizeDesktopId('slack.desktop'), 'slack.desktop');
});

test('unusable desktop ids are rejected', () => {
  for (const value of ['', '   ', '.desktop', 'apps/slack', '../slack', null, undefined, 42, {}, []])
    assert.equal(model.normalizeDesktopId(value), '', `accepted ${JSON.stringify(value)}`);
});

test('an id ending in .desktop is looked up as written, then without the suffix', () => {
  assert.deepEqual(plain(model.lookupIds('slack')), ['slack']);
  assert.deepEqual(plain(model.lookupIds('slack.desktop')), ['slack.desktop', 'slack']);
  assert.deepEqual(plain(model.lookupIds('org.telegram.desktop')), ['org.telegram.desktop', 'org.telegram']);
});

// --- reading shell.json ---------------------------------------------------

test('apps accept strings and objects with optional name and icon', () => {
  assert.deepEqual(readApps(withApps(['slack', { id: ' Dropbox ', name: ' Files ', icon: '/tmp/dropbox.svg' }])), [
    { id: 'slack', name: '', icon: '' },
    { id: 'Dropbox', name: 'Files', icon: '/tmp/dropbox.svg' }
  ]);
});

test('invalid app entries are skipped without affecting valid ones', () => {
  const apps = readApps(withApps([null, 7, true, [], {}, { name: 'no id' }, { id: 3 }, 'slack', { id: 'x', name: 5 }]));
  assert.deepEqual(apps, [
    { id: 'slack', name: '', icon: '' },
    { id: 'x', name: '', icon: '' }
  ]);
});

test('apps are read from the first entry with this plugin id only', () => {
  const config = {
    version: 1,
    plugins: [{ id: 'someone.else', apps: ['wrong'] }, { id: PLUGIN_ID, apps: ['slack'] }, { id: PLUGIN_ID, apps: ['second'] }],
    bar: { layout: { left: [{ id: PLUGIN_ID, apps: ['also-wrong'] }] } }
  };
  assert.deepEqual(readApps(config), [{ id: 'slack', name: '', icon: '' }]);
});

test('an entry created by `omarchy plugin enable` without apps is an empty dock', () => {
  assert.deepEqual(readApps({ version: 1, plugins: [{ id: PLUGIN_ID }] }), []);
  assert.deepEqual(readApps({ version: 1, plugins: [] }), []);
  assert.deepEqual(readApps({ version: 1 }), []);
  for (const apps of [null, 'slack', { id: 'slack' }])
    assert.deepEqual(readApps(withApps(apps)), []);
});

test('text the shell would reject yields an empty dock', () => {
  const rejected = [
    '', '{', 'null', '[]', '"text"',
    JSON.stringify({ plugins: [{ id: PLUGIN_ID, apps: ['slack'] }] }),
    JSON.stringify({ version: 2, plugins: [{ id: PLUGIN_ID, apps: ['slack'] }] }),
    JSON.stringify({ version: 1, plugins: { id: PLUGIN_ID, apps: ['slack'] } })
  ];
  for (const text of rejected)
    assert.deepEqual(readApps(text), [], `accepted ${text}`);
});

// --- resolving against desktop entries -----------------------------------

test('entries supply the name and icon unless the config overrides them', () => {
  const entries = [entry('slack', 'Slack', 'slack'), entry('org.gnome.Nautilus', 'Files', 'org.gnome.Nautilus')];
  assert.deepEqual(resolve([
    { id: 'slack', name: '', icon: '' },
    { id: 'org.gnome.Nautilus', name: 'My Files', icon: '/icons/files.svg' }
  ], entries), [
    { id: 'slack', name: 'Slack', icon: 'slack', available: true },
    { id: 'org.gnome.Nautilus', name: 'My Files', icon: '/icons/files.svg', available: true }
  ]);
});

test('a wrongly cased id launches with the entry id, not the configured spelling', () => {
  const [item] = resolve([{ id: 'whatsapp', name: '', icon: '' }], [entry('WhatsApp')]);
  assert.equal(item.id, 'WhatsApp');
  assert.equal(item.available, true);
});

test('ids ending in .desktop resolve both as file name and as real id', () => {
  const entries = [entry('slack', 'Slack'), entry('org.telegram.desktop', 'Telegram')];
  const items = resolve([
    { id: 'slack.desktop', name: '', icon: '' },
    { id: 'org.telegram.desktop', name: '', icon: '' }
  ], entries);
  assert.deepEqual(items.map(i => [i.id, i.name, i.available]), [
    ['slack', 'Slack', true],
    ['org.telegram.desktop', 'Telegram', true]
  ]);
});

test('an app without a desktop entry is kept but marked unavailable', () => {
  assert.deepEqual(resolve([{ id: 'gone', name: '', icon: '' }], []), [
    { id: 'gone', name: 'gone', icon: '', available: false }
  ]);
});

test('different spellings of one entry are shown once, at the first position', () => {
  const entries = [entry('slack'), entry('WhatsApp'), entry('Dropbox')];
  const apps = ['slack', 'WhatsApp', 'SLACK', 'slack.desktop', 'whatsapp', 'Dropbox'].map(id => ({ id, name: '', icon: '' }));
  assert.deepEqual(resolve(apps, entries).map(i => i.id), ['slack', 'WhatsApp', 'Dropbox']);
});

test('the dock holds at most eight items, counting after duplicates are removed', () => {
  const entries = Array.from({ length: 12 }, (_, i) => entry(`app${i}`));
  const apps = ['app0', 'app0', ...entries.map(e => e.id)].map(id => ({ id, name: '', icon: '' }));
  const ids = resolve(apps, entries).map(i => i.id);
  assert.equal(model.MAX_APPS, 8);
  assert.deepEqual(ids, ['app0', 'app1', 'app2', 'app3', 'app4', 'app5', 'app6', 'app7']);
});

test('prototype-named desktop IDs survive resolution and are deduplicated', () => {
  const ids = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];
  const apps = [...ids, ...ids].map(id => ({ id, name: '', icon: '' }));
  for (const entries of [[], ids.map(id => entry(id))]) {
    const items = resolve(apps, entries);
    assert.deepEqual(items.map(item => item.id), ids);
    assert.ok(items.every(item => item.available === (entries.length > 0)));
  }
});

test('row layout preserves preferred dimensions when there is room', () => {
  assert.deepEqual(plain(model.fitRow(8, 1200, 124, 56, 1.08, 8)),
    { cellWidth: 124, iconSize: 56 });
});

test('all eight cells and their zoomed icons fit narrow and scaled outputs', () => {
  for (const scale of [1, 1.5, 2, 3]) {
    for (const outputWidth of [320, 400, 720, 1920]) {
      const available = outputWidth - 10 - 16 * scale;
      const insets = 12 * scale;
      const { cellWidth, iconSize } = model.fitRow(8, available, 124 * scale, 56 * scale, 1.08, insets);
      assert.ok(cellWidth * 8 <= available, `row overflow at ${outputWidth}, scale ${scale}`);
      assert.ok(iconSize * 1.08 <= Math.max(0, cellWidth - insets), 'selected icon overflow');
      assert.ok(cellWidth >= 0 && iconSize >= 0);
    }
  }
});

test('row layout handles an empty dock and an output not sized yet', () => {
  assert.deepEqual(plain(model.fitRow(0, 400, 124, 56, 1.08, 8)),
    { cellWidth: 124, iconSize: 56 });
  for (const available of [0, -20]) {
    assert.deepEqual(plain(model.fitRow(8, available, 124, 56, 1.08, 8)),
      { cellWidth: 0, iconSize: 0 });
  }
});

test('sameItems compares content, not identity', () => {
  assert.equal(model.sameItems([{ id: 'a', name: '', icon: '' }], [{ id: 'a', name: '', icon: '' }]), true);
  assert.equal(model.sameItems([{ id: 'a', name: '', icon: '' }], [{ id: 'a', name: 'A', icon: '' }]), false);
});

// --- selection ------------------------------------------------------------

test('selection wraps in both directions', () => {
  assert.equal(model.stepIndex(0, 1, 3), 1);
  assert.equal(model.stepIndex(2, 1, 3), 0);
  assert.equal(model.stepIndex(0, -1, 3), 2);
  assert.equal(model.stepIndex(1, -4, 3), 0);
});

test('selection recovers from an out-of-range index and handles an empty dock', () => {
  assert.equal(model.stepIndex(-1, 1, 3), 0);
  assert.equal(model.stepIndex(-1, -1, 3), 2);
  assert.equal(model.stepIndex(7, 1, 3), 0);
  assert.equal(model.stepIndex(0, 1, 0), -1);
});

test('selection stays valid when the item list grows or shrinks', () => {
  assert.equal(model.clampIndex(-1, 5), 0, 'list loaded after opening');
  assert.equal(model.clampIndex(3, 5), 3);
  assert.equal(model.clampIndex(6, 2), 1);
  assert.equal(model.clampIndex(2, 0), -1);
});
