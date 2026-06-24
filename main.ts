import { App, ItemView, Menu, Plugin, TFile } from "obsidian";

interface CanvasCoords {
	x: number;
	y: number;
}

interface CanvasNodeSize {
	width: number;
	height: number;
}

interface CanvasNode {
	getData(): { type: string; label?: string };
	getBBox(): { minX: number; minY: number; maxX: number; maxY: number };
}

interface Canvas {
	readonly: boolean;
	canvasRect: DOMRect;
	nodes: Map<string, CanvasNode>;
	config: { defaultFileNodeDimensions: CanvasNodeSize };
	posFromEvt(evt: PointerEvent | MouseEvent): CanvasCoords;
	posFromClient(point: { x: number; y: number }): CanvasCoords;
	createFileNode(opts: {
		pos: CanvasCoords;
		size: CanvasNodeSize;
		file: TFile;
		save?: boolean;
		focus?: boolean;
	}): CanvasNode;
	requestSave(): void;
}

interface CanvasView extends ItemView {
	canvas: Canvas;
}

interface ExcalidrawPlugin {
	settings: { folder: string; compatibilityMode?: boolean; useExcalidrawExtension?: boolean };
	createDrawing(filename: string, foldername: string, templateData?: string): Promise<TFile>;
	openDrawing(
		file: TFile,
		location: "new-pane" | "new-tab" | "active-pane" | "popout-window",
		...rest: unknown[]
	): void;
}

interface ExcalidrawView extends ItemView {
	file: TFile | null;
	excalidrawAPI: unknown;
	reload(fullreload?: boolean, file?: TFile): Promise<void>;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// A view opened immediately after vault.create() mounts before the Excalidraw
// React app has fully wired up its drag/library handlers - dragging library
// items in fails silently until the file is closed and reopened. Polling for
// excalidrawAPI then forcing the same reload() the plugin itself runs after
// external file changes reproduces that close/reopen and fixes it in place.
async function waitForExcalidrawView(app: App, file: TFile, timeoutMs = 4000): Promise<ExcalidrawView | null> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const leaf = app.workspace.getLeavesOfType("excalidraw").find((l) => (l.view as ExcalidrawView).file === file);
		const view = leaf?.view as ExcalidrawView | undefined;
		if (view?.excalidrawAPI) return view;
		await delay(100);
	}
	return null;
}

function getExcalidrawPlugin(app: App): ExcalidrawPlugin | null {
	return (app as any).plugins?.plugins?.["obsidian-excalidraw-plugin"] ?? null;
}

// Mirrors the official plugin's own getDrawingFilename() extension choice.
// Raw ".excalidraw" files crash that plugin's view setup when its global
// compatibilityMode setting is off (actionButtons never get initialized for
// that combination) - matching its current setting is what actually renders.
function drawingExtension(excalidraw: ExcalidrawPlugin): string {
	if (excalidraw.settings.compatibilityMode) return ".excalidraw";
	if (excalidraw.settings.useExcalidrawExtension) return ".excalidraw.md";
	return ".md";
}

function isCanvasView(view: ItemView | null): view is CanvasView {
	return !!view && view.getViewType() === "canvas" && !!(view as CanvasView).canvas;
}

function findContainingGroupLabel(canvas: Canvas, pos: CanvasCoords): string | null {
	let best: { label: string; area: number } | null = null;
	for (const node of canvas.nodes.values()) {
		const data = node.getData();
		if (data.type !== "group" || !data.label) continue;
		const bbox = node.getBBox();
		if (pos.x < bbox.minX || pos.x > bbox.maxX || pos.y < bbox.minY || pos.y > bbox.maxY) continue;
		const area = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
		if (!best || area < best.area) best = { label: data.label, area };
	}
	return best?.label ?? null;
}

function formatTimestamp(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(
		d.getMinutes()
	)}.${pad(d.getSeconds())}`;
}

function fallbackCenterPos(canvas: Canvas): CanvasCoords {
	const rect = canvas.canvasRect;
	return canvas.posFromClient({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
}

async function createExcalidrawCanvasNode(
	app: App,
	canvas: Canvas,
	pos: CanvasCoords,
	size: CanvasNodeSize
): Promise<void> {
	const excalidraw = getExcalidrawPlugin(app);
	if (!excalidraw) {
		console.error("canvas-excalidraw-draw: Excalidraw plugin is not installed/enabled.");
		return;
	}

	const groupLabel = findContainingGroupLabel(canvas, pos);
	const filename = `${groupLabel ?? "canvasdraw"} ${formatTimestamp()}${drawingExtension(excalidraw)}`;

	const file = await excalidraw.createDrawing(filename, excalidraw.settings.folder);

	canvas.createFileNode({ pos, size, file, save: true, focus: false });
	canvas.requestSave();
	excalidraw.openDrawing(file, "popout-window", true);

	const view = await waitForExcalidrawView(app, file);
	if (view) await view.reload(true, file);
}

export default class CanvasExcalidrawDrawPlugin extends Plugin {
	private lastPointerEvent: PointerEvent | null = null;
	private patchedPrototypes = new WeakSet<object>();
	private patches: { proto: any; original: (...args: any[]) => void }[] = [];

	async onload(): Promise<void> {
		this.registerDomEvent(document, "pointermove", (evt: PointerEvent) => {
			this.lastPointerEvent = evt;
		});

		this.app.workspace.onLayoutReady(() => this.patchAllOpenCanvases());
		this.registerEvent(this.app.workspace.on("layout-change", () => this.patchAllOpenCanvases()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.patchAllOpenCanvases()));

		this.addCommand({
			id: "create-excalidraw-canvas-node",
			name: "Create Excalidraw drawing on canvas at cursor",
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(ItemView);
				if (!isCanvasView(view) || view.canvas.readonly) return false;
				if (checking) return true;

				const canvas = view.canvas;
				const pos = this.lastPointerEvent ? canvas.posFromEvt(this.lastPointerEvent) : fallbackCenterPos(canvas);
				void createExcalidrawCanvasNode(this.app, canvas, pos, canvas.config.defaultFileNodeDimensions);
				return true;
			},
		});
	}

	onunload(): void {
		for (const { proto, original } of this.patches) {
			proto.showCreationMenu = original;
		}
		this.patches = [];
	}

	private patchAllOpenCanvases(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
			const view = leaf.view as CanvasView;
			if (view.canvas) this.patchCanvasPrototype(view.canvas);
		}
	}

	// Obsidian's core Canvas plugin fires no public event for the empty-area
	// right-click menu (only "canvas:node-menu" / "canvas:selection-menu" exist),
	// so the only way to add an item to it is wrapping the prototype method
	// that builds it.
	private patchCanvasPrototype(canvas: Canvas): void {
		const proto = Object.getPrototypeOf(canvas);
		if (this.patchedPrototypes.has(proto)) return;
		this.patchedPrototypes.add(proto);

		const original = proto.showCreationMenu as (menu: Menu, pos: CanvasCoords, size?: CanvasNodeSize) => void;
		this.patches.push({ proto, original });
		const app = this.app;

		proto.showCreationMenu = function (this: Canvas, menu: Menu, pos: CanvasCoords, size?: CanvasNodeSize) {
			original.call(this, menu, pos, size);
			menu.addItem((item) =>
				item
					.setTitle("Add Excalidraw drawing")
					.setSection("create")
					.setIcon("pencil")
					.onClick(() => {
						void createExcalidrawCanvasNode(app, this, pos, size ?? this.config.defaultFileNodeDimensions);
					})
			);
		};
	}
}
