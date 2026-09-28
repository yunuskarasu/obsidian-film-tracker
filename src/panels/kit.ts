import { setIcon, type App, type TFile } from "obsidian";
import { parseWikilink } from "../note";
import type { LyricsState } from "../lyrics-service";
import type { FilmTrackerSettings } from "../settings";

/*
 * What every panel under a note's properties is made of: the box it lives
 * in, its collapsible heading, its buttons, links and progress bars. Each
 * panel's own module (manga-panel.ts, seasons-panel.ts, …) only decides what
 * goes in its box.
 */

export const CONNECTIONS_CLASS = "film-tracker-connections";
export const PROGRESS_CLASS = "film-tracker-progress";

/**
 * What the panels' and the poster's own controls do. A panel only renders
 * them and reports the click — every note is rewritten by `main.ts`, which
 * owns API access and every write to the vault. That includes the Read
 * checkbox: the same manga can sit on several Series notes, and `setRead`
 * updates them all.
 */
export interface MangaPanelActions {
	change: (file: TFile) => void;
	remove: (file: TFile) => void;
	addAdaptation: (file: TFile) => void;
	setRead: (file: TFile, read: boolean) => void;
	/** "+1 chapter" beside the Read checkbox — the same command the palette offers. */
	readChapter: (file: TFile) => void;
	/** The buttons under an anime, film or TV note's poster. */
	watchEpisode: (file: TFile) => void;
	watchedToday: (file: TFile) => void;
	/** "+1" on one season of a TV note, on the SEASONS panel. */
	watchSeason: (file: TFile, season: number) => void;
	/** That panel's own checkbox: a season watched in full, or back to nothing. */
	setSeasonWatched: (file: TFile, season: number, watched: boolean) => void;
	/** DISCOGRAPHY's own button: the artist's albums to pick one from. */
	addAlbumByArtist: (file: TFile) => void;
	/** "Change photo" under an artist's photo. */
	changePhoto: (file: TFile) => void;
	/** TRACKLIST's "+" beside a track: that one song's note. */
	addSong: (file: TFile, track: { disc: number | null; n: number; title: string }) => void;
	/** What the LYRICS panel shows for a song note — asking starts the lookup the first time. */
	lyricsState: (file: TFile) => LyricsState | null;
	/** "Copy lyrics into note". */
	copyLyrics: (file: TFile) => void;
	/** "Fetch again" and "Try again". */
	fetchLyricsAgain: (file: TFile) => void;
	/** "Wrong lyrics". */
	markLyricsWrong: (file: TFile) => void;
	/** SOUNDTRACK's own button: this work's soundtracks to pick one from. */
	findSoundtrack: (file: TFile) => void;
}

/** What a panel needs from the plugin to draw itself. */
export interface PanelContext {
	app: App;
	settings: () => FilmTrackerSettings;
	actions: MangaPanelActions;
}

/**
 * The panels a note can have, in the order they are drawn. A TV note can have
 * three of them — its seasons, its manga, then what it shares with the rest
 * of the vault — and a person note two, their films and their series, so each
 * keeps a box of its own. `main` is the single box every other note has.
 * An artist has DISCOGRAPHY in `main` and SCORES in `shows`. A film, a TV
 * series or an anime has its SOUNDTRACK last, below the rest.
 */
export const PANEL_SLOTS = ["seasons", "manga", "main", "shows", "soundtrack"] as const;
export type PanelSlot = (typeof PANEL_SLOTS)[number];

function panelClass(slot: PanelSlot): string {
	return `film-tracker-panel-${slot}`;
}

export function panelOf(anchor: HTMLElement, slot: PanelSlot): HTMLElement | null {
	const found = anchor.parentElement?.querySelector(`:scope > .${panelClass(slot)}`);
	return found instanceof HTMLElement ? found : null;
}

/** Takes away every panel this note doesn't have, so nothing is left behind from the last one. */
export function detachPanelsExcept(anchor: HTMLElement, kept: PanelSlot[]): void {
	for (const slot of PANEL_SLOTS) {
		if (!kept.includes(slot)) panelOf(anchor, slot)?.detach();
	}
}

/**
 * The box for one slot, created where its order says: after the last panel
 * that comes before it, or right after the properties when it is the first.
 */
export function ensurePanel(anchor: HTMLElement, slot: PanelSlot): HTMLElement {
	const existing = panelOf(anchor, slot);
	if (existing !== null) return existing;

	const panel = createDiv({ cls: `${CONNECTIONS_CLASS} ${panelClass(slot)}` });
	let after: HTMLElement = anchor;
	for (const before of PANEL_SLOTS.slice(0, PANEL_SLOTS.indexOf(slot))) {
		after = panelOf(anchor, before) ?? after;
	}
	after.insertAdjacentElement("afterend", panel);
	return panel;
}

/**
 * Whether `panel` already shows exactly what `signature` describes. A
 * refresh runs on every metadata change in the vault; rebuilding a panel
 * that hasn't changed would make it flicker and would drop whatever the
 * user is hovering or clicking — the Read checkbox, a link's preview.
 */
export function unchanged(panel: HTMLElement, signature: string): boolean {
	if (panel.dataset.filmTrackerSignature === signature) return true;
	panel.dataset.filmTrackerSignature = signature;
	return false;
}

/**
 * Empties a panel to draw it again, with its heading, unless it already
 * shows what `signature` describes — then it is left alone and `false` comes
 * back. Collapse state lives only on the panel's own class, so it survives
 * as long as the panel element itself is reused (see `ensurePanel`), the
 * same way Obsidian's Properties widget keeps its own collapsed state.
 */
export function redrawPanel(panel: HTMLElement, signature: string, heading: string, suffix?: string): boolean {
	if (unchanged(panel, signature)) return false;

	const wasCollapsed = panel.hasClass("is-collapsed");
	panel.empty();
	panel.toggleClass("is-collapsed", wasCollapsed);
	renderPanelHeading(panel, heading, suffix);
	return true;
}

function renderPanelHeading(panel: HTMLElement, label: string, suffix?: string): void {
	const heading = panel.createDiv({ cls: "film-tracker-connections-heading" });
	const collapseIcon = heading.createSpan({ cls: "film-tracker-connections-collapse-icon" });
	setIcon(collapseIcon, "right-triangle");
	// Uppercased in markup rather than via CSS text-transform: the CSS
	// transform runs under the vault's locale, and Turkish uppercases "i"
	// to "İ" (dotted), turning "Connections" into "CONNECTİONS".
	heading.createSpan({ text: label });
	if (suffix !== undefined) {
		heading.createSpan({ cls: "film-tracker-connections-progress", text: suffix });
	}
	heading.addEventListener("click", () => {
		panel.toggleClass("is-collapsed", !panel.hasClass("is-collapsed"));
	});
}

export function renderAction(container: HTMLElement, label: string, onClick: () => void): void {
	const button = container.createEl("button", {
		cls: "film-tracker-manga-action",
		text: label,
	});
	button.addEventListener("click", (event) => {
		event.preventDefault();
		onClick();
	});
}

/** A link to another note, opened the way Obsidian's own links are — Ctrl/Cmd for a new tab. */
export function renderPathLink(app: App, container: HTMLElement, text: string, path: string, sourcePath: string): void {
	const link = container.createEl("a", {
		cls: "internal-link film-tracker-connections-link",
		text,
		href: path,
	});
	link.addEventListener("click", (event) => {
		event.preventDefault();
		void app.workspace.openLinkText(path, sourcePath, event.ctrlKey || event.metaKey);
	});
}

/** Renders a name as a clickable internal link when its wikilink currently resolves, plain text otherwise. */
export function renderNameOrLink(app: App, container: HTMLElement, raw: string, sourcePath: string): void {
	const linkpath = parseWikilink(raw);
	const target = linkpath === null ? null : app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
	if (target === null) {
		container.createSpan({ text: linkpath ?? raw });
		return;
	}
	renderPathLink(app, container, target.basename, target.path, sourcePath);
}

export function resolveLinkedFile(app: App, linkpath: string | null, sourcePath: string): TFile | null {
	if (linkpath === null) return null;
	return app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
}

/**
 * How far through something the note is: "48 / 148 episodes", or "48
 * episodes" while the length isn't known. `null` when nothing has been
 * watched or read yet — an untouched note shows no bar at all.
 */
export function progressLabel(done: number, total: number | null, noun: string): string | null {
	if (done <= 0) return null;
	if (total === null) return `${done} ${done === 1 ? noun : `${noun}s`}`;
	return `${done} / ${total} ${noun}s`;
}

/** The share of the bar to fill, as a percentage, or `null` when the length is unknown. */
export function progressPercent(done: number, total: number | null): string | null {
	if (total === null || total <= 0) return null;
	return `${Math.round((Math.min(done, total) / total) * 100)}%`;
}

/**
 * The count, with a filled bar under it where the length is known. The fill
 * is a CSS variable rather than an inline width, so the styling stays in
 * styles.css where a theme can reach it.
 */
export function renderProgressBar(container: HTMLElement, label: string, percent: string | null): void {
	container.createDiv({ cls: "film-tracker-progress-label", text: label });
	if (percent === null) return;
	const track = container.createDiv({ cls: "film-tracker-progress-track" });
	track.createDiv({ cls: "film-tracker-progress-fill" }).setCssProps({ "--film-tracker-progress": percent });
}
