// Pure logic shared by QuickDock.qml and the Node tests. Keep Qt and
// Quickshell APIs out of this file so it can run in plain JavaScript.

var MAX_APPS = 8

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// Returns the configured desktop id, trimmed, or "" when it cannot name a
// desktop entry. A trailing ".desktop" is kept here: ids such as
// "org.telegram.desktop" legitimately end in it.
function normalizeDesktopId(value) {
  if (typeof value !== "string") return ""
  var id = value.trim()
  if (!id || id === ".desktop" || id.indexOf("/") !== -1) return ""
  return id
}

// Ids to try, in order, for a configured id. Users may write the file name
// ("slack.desktop") or the id itself ("org.telegram.desktop").
function lookupIds(id) {
  var suffix = ".desktop"
  if (id.length > suffix.length && id.slice(-suffix.length) === suffix)
    return [id, id.slice(0, -suffix.length)]
  return [id]
}

// An app is either a desktop id string or { id, name?, icon? }.
function normalizeApp(value) {
  var item = typeof value === "string" ? { id: value } : value
  if (!isPlainObject(item)) return null
  var id = normalizeDesktopId(item.id)
  if (!id) return null
  return {
    id: id,
    name: typeof item.name === "string" ? item.name.trim() : "",
    icon: typeof item.icon === "string" ? item.icon.trim() : ""
  }
}

// Reads this plugin's `apps` from the text of ~/.config/omarchy/shell.json.
// Anything unusable yields an empty list. When the shell itself rejects the
// file it unloads third-party plugins, so there is no list worth keeping.
function appsFromShellConfig(text, pluginId) {
  var config
  try {
    config = JSON.parse(String(text || ""))
  } catch (e) {
    return []
  }
  if (!isPlainObject(config) || config.version !== 1 || !Array.isArray(config.plugins)) return []

  // The shell uses the first entry with a matching id; so do we.
  for (var i = 0; i < config.plugins.length; i++) {
    var entry = config.plugins[i]
    if (!isPlainObject(entry) || entry.id !== pluginId) continue
    if (!Array.isArray(entry.apps)) return []
    var apps = []
    for (var j = 0; j < entry.apps.length; j++) {
      var app = normalizeApp(entry.apps[j])
      if (app) apps.push(app)
    }
    return apps
  }
  return []
}

// Turns configured apps into dock items. `lookup(id)` returns a desktop entry
// ({ id, name, icon }) or null. Items launch with the entry's own id, because
// entry lookup is case-insensitive but launching by file name is not.
// Duplicates, including different spellings of one entry, keep their first
// position; at most MAX_APPS items are returned.
function resolveApps(apps, lookup) {
  var items = []
  var seen = {}
  for (var i = 0; i < apps.length && items.length < MAX_APPS; i++) {
    var app = apps[i]
    var ids = lookupIds(app.id)
    var entry = null
    for (var j = 0; j < ids.length && !entry; j++) entry = lookup(ids[j]) || null

    var launchId = entry ? String(entry.id) : app.id
    if (seen[launchId]) continue
    seen[launchId] = true

    items.push({
      id: launchId,
      name: app.name || (entry && entry.name) || app.id,
      icon: app.icon || (entry && entry.icon) || "",
      available: !!entry
    })
  }
  return items
}

function sameItems(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Moves a selection by delta, wrapping around. Returns -1 for an empty dock.
function stepIndex(current, delta, count) {
  if (count <= 0) return -1
  if (current < 0 || current >= count) return delta < 0 ? count - 1 : 0
  return ((current + delta) % count + count) % count
}

// Keeps a selection valid after the item list changes.
function clampIndex(current, count) {
  if (count <= 0) return -1
  if (current < 0) return 0
  return Math.min(current, count - 1)
}
