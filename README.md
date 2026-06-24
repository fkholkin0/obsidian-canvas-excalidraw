# Canvas Excalidraw Draw

Obsidian plugin that adds a way to create a new Excalidraw drawing directly as a node on Canvas, via right-click or a hotkey, instead of creating it elsewhere and dragging it in.

## Features

- Right-click an empty area of a Canvas → **Add Excalidraw drawing**, listed alongside the native Add card / Add note / Add media / Add web page options.
- A command (bind your own hotkey in *Settings → Hotkeys*) does the same thing at the last known cursor position over the canvas.
- The new file is named `canvasdraw <date> <time>`, or `<group label> <date> <time>` if created inside an existing Group node, saved into the Excalidraw plugin's configured default folder.
- The drawing is placed on the canvas and opened in a popout window in one step.

## Requirements

- Obsidian's core **Canvas** plugin, enabled.
- [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin), installed and enabled.

## Install

Not published to the community plugin store: it patches an undocumented internal Canvas method, which wouldn't pass Obsidian's review. Build it yourself and copy it into a vault:

```bash
npm install
npm run build
npm run deploy /path/to/your/vault
```

Then enable **Canvas Excalidraw Draw** under *Settings → Community plugins*.

`npm run dev` runs an esbuild watcher for local development.

## Why this is fragile

Canvas has no public event for its empty-area context menu, so this plugin monkey-patches `Canvas.prototype.showCreationMenu` directly. That's undocumented, unversioned internal API, and it can change or break on any Obsidian update with no warning. If it stops working, the internals can be found again by grepping the strings inside Obsidian's own `obsidian.asar`.
