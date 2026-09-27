import { findMangagraphy, mangagraphyProgress, type MangagraphyEntry } from "../mangagraphy";
import { ensurePanel, panelOf, redrawPanel, renderPathLink, type PanelContext } from "./kit";
import type { VaultScan } from "./vault-scan";

/**
 * MANGAGRAPHY, under a mangaka's properties. No visibility setting of its
 * own — mirrors the MANGA panel, which has none either, rather than
 * `showFilmography` (that toggle is about a director's own panel, and
 * coupling it to a mangaka's would be a confusing surprise).
 */
export function applyMangagraphy(
	context: PanelContext,
	anchor: HTMLElement,
	sourcePath: string,
	names: Set<string>,
	scan: VaultScan,
): void {
	const mangas = findMangagraphy(names, scan.mangas());
	if (mangas.length === 0) {
		panelOf(anchor, "main")?.detach();
		return;
	}

	renderMangagraphy(context, ensurePanel(anchor, "main"), mangas, sourcePath);
}

function renderMangagraphy(context: PanelContext, panel: HTMLElement, mangas: MangagraphyEntry[], sourcePath: string): void {
	const progress = mangagraphyProgress(mangas);
	const suffix = progress === null ? undefined : `${progress}% read`;
	if (!redrawPanel(panel, JSON.stringify(["mangagraphy", sourcePath, mangas]), "MANGAGRAPHY", suffix)) return;

	const { app } = context;
	const list = panel.createEl("ul", { cls: "film-tracker-connections-list" });
	for (const manga of mangas) {
		const item = list.createEl("li");
		const [primaryPath, ...otherPaths] = manga.paths;
		renderPathLink(app, item, manga.title, primaryPath, sourcePath);
		if (manga.year !== null) {
			item.createSpan({
				cls: "film-tracker-connections-shared",
				text: ` — ${manga.year}`,
			});
		}
		// The same manga on more than one Series note — one per
		// adaptation — is listed once, with the other notes alongside.
		if (otherPaths.length > 0) {
			const others = item.createSpan({ cls: "film-tracker-connections-shared", text: " · also in " });
			otherPaths.forEach((path, index) => {
				if (index > 0) others.appendText(", ");
				const file = app.vault.getFileByPath(path);
				renderPathLink(app, others, file?.basename ?? path, path, sourcePath);
			});
		}
	}
}
