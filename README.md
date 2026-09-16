# Quick Dock

A keyboard-summoned dock for up to eight favourite apps on
[Omarchy](https://omarchy.org). Press a shortcut, hit a number key, and your
app starts. The dock takes no screen space until you call it.

![Quick Dock with Slack, Dashboard Hub, WhatsApp, Omamail and Dropbox](preview.png)

- **Fast.** The dock stays loaded in `omarchy-shell`, so it opens instantly.
- **Keyboard-first.** `1`–`8` start an app directly; arrows and Enter work too.
- **Follows your theme.** Background, border, accent-colored selection and font
  come from your Omarchy theme, like the Omarchy menu, and update live when
  you switch themes.
- **Opens where you work.** It appears on the focused monitor.
- **Launches like Omarchy.** Apps start the same way as from the Omarchy app
  launcher (`gtk-launch` through `uwsm-app`), including web apps.

## Requirements

Omarchy 4 with its Quickshell-based shell and Hyprland. Tested on
**Omarchy 4.0.4, Hyprland 0.56.2 and Quickshell 0.3.1**.

The optional close helper uses `bash`, `hyprctl`, `jq` and `timeout`, which ship
with Omarchy.

## Install

```bash
omarchy plugin add https://github.com/arisgysel-design/omarchy-quick-dock.git --enable
```

Review and confirm the prompt. The plugin installs no packages and does not
change your keybindings.

## Configure the apps

`--enable` adds an entry for the plugin to `"plugins"` in
`~/.config/omarchy/shell.json`. Add an `apps` list to **that entry**; plugin
settings live inline on the plugin entry:

```json
{
  "id": "arisgysel-design.quick-dock",
  "apps": ["slack", "org.gnome.Nautilus", "WhatsApp", "Dropbox"]
}
```

Do not add a second entry with the same `id`: the shell and the dock only read
the first one. Leave the rest of the file as it is, including `"version": 1`;
without it the shell ignores the file and disables third-party plugins.

Each app is the name of its desktop entry, with or without `.desktop`
(`slack` or `slack.desktop`; `org.telegram.desktop` also works). List the
installed ones with:

```bash
ls ~/.local/share/applications /usr/share/applications | grep '\.desktop$'
```

Web apps created with `omarchy webapp install` work the same way, e.g.
`"WhatsApp"`.

Instead of a string, an app can be an object that overrides the name or icon
(an icon theme name or an absolute path):

```json
{ "id": "org.gnome.Nautilus", "name": "Files", "icon": "/home/me/icons/files.svg" }
```

Changes apply as soon as `shell.json` is saved.

Invalid entries and duplicates are skipped, and only the first eight apps are
shown. An app whose desktop entry does not exist is shown dimmed; starting it
shows a notification instead of failing silently.

> **Note:** `omarchy plugin disable` removes the plugin entry from
> `shell.json`, including its `apps`. Keep a copy if you plan to re-enable it.

## Keybindings

**Quick Dock does not install shortcuts.** Add them to
`~/.config/hypr/bindings.lua`. Check free keys first with
`omarchy menu keybindings --print`.

Open and close the dock with `Super + D`:

```lua
o.bind("SUPER + D", "Quick Dock", "omarchy-shell shell toggle arisgysel-design.quick-dock '{}'")
```

### Optional: close the dock with Super + W

In Omarchy, `Super + W` closes the active window. The compositor handles that
key before the dock sees it, so on its own it would close the window *behind*
the open dock. The bundled helper fixes this: it hides the dock when it is
open, and otherwise closes the active window as before.

```lua
hl.unbind("SUPER + W")
local quick_dock_close = os.getenv("HOME") .. "/.config/omarchy/plugins/arisgysel-design.quick-dock/bin/quick-dock-close"
o.bind("SUPER + W", "Close window or Quick Dock",
  "if [ -x '" .. quick_dock_close .. "' ]; then '" .. quick_dock_close .. "'; else hyprctl dispatch 'hl.dsp.window.close()'; fi")
```

The `if` keeps `Super + W` closing windows even after the plugin is removed.
The helper asks Hyprland, not the shell, whether the dock is open. As a result,
closing windows keeps working when `omarchy-shell` is slow or not running.
If Hyprland's layer query fails or returns invalid data, the helper leaves
windows untouched; press the shortcut again once Hyprland responds normally.

After editing, validate the config:

```bash
hyprctl reload && hyprctl configerrors
```

## Controls

| Action | Key |
| --- | --- |
| Start app 1–8 | `1` … `8` |
| Move the selection | `←` `→`, `h` `l`, `Tab` `Shift+Tab`, `Home` `End` |
| Start the selected app | `Enter` or `Space` |
| Close | `Esc`, click outside the dock, or your toggle shortcut |
| Start with the mouse | Click an icon |

## Troubleshooting

- **The dock does not open.** Run `omarchy-shell shell listPlugins` and check
  that `arisgysel-design.quick-dock` is listed and enabled.
- **"No apps configured".** The plugin entry in `shell.json` has no valid
  `apps` list. Check the `id` and that `apps` is an array.
- **An icon is dimmed.** No desktop entry with that name exists. Check the
  spelling against the file names listed above. Upper and lower case do not
  matter.
- **Logs:** `journalctl --user --since "10 min ago" | grep -i quick-dock`

## Uninstall

```bash
omarchy plugin remove arisgysel-design.quick-dock
```

Then delete the Quick Dock lines you added to `~/.config/hypr/bindings.lua`
(see [Keybindings](#keybindings)), including the `hl.unbind("SUPER + W")` line
if you used the close helper, and run `hyprctl reload`.

## Development

Link your checkout instead of installing from git. Do not overwrite an
existing install. From the checkout directory:

```bash
ln -s "$PWD" ~/.config/omarchy/plugins/arisgysel-design.quick-dock
omarchy-shell shell rescanPlugins
omarchy plugin enable arisgysel-design.quick-dock
```

The shell does not notice edits made behind the symlink, so run
`omarchy restart shell` after changing QML or JavaScript.

| File | Purpose |
| --- | --- |
| `manifest.json` | Plugin manifest. The `menu` kind is meant to give the dock Omarchy's app library; see the note in `QuickDock.qml`. |
| `QuickDock.qml` | UI, keyboard handling, config loading and launching |
| `DockModel.js` | Pure logic (config parsing, validation, selection) with no Qt dependencies |
| `bin/quick-dock-close` | Optional close-key helper |
| `tests/` | Node tests for the model and the helper |

### Checks

```bash
node --test tests/*.test.mjs
bash -n bin/quick-dock-close
shellcheck bin/quick-dock-close
omarchy plugin validate .
/usr/lib/qt6/bin/qmllint -I "$OMARCHY_PATH/shell" QuickDock.qml
```

The helper tests run the real script against stub `hyprctl` and
`omarchy-shell` commands. No window is touched.

Standalone `qmllint` cannot resolve the shell's runtime `qs.*` imports. Its
import and unqualified-access warnings are expected, as for Omarchy's built-in
plugins. For a real check, load the plugin in Omarchy and watch the user
journal for QML errors.

## License

[MIT](LICENSE)
