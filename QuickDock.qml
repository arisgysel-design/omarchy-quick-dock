import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Ui
import "DockModel.js" as DockModel

// Quick Dock: a summoned row of up to eight favourite apps.
//
// The app list lives inline on this plugin's entry in
// ~/.config/omarchy/shell.json, following the shell's storage rules:
//   { "id": "arisgysel-design.quick-dock", "apps": ["slack", "org.gnome.Nautilus"] }
Item {
  id: root

  // Injected by the shell. Menu plugins are meant to receive `shell.appLibrary`,
  // but Omarchy 4.0.4 drops it for third-party menus that stay loaded (the kind
  // check fails on the manifest it passes), so icons and launching fall back to
  // Quickshell and gtk-launch, the same way the app library does it.
  property var shell: null
  property var manifest: null

  // bin/quick-dock-close looks for a mapped layer with this namespace.
  readonly property string layerNamespace: "quick-dock"
  readonly property string pluginId: manifest && manifest.id ? String(manifest.id) : ""
  readonly property var appLibrary: shell && shell.appLibrary ? shell.appLibrary : null
  readonly property string shellConfigPath: Quickshell.env("HOME") + "/.config/omarchy/shell.json"

  property bool opened: false
  property var apps: []
  // Bumped when the app library reports changed desktop entries, so names,
  // icons and availability are resolved again.
  property int entriesRevision: 0
  readonly property var items: resolveItems(apps, entriesRevision)
  property int selectedIndex: -1

  // Theme tokens: the dock is styled as a menu surface, like Omarchy's own
  // menu, clipboard and emoji picker. Colors come from the [menu] section of
  // the theme's shell.toml, falling back to colors.toml, and update live when
  // the theme changes. The font follows `omarchy font set` and
  // OMARCHY_MENU_FONT.
  readonly property color background: Color.menu.background
  readonly property color foreground: Color.menu.text
  readonly property color scrim: Color.menu.scrim
  readonly property color selectedBackground: Color.menu.selectedBackground
  readonly property color selectedText: Color.menu.selectedText
  readonly property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))
  readonly property var selectedBorderSpec: Border.surfaceSpec("menu", "selected-border", Color.menu.selectedBorder, 0)
  readonly property string fontFamily: Style.font.menuFamily

  readonly property int iconSize: rowLayout.iconSize
  readonly property real selectedIconScale: 1.08
  readonly property int preferredCellWidth: Style.space(124)
  // Shrink cells rather than overflow narrow or heavily scaled outputs.
  readonly property var rowLayout: {
    var available = panel.width - Style.gapsOut * 2 - card.contentLeftInset - card.contentRightInset
    var insets = Border.left(selectedBorderSpec) + Border.right(selectedBorderSpec) + Style.space(8)
    return DockModel.fitRow(root.items.length, available, root.preferredCellWidth,
      Style.space(56), root.selectedIconScale, insets)
  }
  readonly property int cellWidth: rowLayout.cellWidth
  readonly property int cellHeight: iconSize + Style.font.bodySmall + Style.space(26)
    + Border.top(selectedBorderSpec) + Border.bottom(selectedBorderSpec)
  readonly property int bottomMargin: Style.space(48)
  readonly property int slideDistance: Style.space(24)

  // Shell lifecycle: summon -> open(), hide -> close().
  function open(payloadJson) {
    if (root.appLibrary) root.appLibrary.refreshIcons()
    root.selectedIndex = DockModel.clampIndex(0, root.items.length)
    pointerGate.reset()
    var target = root.focusedScreen()
    if (target && panel.screen !== target) panel.screen = target
    root.opened = true
    openAnimation.restart()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && root.pluginId) root.shell.hide(root.pluginId)
  }

  function reloadApps() {
    if (!root.pluginId) return
    var next = DockModel.appsFromShellConfig(configFile.text(), root.pluginId)
    if (!DockModel.sameItems(next, root.apps)) root.apps = next
  }

  function iconSource(icon) {
    if (root.appLibrary) return root.appLibrary.iconSource(icon)
    var value = String(icon || "")
    if (value.charAt(0) === "/") return "file://" + value
    return Quickshell.iconPath(value, "application-x-executable")
  }

  function resolveItems(apps, revision) {
    return DockModel.resolveApps(apps, function(id) { return DesktopEntries.byId(id) })
  }

  function focusedScreen() {
    var monitor = Hyprland.focusedMonitor
    var name = monitor ? String(monitor.name || "") : ""
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++) {
      if (screens[i].name === name) return screens[i]
    }
    return null
  }

  function launch(index) {
    var item = root.items[index]
    if (!item) return
    root.dismiss()
    // The entry can disappear after the list was resolved, e.g. on uninstall.
    if (!DesktopEntries.byId(item.id)) {
      Quickshell.execDetached(["notify-send", "Quick Dock",
        "No desktop entry named \"" + item.id + "\"."])
      return
    }
    if (root.appLibrary) root.appLibrary.launch(item.id, item.name)
    // Keep the .desktop suffix, or ids like org.telegram.desktop won't resolve.
    else Quickshell.execDetached(["uwsm-app", "--", "gtk-launch", item.id + ".desktop"])
  }

  function select(delta) {
    root.selectedIndex = DockModel.stepIndex(root.selectedIndex, delta, root.items.length)
  }

  onPluginIdChanged: reloadApps()
  // The first summon after a shell start can arrive before shell.json loaded.
  onItemsChanged: selectedIndex = DockModel.clampIndex(selectedIndex, items.length)

  FileView {
    id: configFile
    path: root.shellConfigPath
    watchChanges: true
    printErrors: false
    onLoaded: root.reloadApps()
    onFileChanged: reload()
  }

  // One source of entry changes, so each change resolves the items once.
  Connections {
    target: root.appLibrary
    function onAppsChanged() { root.entriesRevision++ }
  }

  Connections {
    target: root.appLibrary ? null : DesktopEntries.applications
    function onValuesChanged() { root.entriesRevision++ }
  }

  // Ignores hover changes caused by the card sliding under a still pointer.
  PointerMoveGate {
    id: pointerGate
    referenceItem: scrimLayer
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: root.layerNamespace
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      id: scrimLayer
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      property real slide: 0

      width: Math.max(1, root.items.length) * root.cellWidth + card.contentLeftInset + card.contentRightInset
      height: root.cellHeight + card.contentTopInset + card.contentBottomInset
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      anchors.bottomMargin: root.bottomMargin - root.slideDistance * card.slide
      radius: Style.cornerRadius
      color: root.background
      borderSpec: root.borderSpec
      padding: Style.spacing.md

      // Swallow clicks so they do not reach the dismissing scrim.
      MouseArea { anchors.fill: parent }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true

        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          switch (event.key) {
          case Qt.Key_Escape:
            root.dismiss()
            break
          case Qt.Key_Left:
          case Qt.Key_H:
          case Qt.Key_Backtab:
            root.select(-1)
            break
          case Qt.Key_Right:
          case Qt.Key_L:
          case Qt.Key_Tab:
            root.select(1)
            break
          case Qt.Key_Home:
            root.selectedIndex = DockModel.clampIndex(0, root.items.length)
            break
          case Qt.Key_End:
            root.selectedIndex = root.items.length - 1
            break
          case Qt.Key_Return:
          case Qt.Key_Enter:
          case Qt.Key_Space:
            if (!event.isAutoRepeat) root.launch(root.selectedIndex)
            break
          default:
            if (event.key < Qt.Key_1 || event.key >= Qt.Key_1 + DockModel.MAX_APPS) return
            if (!event.isAutoRepeat) root.launch(event.key - Qt.Key_1)
          }
          pointerGate.reset()
          event.accepted = true
        }
      }

      Text {
        visible: root.items.length === 0
        x: card.contentLeftInset
        y: card.contentTopInset
        width: root.cellWidth
        height: root.cellHeight
        text: "No apps configured"
        wrapMode: Text.WordWrap
        color: root.foreground
        opacity: 0.7
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
      }

      Row {
        x: card.contentLeftInset
        y: card.contentTopInset

        Repeater {
          model: root.items

          delegate: BorderSurface {
            id: cell
            required property var modelData
            required property int index

            readonly property bool selected: index === root.selectedIndex
            // Reserve the selected border on every cell so content does not
            // shift or get covered when the selection moves.
            readonly property real reservedTop: Border.top(root.selectedBorderSpec)
            readonly property real reservedLeft: Border.left(root.selectedBorderSpec)
            readonly property real reservedRight: Border.right(root.selectedBorderSpec)

            width: root.cellWidth
            height: root.cellHeight
            radius: Style.cornerRadius
            color: selected ? root.selectedBackground : "transparent"
            borderSpec: selected ? root.selectedBorderSpec : Border.none()
            opacity: modelData.available ? 1 : 0.4

            Image {
              id: icon
              anchors.horizontalCenter: parent.horizontalCenter
              y: cell.reservedTop + Style.space(8)
              width: root.iconSize
              height: root.iconSize
              // Decode at physical pixels, including the selected zoom.
              sourceSize.width: width * root.selectedIconScale * Screen.devicePixelRatio
              sourceSize.height: height * root.selectedIconScale * Screen.devicePixelRatio
              fillMode: Image.PreserveAspectFit
              asynchronous: true
              smooth: true
              source: root.iconSource(cell.modelData.icon)
              scale: cell.selected ? root.selectedIconScale : 1
              Behavior on scale { NumberAnimation { duration: 120; easing.type: Easing.OutCubic } }
            }

            Text {
              anchors.top: icon.bottom
              anchors.topMargin: Style.space(6)
              x: cell.reservedLeft + Style.space(4)
              width: Math.max(0, parent.width - cell.reservedLeft - cell.reservedRight - Style.space(8))
              textFormat: Text.PlainText
              text: cell.modelData.name
              color: cell.selected ? root.selectedText : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              horizontalAlignment: Text.AlignHCenter
              elide: Text.ElideRight
            }

            MouseArea {
              id: cellMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onPositionChanged: function(mouse) {
                if (pointerGate.moved(cellMouse, mouse)) root.selectedIndex = cell.index
              }
              onClicked: root.launch(cell.index)
            }
          }
        }
      }
    }

    // Opening only: the window unmaps as soon as the dock closes.
    ParallelAnimation {
      id: openAnimation
      NumberAnimation { target: card; property: "slide"; from: 1; to: 0; duration: 180; easing.type: Easing.OutCubic }
      NumberAnimation { target: card; property: "opacity"; from: 0; to: 1; duration: 140 }
      NumberAnimation { target: scrimLayer; property: "opacity"; from: 0; to: 1; duration: 140 }
    }
  }
}
