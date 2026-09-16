# Changelog

## 1.0.0 - 2026-09-16

First release.

- Dock with up to eight apps, configured inline in `shell.json`
- Keyboard control: number keys, arrows, Tab, Home/End, Enter, Escape
- Icons and launching like Omarchy's app launcher; uses the shell's app
  library when the shell provides it
- Opens on the focused monitor
- Styled with the theme's menu tokens (background, border, scrim, selected
  background, text and border) and the menu font; updates live on theme change
- Dimmed entries and a notification for apps without a desktop entry
- Optional `bin/quick-dock-close` helper for Super+W
