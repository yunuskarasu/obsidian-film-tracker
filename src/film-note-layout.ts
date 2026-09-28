import { MarkdownView, type App } from "obsidian";
import { applyConnections } from "./panels/connections-panel";
import { applyDiscography, applyScores } from "./panels/discography-panel";
import { applyFilmography } from "./panels/filmography-panel";
import { CONNECTIONS_CLASS, detachPanelsExcept, panelOf, type MangaPanelActions, type PanelContext } from "./panels/kit";
import { applyMangaPanel } from "./panels/manga-panel";
import { applyMangagraphy } from "./panels/mangagraphy-panel";
import { panelPlanFor } from "./panels/panel-plan";
import { classifyNote } from "./note-kind";
import { soundtrackWorkOf } from "./soundtrack";
import { LAYOUT_CLASS, POSTER_CLASS, applyPoster, findHost } from "./panels/poster";
import { applySeasonsPanel } from "./panels/seasons-panel";
import { applyLyricsPanel } from "./panels/lyrics-panel";
import { applySoundtrack } from "./panels/soundtrack-panel";
import { applyTracklist } from "./panels/tracklist-panel";
import { VaultScan } from "./panels/vault-scan";
import type { FilmTrackerSettings } from "./settings";

/**
 * Marks the same host element `LAYOUT_CLASS` lives on, scoping the CSS rule
 * that hides the native `manga` property row (Obsidian has no widget for a
 * nested object property, so it renders as raw JSON) to Series notes only —
 * a note elsewhere in the vault with its own unrelated `manga` property is
 * never touched, since this class is never added to its host.
 */
const MANGA_HOST_CLASS = "film-tracker-has-manga";
/**
 * The same idea as `MANGA_HOST_CLASS` for a TV note's `seasons` block: a list
 * of objects has no widget of its own either, and the SEASONS panel below is
 * the readable view of it.
 */
const SEASONS_HOST_CLASS = "film-tracker-has-seasons";
/** And for an album's `tracks`, whose readable view is the TRACKLIST panel. */
const TRACKS_HOST_CLASS = "film-tracker-has-tracks";

/**
 * Draws the poster beside every open note's properties and the panels under
 * them. Which panels a note gets is `panelPlanFor`'s answer; each panel draws
 * itself from its own module under `src/panels/`, and this class only puts
 * them in place, keeps them there and takes them away again.
 */
export class FilmNoteLayout {
	private readonly app: App;
	private readonly context: PanelContext;
	/** Set once the plugin unloads: a refresh still scheduled after that must not draw anything back. */
	private disposed = false;

	constructor(app: App, settings: () => FilmTrackerSettings, actions: MangaPanelActions) {
		this.app = app;
		this.context = { app, settings, actions };
	}

	refresh(): void {
		if (this.disposed) return;
		const scan = new VaultScan(this.app);
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) this.applyTo(view, scan);
		}
	}

	/**
	 * Takes every poster and panel back out, in pop-out windows too — each
	 * window has its own document, so the open notes' own containers are
	 * searched as well as the main one.
	 */
	removeAll(): void {
		this.disposed = true;
		const roots: ParentNode[] = [document];
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) roots.push(leaf.view.containerEl);

		for (const root of roots) {
			root.querySelectorAll(`.${POSTER_CLASS}, .${CONNECTIONS_CLASS}`).forEach((el) => el.detach());
			root.querySelectorAll(`.${LAYOUT_CLASS}`).forEach((el) => el.removeClass(LAYOUT_CLASS));
			root.querySelectorAll(`.${MANGA_HOST_CLASS}`).forEach((el) => el.removeClass(MANGA_HOST_CLASS));
			root.querySelectorAll(`.${SEASONS_HOST_CLASS}`).forEach((el) => el.removeClass(SEASONS_HOST_CLASS));
			root.querySelectorAll(`.${TRACKS_HOST_CLASS}`).forEach((el) => el.removeClass(TRACKS_HOST_CLASS));
		}
	}

	/**
	 * Draws again if something drawn before has since been taken out of the
	 * page. Reading view builds and discards the note as it is scrolled, and
	 * the poster and the panels are inserted beside its header rather than
	 * being part of it — scrolling to the bottom of a long note dropped them,
	 * and scrolling back only brought Obsidian's own part of it back.
	 *
	 * The check is a count of elements, so it costs nothing on the scroll
	 * events that find everything in place; only a real loss reads the vault.
	 */
	redrawIfMissing(): void {
		if (this.disposed) return;

		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;

			const drawn = Number(view.contentEl.dataset.filmTrackerDrawn ?? "0");
			if (drawn > 0 && this.drawnIn(view) < drawn) {
				this.refresh();
				return;
			}
		}
	}

	private applyTo(view: MarkdownView, scan: VaultScan): void {
		const host = findHost(view);
		if (host !== null) applyPoster(this.app, this.context.actions, host, view.file);

		this.applyPanels(view, host, scan);
		view.contentEl.dataset.filmTrackerDrawn = String(this.drawnIn(view));
	}

	/** How many of this plugin's own elements the view holds right now. */
	private drawnIn(view: MarkdownView): number {
		return view.contentEl.querySelectorAll(`.${POSTER_CLASS}, .${CONNECTIONS_CLASS}`).length;
	}

	/**
	 * The panels under the note's properties, as `panelPlanFor` lists them.
	 * Reading view has no single host that wraps both the header and the
	 * body, so the panels are inserted as the header's next siblings instead
	 * of living inside the same grid the poster uses.
	 */
	private applyPanels(view: MarkdownView, host: HTMLElement | null, scan: VaultScan): void {
		const anchor = findPanelsAnchor(view);
		if (anchor === null) return;

		const file = view.file;
		if (file === null) {
			host?.removeClass(MANGA_HOST_CLASS);
			host?.removeClass(SEASONS_HOST_CLASS);
			host?.removeClass(TRACKS_HOST_CLASS);
			detachPanelsExcept(anchor, []);
			return;
		}

		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const plan = panelPlanFor(frontmatter);
		host?.toggleClass(MANGA_HOST_CLASS, plan.kind === "manga" || (plan.kind === "tv" && plan.manga));
		host?.toggleClass(SEASONS_HOST_CLASS, plan.kind === "tv");
		host?.toggleClass(TRACKS_HOST_CLASS, plan.kind === "album");

		const context = this.context;
		// A film, a TV series or an anime has its SOUNDTRACK below whatever else it has.
		if (soundtrackWorkOf(classifyNote(frontmatter)) !== null) applySoundtrack(context, anchor, file, scan);
		else panelOf(anchor, "soundtrack")?.detach();

		switch (plan.kind) {
			case "tv":
				// All three, each in its own box and in this order: the seasons,
				// the manga it adapts, and what it shares with the rest of the vault.
				detachPanelsExcept(anchor, ["seasons", "manga", "main", "soundtrack"]);
				applySeasonsPanel(context, anchor, file, frontmatter ?? {});
				if (plan.manga) applyMangaPanel(context, anchor, file, frontmatter ?? {});
				else panelOf(anchor, "manga")?.detach();
				applyConnections(context, anchor, file, scan);
				return;
			case "manga":
				detachPanelsExcept(anchor, ["manga", "soundtrack"]);
				applyMangaPanel(context, anchor, file, frontmatter ?? {});
				return;
			case "mangaka":
				detachPanelsExcept(anchor, ["main"]);
				applyMangagraphy(context, anchor, file.path, plan.names, scan);
				return;
			case "none":
				detachPanelsExcept(anchor, ["soundtrack"]);
				return;
			case "person":
				// Their films, then the series they created, each in its own box.
				detachPanelsExcept(anchor, ["main", "shows"]);
				applyFilmography(context, anchor, file.path, plan.names, scan);
				return;
			case "work":
				detachPanelsExcept(anchor, ["main", "soundtrack"]);
				applyConnections(context, anchor, file, scan);
				return;
			case "artist":
				// Their albums, then what they scored, each in its own box.
				detachPanelsExcept(anchor, ["main", "shows"]);
				applyDiscography(context, anchor, file, plan.names, scan);
				applyScores(context, anchor, file, plan.names, scan);
				return;
			case "album":
				detachPanelsExcept(anchor, ["main"]);
				applyTracklist(context, anchor, file, frontmatter ?? {}, scan);
				return;
			case "song":
				detachPanelsExcept(anchor, ["main"]);
				applyLyricsPanel(context, anchor, file);
				return;
		}
	}
}

/** The element the panels are inserted immediately after. */
function findPanelsAnchor(view: MarkdownView): HTMLElement | null {
	const selector =
		view.getMode() === "preview" ? ".markdown-preview-sizer > .mod-header" : ".cm-sizer > .metadata-container";
	const anchor = view.contentEl.querySelector(selector);
	return anchor instanceof HTMLElement ? anchor : null;
}
