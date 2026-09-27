import type { TFile } from "obsidian";
import { findConnections, type Connection } from "../connections";
import { ensurePanel, panelOf, redrawPanel, renderPathLink, type PanelContext } from "./kit";
import { readWork, type VaultScan } from "./vault-scan";

const MAX_CONNECTIONS = 20;

/**
 * CONNECTIONS, under a film's or a TV series' properties: other films and
 * series in the vault sharing a director, creator, composer or cast member.
 * Any other note gets no panel.
 */
export function applyConnections(context: PanelContext, anchor: HTMLElement, file: TFile, scan: VaultScan): void {
	const connections = context.settings().showConnections ? connectionsFor(context, file, scan) : [];
	if (connections.length === 0) {
		panelOf(anchor, "main")?.detach();
		return;
	}

	renderConnections(context, ensurePanel(anchor, "main"), connections, file.path);
}

function connectionsFor(context: PanelContext, file: TFile, scan: VaultScan): Connection[] {
	const current = readWork(context.app, file);
	if (current === null) return [];
	const others = scan.works().filter((work) => work.path !== file.path);
	return findConnections(current, others).slice(0, MAX_CONNECTIONS);
}

function renderConnections(context: PanelContext, panel: HTMLElement, connections: Connection[], sourcePath: string): void {
	const shown = connections.map((connection) => [
		connection.file.path,
		connection.file.title,
		connection.shared.map((credit) => credit.name),
	]);
	if (!redrawPanel(panel, JSON.stringify(["connections", sourcePath, shown]), "CONNECTIONS")) return;

	const list = panel.createEl("ul", { cls: "film-tracker-connections-list" });
	for (const connection of connections) {
		const item = list.createEl("li");
		renderPathLink(context.app, item, connection.file.title, connection.file.path, sourcePath);
		item.createSpan({
			cls: "film-tracker-connections-shared",
			text: ` — ${connection.shared.map((credit) => credit.name).join(", ")}`,
		});
	}
}
