import type { TFile } from "obsidian";
import { filmographyProgress, findFilmography } from "../filmography";
import { findScores } from "../soundtrack";
import { ensurePanel, panelOf, redrawPanel, renderAction, renderPathLink, type PanelContext } from "./kit";
import { albumsShown, type VaultScan } from "./vault-scan";

/**
 * DISCOGRAPHY, under an artist's properties: their albums already in the
 * vault, oldest first, and a button to add another from their own list of
 * albums. It only ever lists notes — an artist note never creates one.
 */
export function applyDiscography(
	context: PanelContext,
	anchor: HTMLElement,
	file: TFile,
	names: Set<string>,
	scan: VaultScan,
): void {
	if (!context.settings().showDiscography) {
		panelOf(anchor, "main")?.detach();
		return;
	}

	const albums = findFilmography(names, albumsShown(scan.albums(), context.settings().showLatinTitles));
	const progress = filmographyProgress(albums);
	const suffix = progress === null ? undefined : `${progress}% listened`;
	const panel = ensurePanel(anchor, "main");
	if (!redrawPanel(panel, JSON.stringify(["discography", file.path, albums]), "DISCOGRAPHY", suffix)) return;

	if (albums.length === 0) {
		panel.createDiv({ cls: "film-tracker-connections-list film-tracker-empty", text: "None of their albums are in your vault yet." });
	} else {
		const list = panel.createEl("ul", { cls: "film-tracker-connections-list" });
		for (const album of albums) {
			const item = list.createEl("li");
			renderPathLink(context.app, item, album.title, album.path, file.path);
			if (album.year !== null) {
				item.createSpan({ cls: "film-tracker-connections-shared", text: ` — ${album.year}` });
			}
		}
	}

	const actions = panel.createDiv({ cls: "film-tracker-manga-actions film-tracker-panel-actions" });
	renderAction(actions, "Add album…", () => context.actions.addAlbumByArtist(file));
}

const KIND_LABEL = { film: "Film", tv: "TV series", anime: "Anime", game: "Game" } as const;

/**
 * SCORES, under DISCOGRAPHY: the films, TV series, anime and games in the vault
 * the artist scored — named in a film's `composers`, or linked from an
 * album of theirs as its soundtrack. Only there when there is something to
 * list: most artists never wrote a score.
 */
export function applyScores(context: PanelContext, anchor: HTMLElement, file: TFile, names: Set<string>, scan: VaultScan): void {
	const works = context.settings().showScores ? findScores(names, scan.scoreWorks(), scan.albums()) : [];
	if (works.length === 0) {
		panelOf(anchor, "shows")?.detach();
		return;
	}

	const progress = filmographyProgress(works);
	const suffix = progress === null ? undefined : `${progress}% watched`;
	const panel = ensurePanel(anchor, "shows");
	if (!redrawPanel(panel, JSON.stringify(["scores", file.path, works]), "SCORES", suffix)) return;

	const list = panel.createEl("ul", { cls: "film-tracker-connections-list" });
	for (const work of works) {
		const item = list.createEl("li");
		renderPathLink(context.app, item, work.title, work.path, file.path);
		const details = [KIND_LABEL[work.kind], work.year === null ? null : String(work.year)].filter((part) => part !== null);
		item.createSpan({ cls: "film-tracker-connections-shared", text: ` — ${details.join(" · ")}` });
	}
}
