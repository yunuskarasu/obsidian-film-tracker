import type { TFile } from "obsidian";
import { filmographyProgress } from "../filmography";
import { ensurePanel, panelOf, redrawPanel, renderAction, renderPathLink, type PanelContext } from "./kit";
import { albumsShown, type VaultScan } from "./vault-scan";

/**
 * An album's cover, small and square, opening the album like its title does.
 * An album without one keeps an empty square of the same size, so the rows
 * stay in line.
 */
function renderCover(
	context: PanelContext,
	row: HTMLElement,
	album: { path: string; title: string; coverPath: string | null },
	sourcePath: string,
): void {
	const cover = album.coverPath === null ? null : context.app.vault.getFileByPath(album.coverPath);
	const box = row.createEl("a", { cls: "film-tracker-soundtrack-cover", href: album.path, attr: { "aria-label": album.title } });
	if (cover !== null) box.createEl("img", { attr: { src: context.app.vault.getResourcePath(cover), alt: `${album.title} cover` } });
	box.addEventListener("click", (event) => {
		event.preventDefault();
		void context.app.workspace.openLinkText(album.path, sourcePath, event.ctrlKey || event.metaKey);
	});
}

/**
 * SOUNDTRACK, under a film's, a TV series', an anime's or a game's
 * properties: the album notes whose `soundtrack_of` links this note, oldest
 * first, each beside its cover, and a button to find another. The link is
 * kept on the album alone — this note is never written — so the list is
 * worked out afresh from the albums.
 */
export function applySoundtrack(context: PanelContext, anchor: HTMLElement, file: TFile, scan: VaultScan): void {
	if (!context.settings().showSoundtracks) {
		panelOf(anchor, "soundtrack")?.detach();
		return;
	}

	const albums = albumsShown(scan.soundtracksOf(file.path), context.settings().showLatinTitles).map(
		({ path, title, year, watched, credits, coverPath }) => ({ path, title, year, watched, credits, coverPath }),
	);
	const progress = filmographyProgress(albums);
	const suffix = progress === null ? undefined : `${progress}% listened`;
	const panel = ensurePanel(anchor, "soundtrack");
	if (!redrawPanel(panel, JSON.stringify(["soundtrack", file.path, albums]), "SOUNDTRACK", suffix)) return;

	if (albums.length === 0) {
		panel.createDiv({ cls: "film-tracker-connections-list film-tracker-empty", text: "No soundtrack album is linked to this yet." });
	} else {
		// One row per album, each with its own cover — however many there are.
		const list = panel.createDiv({ cls: "film-tracker-connections-list film-tracker-soundtracks" });
		for (const album of albums) {
			const row = list.createDiv({ cls: "film-tracker-soundtrack" });
			renderCover(context, row, album, file.path);
			const text = row.createDiv({ cls: "film-tracker-soundtrack-text" });
			renderPathLink(context.app, text, album.title, album.path, file.path);
			const details = [album.credits.join(", "), album.year === null ? "" : String(album.year)].filter((part) => part !== "");
			if (details.length > 0) text.createDiv({ cls: "film-tracker-connections-shared", text: details.join(" · ") });
		}
	}

	const actions = panel.createDiv({ cls: "film-tracker-manga-actions film-tracker-panel-actions" });
	renderAction(actions, "Find soundtrack…", () => context.actions.findSoundtrack(file));
}
