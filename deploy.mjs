import fs from "fs";
import path from "path";
import os from "os";

const PLUGIN_ID = "canvas-excalidraw-draw";

const vaultArg = process.argv[2];
const vaults = vaultArg
	? [vaultArg]
	: [path.join(os.homedir(), "Projects/softrevel/docs")];

for (const vault of vaults) {
	const dest = path.join(vault, ".obsidian/plugins", PLUGIN_ID);
	fs.mkdirSync(dest, { recursive: true });
	for (const file of ["main.js", "manifest.json"]) {
		fs.copyFileSync(file, path.join(dest, file));
	}
	console.log(`Deployed to ${dest}`);
}
