import type { App, MarkdownView, TFile } from "obsidian";
import { animeProgressOf } from "../anime-note";
import { parseLinkTarget } from "../note";
import { listenProgressOf } from "../music-note";
import { classifyNote, hasAnime } from "../note-kind";
import { tvProgressOf } from "../tv-note";
import {
	PROGRESS_CLASS,
	progressLabel,
	progressPercent,
	renderAction,
	renderProgressBar,
	type MangaPanelActions,
} from "./kit";

export const POSTER_CLASS = "film-tracker-poster";
export const LAYOUT_CLASS = "film-tracker-layout";
const POSTER_PATH_ATTR = "data-film-tracker-poster";
const WATCHED = "Watched today";

interface Poster {
	file: TFile;
	alt: string;
}

/**
 * What to draw under a note's poster: how far through the episodes it is, and
 * which buttons are worth offering. `null` for a note this doesn't apply to —
 * a director, a mangaka, a manga-only Series note.
 */
export interface WatchControls {
	label: string | null;
	percent: string | null;
	canWatchEpisode: boolean;
	canMarkWatched: boolean;
	/** The second button's words: an album is listened to, everything else watched. */
	markText: string;
	/** An artist's photo can be swapped for another one on offer. */
	canChangePhoto: boolean;
}

export function watchControlsFor(frontmatter: Record<string, unknown> | undefined): WatchControls | null {
	const kind = classifyNote(frontmatter);
	if (kind === null) return null;

	const watched = frontmatter?.watched === true;
	if (kind.kind === "film") {
		return { label: null, percent: null, canWatchEpisode: false, canMarkWatched: !watched, markText: WATCHED, canChangePhoto: false };
	}
	if (kind.kind === "artist") {
		return { label: null, percent: null, canWatchEpisode: false, canMarkWatched: false, markText: WATCHED, canChangePhoto: true };
	}
	if (kind.kind === "album") {
		// Listened to again and again: the button stays, and counts each time.
		const { count } = listenProgressOf(frontmatter);
		const label = count === 0 ? null : count === 1 ? "Listened once" : `Listened ${count} times`;
		return { label, percent: null, canWatchEpisode: false, canMarkWatched: true, markText: "Listened today", canChangePhoto: false };
	}
	if (kind.kind === "tv") {
		const progress = tvProgressOf(frontmatter);
		const count = progressLabel(progress.watched, progress.episodes, "episode");
		return {
			label: count === null ? null : [seasonAndEpisode(progress.position), count].filter((part) => part !== null).join(" · "),
			percent: progressPercent(progress.watched, progress.episodes),
			canWatchEpisode: progress.more,
			canMarkWatched: !watched,
			markText: WATCHED,
			canChangePhoto: false,
		};
	}
	if (!hasAnime(kind)) return null;

	const progress = animeProgressOf(frontmatter);
	const complete = progress.episodes !== null && progress.watched >= progress.episodes;
	return {
		label: progressLabel(progress.watched, progress.episodes, "episode"),
		percent: progressPercent(progress.watched, progress.episodes),
		canWatchEpisode: !complete,
		canMarkWatched: !watched,
		markText: WATCHED,
		canChangePhoto: false,
	};
}

/**
 * The poster a note's own properties point at, or `null` for a note this
 * plugin doesn't own. Which notes those are is `classifyNote`'s answer and
 * nothing else: reading the id keys here meant a TV note — which carries
 * neither `tmdb_id` nor `mal_id` — never showed its poster at all.
 */
export function posterLinkpathOf(frontmatter: Record<string, unknown> | undefined): string | null {
	if (classifyNote(frontmatter) === null) return null;
	return parseLinkTarget(frontmatter?.poster);
}

/** Where a TV note stands, in the form a viewer counts in: "S3E6". */
export function seasonAndEpisode(position: { season: number; episode: number } | null): string | null {
	return position === null ? null : `S${position.season}E${position.episode}`;
}

/** The element the poster sits beside: the properties' own container, in either mode. */
export function findHost(view: MarkdownView): HTMLElement | null {
	const selector = view.getMode() === "preview" ? ".markdown-preview-sizer > .mod-header" : ".cm-sizer";
	const host = view.contentEl.querySelector(selector);
	return host instanceof HTMLElement ? host : null;
}

/**
 * Renders the poster next to the note's properties, or takes it away.
 *
 * The poster is added as a *sibling* of Obsidian's properties widget rather
 * than inside the note body, which is what makes a two-column grid possible:
 * in live preview the entire body lives in a single node, so nothing inside it
 * can be placed beside the properties. Obsidian's own widget is never moved,
 * wrapped or rebuilt — only a sibling and a class are added — so properties
 * stay fully editable.
 */
export function applyPoster(app: App, actions: MangaPanelActions, host: HTMLElement, file: TFile | null): void {
	const poster = file === null ? null : resolvePoster(app, file);
	if (poster === null) {
		host.removeClass(LAYOUT_CLASS);
		host.querySelector(`.${POSTER_CLASS}`)?.detach();
		return;
	}
	showPoster(app, host, poster);
	showWatchProgress(app, actions, host, file);
}

function resolvePoster(app: App, file: TFile): Poster | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (frontmatter === undefined) return null;

	const linkpath = posterLinkpathOf(frontmatter);
	if (linkpath === null) return null;

	const target = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
	if (target === null) return null;

	const title: unknown = frontmatter.title;
	return { file: target, alt: typeof title === "string" ? title : file.basename };
}

function showPoster(app: App, host: HTMLElement, poster: Poster): void {
	host.addClass(LAYOUT_CLASS);

	const existing = host.querySelector(`.${POSTER_CLASS}`);
	const container = existing instanceof HTMLElement ? existing : host.createDiv({ cls: POSTER_CLASS });

	if (container.getAttribute(POSTER_PATH_ATTR) === poster.file.path) return;

	container.setAttribute(POSTER_PATH_ATTR, poster.file.path);
	container.empty();
	container.createEl("img", {
		attr: { src: app.vault.getResourcePath(poster.file), alt: poster.alt },
	});
}

/**
 * The bar under a note's poster — "48 / 148 episodes" — and its buttons. It
 * lives inside the poster's own container, so it goes wherever the poster
 * goes and is taken away with it; a note that has watched nothing yet, or no
 * `episodes_watched` at all, shows no bar.
 */
function showWatchProgress(app: App, actions: MangaPanelActions, host: HTMLElement, file: TFile | null): void {
	const container = host.querySelector(`.${POSTER_CLASS}`);
	if (!(container instanceof HTMLElement)) return;

	const controls = file === null ? null : watchControlsFor(app.metadataCache.getFileCache(file)?.frontmatter);

	const existing = container.querySelector(`.${PROGRESS_CLASS}`);
	const nothingToShow =
		controls === null ||
		(controls.label === null && !controls.canWatchEpisode && !controls.canMarkWatched && !controls.canChangePhoto);
	if (file === null || controls === null || nothingToShow) {
		existing?.detach();
		return;
	}
	const signature = JSON.stringify(controls);
	if (existing instanceof HTMLElement && existing.dataset.filmTrackerSignature === signature) return;

	existing?.detach();
	const wrap = container.createDiv({ cls: PROGRESS_CLASS });
	wrap.dataset.filmTrackerSignature = signature;
	if (controls.label !== null) renderProgressBar(wrap, controls.label, controls.percent);

	const buttons = wrap.createDiv({ cls: "film-tracker-progress-actions" });
	if (controls.canWatchEpisode) {
		renderAction(buttons, "+1 episode", () => actions.watchEpisode(file));
	}
	if (controls.canMarkWatched) {
		renderAction(buttons, controls.markText, () => actions.watchedToday(file));
	}
	if (controls.canChangePhoto) {
		renderAction(buttons, "Change photo", () => actions.changePhoto(file));
	}
}
