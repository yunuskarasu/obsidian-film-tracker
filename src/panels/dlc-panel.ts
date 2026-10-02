import type { TFile } from "obsidian";
import { gameDlcsOf, type GameDlcEntry } from "../game-note";
import { ensurePanel, panelOf, redrawPanel, renderAction, type PanelContext } from "./kit";

/** A DLC's own line: "Hearts of Stone · 2015", and the day it was finished once it was. */
export function dlcSummary(dlc: GameDlcEntry): string {
	return [dlc.title, dlc.year === null ? null : String(dlc.year), dlc.done ? dlc.completed : null]
		.filter((part): part is string => part !== null && part !== "")
		.join(" · ");
}

/**
 * DLC, under a game's properties: the DLCs and expansions added to its note,
 * each with a checkbox, and a button to add another from IGDB. The \`dlcs\`
 * property row itself is hidden — Obsidian has no widget for a list of
 * objects — and this is its readable view. Nothing is ever added on its own.
 */
export function applyDlcPanel(context: PanelContext, anchor: HTMLElement, file: TFile, frontmatter: Record<string, unknown>): void {
	const dlcs = gameDlcsOf(frontmatter);
	if (!context.settings().showDlcs || dlcs === null) {
		panelOf(anchor, "main")?.detach();
		return;
	}

	const done = dlcs.filter((dlc) => dlc.done).length;
	const suffix = dlcs.length === 0 ? undefined : `${done} / ${dlcs.length} completed`;
	const panel = ensurePanel(anchor, "main");
	if (!redrawPanel(panel, JSON.stringify(["dlc", file.path, dlcs]), "DLC", suffix)) return;

	if (dlcs.length === 0) {
		panel.createDiv({ cls: "film-tracker-connections-list film-tracker-empty", text: "No DLC added." });
	} else {
		const list = panel.createDiv({ cls: "film-tracker-connections-list film-tracker-dlcs" });
		for (const dlc of dlcs) {
			const row = list.createEl("label", { cls: "film-tracker-manga-read film-tracker-dlc" });
			const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
			checkbox.checked = dlc.done;
			checkbox.addEventListener("change", () => context.actions.setDlcDone(file, dlc.igdbId, checkbox.checked));
			row.createSpan({ text: dlcSummary(dlc) });
		}
	}

	const actions = panel.createDiv({ cls: "film-tracker-manga-actions film-tracker-panel-actions" });
	renderAction(actions, "Add DLC…", () => context.actions.addDlc(file));
}
