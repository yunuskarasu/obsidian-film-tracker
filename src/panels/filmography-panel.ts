import { filmographyProgress, findFilmography, type FilmographyEntry } from "../filmography";
import { ensurePanel, panelOf, redrawPanel, renderPathLink, type PanelContext, type PanelSlot } from "./kit";
import type { VaultScan } from "./vault-scan";

/**
 * A person note's own works: the films they directed, and under them the
 * TV series they created. Two lists rather than one, since a percentage
 * over both would say nothing — a five-season series and a film are not
 * the same unit.
 */
export function applyFilmography(
	context: PanelContext,
	anchor: HTMLElement,
	sourcePath: string,
	names: Set<string>,
	scan: VaultScan,
): void {
	const settings = context.settings();
	applyWorkList(context, anchor, "main", "FILMOGRAPHY", settings.showFilmography, names, sourcePath, scan, "film");
	applyWorkList(context, anchor, "shows", "TV SERIES", settings.showTvSeries, names, sourcePath, scan, "tv");
}

function applyWorkList(
	context: PanelContext,
	anchor: HTMLElement,
	slot: PanelSlot,
	heading: string,
	shown: boolean,
	names: Set<string>,
	sourcePath: string,
	scan: VaultScan,
	kind: "film" | "tv",
): void {
	const works = shown ? findFilmography(names, scan.worksOfKind(kind)) : [];
	if (works.length === 0) {
		panelOf(anchor, slot)?.detach();
		return;
	}

	renderFilmography(context, ensurePanel(anchor, slot), heading, works, sourcePath);
}

function renderFilmography(
	context: PanelContext,
	panel: HTMLElement,
	heading: string,
	films: FilmographyEntry[],
	sourcePath: string,
): void {
	const progress = filmographyProgress(films);
	const suffix = progress === null ? undefined : `${progress}% watched`;
	if (!redrawPanel(panel, JSON.stringify([heading, sourcePath, films]), heading, suffix)) return;

	const list = panel.createEl("ul", { cls: "film-tracker-connections-list" });
	for (const film of films) {
		const item = list.createEl("li");
		renderPathLink(context.app, item, film.title, film.path, sourcePath);
		if (film.year !== null) {
			item.createSpan({
				cls: "film-tracker-connections-shared",
				text: ` — ${film.year}`,
			});
		}
	}
}
