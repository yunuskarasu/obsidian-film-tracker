import type { TFile } from "obsidian";
import { formatMediaType, formatStatus } from "../mal";
import { parseLinkTarget, parseWikilink } from "../note";
import {
	PROGRESS_CLASS,
	ensurePanel,
	progressLabel,
	progressPercent,
	redrawPanel,
	renderAction,
	renderNameOrLink,
	renderProgressBar,
	resolveLinkedFile,
	type PanelContext,
} from "./kit";

interface MangaPanelInfo {
	title: string;
	mediaType: string | null;
	year: number | null;
	endYear: number | null;
	status: string | null;
	chapters: number | null;
	chaptersRead: number | null;
	volumes: number | null;
	mangakaRaw: string[];
	posterLinkpath: string | null;
	read: boolean;
	readDate: string | null;
}

/**
 * The years a work ran: "1990–1994", or just the one year when it is still
 * running, finished inside that year, or MAL only knows the one.
 */
function years(year: number | null, endYear: number | null): string | null {
	if (year === null) return endYear === null ? null : String(endYear);
	return endYear === null || endYear === year ? String(year) : `${year}–${endYear}`;
}

/**
 * The line under the MANGA panel's title: "Manga · 1998 · Currently
 * publishing · 37 volumes · 390 chapters". Whatever MAL left blank is left
 * out. The panel is the only place these show, since the nested `manga`
 * property is hidden (see `MANGA_HOST_CLASS` in film-note-layout.ts).
 */
export function mangaSummary(
	info: Pick<MangaPanelInfo, "mediaType" | "year" | "endYear" | "status" | "volumes" | "chapters">,
): string {
	const count = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;
	return [
		formatMediaType(info.mediaType),
		years(info.year, info.endYear),
		formatStatus(info.status),
		info.volumes === null ? null : count(info.volumes, "volume"),
		info.chapters === null ? null : count(info.chapters, "chapter"),
	]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

/** Reads the `manga` nested block straight from parsed frontmatter — no raw-text parsing needed for rendering. */
function readMangaPanelInfo(frontmatter: Record<string, unknown>): MangaPanelInfo | null {
	const manga = frontmatter.manga;
	if (typeof manga !== "object" || manga === null) return null;
	const block = manga as Record<string, unknown>;
	if (typeof block.mal_id !== "number") return null;

	return {
		title: typeof block.title === "string" ? block.title : "",
		mediaType: typeof block.media_type === "string" ? block.media_type : null,
		year: typeof block.year === "number" ? block.year : null,
		endYear: typeof block.end_year === "number" ? block.end_year : null,
		status: typeof block.status === "string" ? block.status : null,
		chapters: typeof block.chapters === "number" ? block.chapters : null,
		chaptersRead: typeof block.chapters_read === "number" ? block.chapters_read : null,
		volumes: typeof block.volumes === "number" ? block.volumes : null,
		mangakaRaw: Array.isArray(block.mangaka)
			? block.mangaka.filter((item): item is string => typeof item === "string")
			: [],
		posterLinkpath: parseLinkTarget(block.poster),
		read: block.read === true,
		readDate: typeof block.read_date === "string" && block.read_date.trim() !== "" ? block.read_date : null,
	};
}

/** The MANGA panel: the manga a Series or TV note carries, its reading, and what can be done with it. */
export function applyMangaPanel(
	context: PanelContext,
	anchor: HTMLElement,
	file: TFile,
	frontmatter: Record<string, unknown>,
): void {
	const { app, actions } = context;
	const info = readMangaPanelInfo(frontmatter);
	if (info === null) return;

	const panel = ensurePanel(anchor, "manga");
	// What the panel shows also depends on which links resolve right now:
	// the poster, and a mangaka whose note has just been created.
	const posterFile = resolveLinkedFile(app, info.posterLinkpath, file.path);
	const mangakaTargets = info.mangakaRaw.map((raw) => {
		const linkpath = parseWikilink(raw);
		return linkpath === null ? null : (resolveLinkedFile(app, linkpath, file.path)?.path ?? null);
	});
	const signature = JSON.stringify(["manga", file.path, info, posterFile?.path ?? null, mangakaTargets]);
	if (!redrawPanel(panel, signature, "MANGA")) return;

	const body = panel.createDiv({ cls: "film-tracker-connections-list film-tracker-manga-body" });

	if (posterFile !== null) {
		body.createDiv({ cls: "film-tracker-manga-poster" }).createEl("img", {
			attr: { src: app.vault.getResourcePath(posterFile), alt: `${info.title} poster` },
		});
	}

	const details = body.createDiv({ cls: "film-tracker-manga-details" });
	if (info.title !== "") {
		details.createDiv({ text: info.title, cls: "film-tracker-manga-title" });
	}

	const summary = mangaSummary(info);
	if (summary !== "") {
		details.createDiv({ text: summary, cls: "film-tracker-connections-shared" });
	}

	if (info.mangakaRaw.length > 0) {
		const mangaka = details.createDiv({ cls: "film-tracker-manga-mangaka" });
		info.mangakaRaw.forEach((raw, index) => {
			if (index > 0) mangaka.appendText(", ");
			renderNameOrLink(app, mangaka, raw, file.path);
		});
	}

	const chapterLabel = progressLabel(info.chaptersRead ?? 0, info.chapters, "chapter");
	if (chapterLabel !== null) {
		const progress = details.createDiv({ cls: PROGRESS_CLASS });
		renderProgressBar(progress, chapterLabel, progressPercent(info.chaptersRead ?? 0, info.chapters));
	}

	const readRow = details.createDiv({ cls: "film-tracker-manga-read-row" });
	const readToggle = readRow.createEl("label", { cls: "film-tracker-manga-read" });
	const checkbox = readToggle.createEl("input", { attr: { type: "checkbox" } });
	checkbox.checked = info.read;
	readToggle.appendText(info.read && info.readDate !== null ? ` Read on ${info.readDate}` : " Read");
	checkbox.addEventListener("change", () => {
		actions.setRead(file, checkbox.checked);
	});

	// Nothing left to count once the last chapter is in.
	const chaptersLeft = info.chapters === null || (info.chaptersRead ?? 0) < info.chapters;
	if (!info.read && chaptersLeft) {
		renderAction(readRow, "+1 chapter", () => actions.readChapter(file));
	}

	const buttons = details.createDiv({ cls: "film-tracker-manga-actions" });
	renderAction(buttons, "Add adaptation", () => actions.addAdaptation(file));
	renderAction(buttons, "Change manga", () => actions.change(file));
	renderAction(buttons, "Remove manga", () => actions.remove(file));
}
