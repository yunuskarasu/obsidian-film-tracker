import type { TFile } from "obsidian";
import { filmographyProgress } from "../filmography";
import { ensurePanel, panelOf, redrawPanel, renderAction, renderPathLink, type PanelContext } from "./kit";
import type { VaultScan } from "./vault-scan";

/**
 * SOUNDTRACK, under a film's, a TV series' or an anime's properties: the
 * album notes whose `soundtrack_of` links this note, oldest first, and a
 * button to find another. The link is kept on the album alone — this note is
 * never written — so the list is worked out afresh from the albums.
 */
export function applySoundtrack(context: PanelContext, anchor: HTMLElement, file: TFile, scan: VaultScan): void {
	if (!context.settings().showSoundtracks) {
		panelOf(anchor, "soundtrack")?.detach();
		return;
	}

	const albums = scan.soundtracksOf(file.path).map(({ path, title, year, watched, credits }) => ({ path, title, year, watched, credits }));
	const progress = filmographyProgress(albums);
	const suffix = progress === null ? undefined : `${progress}% listened`;
	const panel = ensurePanel(anchor, "soundtrack");
	if (!redrawPanel(panel, JSON.stringify(["soundtrack", file.path, albums]), "SOUNDTRACK", suffix)) return;

	if (albums.length === 0) {
		panel.createDiv({ cls: "film-tracker-connections-list film-tracker-empty", text: "No soundtrack album is linked to this yet." });
	} else {
		const list = panel.createEl("ul", { cls: "film-tracker-connections-list" });
		for (const album of albums) {
			const item = list.createEl("li");
			renderPathLink(context.app, item, album.title, album.path, file.path);
			const details = [album.credits.join(", "), album.year === null ? "" : String(album.year)].filter((part) => part !== "");
			if (details.length > 0) {
				item.createSpan({ cls: "film-tracker-connections-shared", text: ` — ${details.join(" · ")}` });
			}
		}
	}

	const actions = panel.createDiv({ cls: "film-tracker-manga-actions film-tracker-panel-actions" });
	renderAction(actions, "Find soundtrack…", () => context.actions.findSoundtrack(file));
}
