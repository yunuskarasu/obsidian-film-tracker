import type { TFile } from "obsidian";
import { filmographyProgress, findFilmography } from "../filmography";
import { ensurePanel, panelOf, redrawPanel, renderAction, renderPathLink, type PanelContext } from "./kit";
import type { VaultScan } from "./vault-scan";

/**
 * BIBLIOGRAPHY, under an author's properties: their books already in the
 * vault, oldest first, and a button to add another from their own list of
 * books on Open Library. It only ever lists notes — an author note never
 * creates one.
 */
export function applyBibliography(context: PanelContext, anchor: HTMLElement, file: TFile, names: Set<string>, scan: VaultScan): void {
	if (!context.settings().showBibliography) {
		panelOf(anchor, "main")?.detach();
		return;
	}

	const books = findFilmography(names, scan.books());
	const progress = filmographyProgress(books);
	const suffix = progress === null ? undefined : `${progress}% read`;
	const panel = ensurePanel(anchor, "main");
	if (!redrawPanel(panel, JSON.stringify(["bibliography", file.path, books]), "BIBLIOGRAPHY", suffix)) return;

	if (books.length === 0) {
		panel.createDiv({ cls: "film-tracker-connections-list film-tracker-empty", text: "None of their books are in your vault yet." });
	} else {
		const list = panel.createEl("ul", { cls: "film-tracker-connections-list" });
		for (const book of books) {
			const item = list.createEl("li");
			renderPathLink(context.app, item, book.title, book.path, file.path);
			if (book.year !== null) {
				item.createSpan({ cls: "film-tracker-connections-shared", text: ` — ${book.year}` });
			}
		}
	}

	const actions = panel.createDiv({ cls: "film-tracker-manga-actions film-tracker-panel-actions" });
	renderAction(actions, "Add book…", () => context.actions.addBookByAuthor(file));
}
