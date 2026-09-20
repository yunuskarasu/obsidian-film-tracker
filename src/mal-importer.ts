import { Notice, type App, type TFile } from "obsidian";
import type { AnimeActions, ImportedProgress, NoteResult } from "./anime-actions";
import { animeProgressOf, markAnimeWatched } from "./anime-note";
import { writeImportReport, type ImportFailure } from "./import-report";
import type { ImportProgress } from "./letterboxd-importer";
import {
	formatMediaType,
	type AnimeMetadata,
	type MalClient,
	type MalListEntry,
	type MalListPage,
	type MangaMetadata,
} from "./mal";
import type { VaultNotes } from "./vault-notes";

/** Kept well under MyAnimeList's rate limit while an import works through a long list. */
const IMPORT_DELAY_MS = 250;

/** What a list entry says about how far its owner got — see `ImportedProgress`. */
function progressOf(entry: MalListEntry<unknown>): ImportedProgress {
	return { count: entry.progress, date: entry.finishDate };
}

/**
 * The shelves the dialog offers. MAL names the same shelf differently for
 * anime and manga ("watching" against "reading"), so each choice carries
 * every value it stands for.
 */
export const LIST_STATUSES: { label: string; values: string[]; on: boolean }[] = [
	{ label: "Completed", values: ["completed"], on: true },
	{ label: "Watching or reading", values: ["watching", "reading"], on: true },
	{ label: "On hold", values: ["on_hold"], on: false },
	{ label: "Dropped", values: ["dropped"], on: false },
	{ label: "Plan to watch or read", values: ["plan_to_watch", "plan_to_read"], on: false },
];

/** What to take from someone's list: which of their two lists, and which shelves. */
export interface MalListSelection {
	anime: boolean;
	manga: boolean;
	/** MAL's own status values, from `LIST_STATUSES`. */
	statuses: string[];
}

type Outcome = "added" | "updated" | "skipped";

interface Tally {
	added: number;
	updated: number;
	skipped: number;
	failures: ImportFailure[];
}

/** Something that stops the whole import rather than just one entry. */
class ImportStopped extends Error {}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Whether a note's manga side is already marked read. */
function isRead(frontmatter: Record<string, unknown> | undefined): boolean {
	const manga: unknown = frontmatter?.manga;
	return typeof manga === "object" && manga !== null && (manga as Record<string, unknown>).read === true;
}

/**
 * Import from MyAnimeList: a note for everything on someone's public list,
 * with what they have completed marked watched or read. Nothing is matched
 * by title — the list carries MAL's own ids — so an entry already in the
 * vault is recognized exactly, and the only thing that can go wrong for one
 * is the note itself.
 */
export class MalListImporter {
	private readonly app: App;
	private readonly notes: VaultNotes;
	private readonly anime: AnimeActions;
	private active = false;

	constructor(app: App, notes: VaultNotes, anime: AnimeActions) {
		this.app = app;
		this.notes = notes;
		this.anime = anime;
	}

	/** Whether an import is under way. Only one runs at a time, as with the Letterboxd import. */
	get running(): boolean {
		return this.active;
	}

	async run(
		client: MalClient,
		userName: string,
		selection: MalListSelection,
		progress: ImportProgress,
	): Promise<void> {
		if (this.active) throw new Error("A MyAnimeList import is already running.");
		this.active = true;
		try {
			await this.importLists(client, userName, selection, progress);
		} finally {
			this.active = false;
		}
	}

	private async importLists(
		client: MalClient,
		userName: string,
		selection: MalListSelection,
		progress: ImportProgress,
	): Promise<void> {
		const tally: Tally = { added: 0, updated: 0, skipped: 0, failures: [] };
		let stopped: string | null = null;

		try {
			if (selection.anime) {
				await this.walk(progress, selection, tally, "Anime", (offset) => client.animeListPage(userName, offset), (entry) =>
					this.addAnime(client, entry),
				);
			}
			if (selection.manga) {
				await this.walk(progress, selection, tally, "Manga", (offset) => client.mangaListPage(userName, offset), (entry) =>
					this.addManga(client, entry),
				);
			}
		} catch (error) {
			stopped = error instanceof Error ? error.message : "The list could not be read.";
		}

		const cancelled = progress.isCancelled();
		progress.close();

		await writeImportReport(this.app, this.notes, {
			intro: `Imported from ${userName}'s MyAnimeList.`,
			counts: [
				["Added", tally.added],
				["Updated (marked watched or read)", tally.updated],
				["Skipped (already in your vault)", tally.skipped],
				["Left out", tally.failures.length],
			],
			detailColumn: "Type",
			failures: tally.failures,
		});

		if (stopped !== null) {
			new Notice(stopped);
			return;
		}

		const left = tally.failures.length === 0 ? "" : `, ${tally.failures.length} left out`;
		new Notice(
			`Added ${tally.added}, updated ${tally.updated}, skipped ${tally.skipped}${left}` +
				`${cancelled ? " (cancelled)" : ""}.`,
		);
	}

	/**
	 * One list, page by page: every entry on a shelf the user picked, until
	 * the list ends or the dialog is closed. An entry that can't be written
	 * goes to the report and the import carries on; only an `ImportStopped`
	 * — a folder setting that names a file — ends the run.
	 */
	private async walk<T extends { title: string; malId: number; mediaType: string | null }>(
		progress: ImportProgress,
		selection: MalListSelection,
		tally: Tally,
		kind: "Anime" | "Manga",
		page: (offset: number) => Promise<MalListPage<T>>,
		importOne: (entry: MalListEntry<T>) => Promise<Outcome>,
	): Promise<void> {
		let offset: number | null = 0;
		let seen = 0;

		while (offset !== null && !progress.isCancelled()) {
			const listPage: MalListPage<T> = await page(offset);
			for (const entry of listPage.entries) {
				if (progress.isCancelled()) return;
				if (!selection.statuses.includes(entry.listStatus ?? "")) continue;

				seen += 1;
				progress.setStatus(`${kind} ${seen}: ${entry.work.title}`);
				try {
					const outcome = await importOne(entry);
					if (outcome === "added") {
						tally.added += 1;
						// Only a new note goes to MAL for its poster.
						await delay(IMPORT_DELAY_MS);
					} else if (outcome === "updated") {
						tally.updated += 1;
					} else {
						tally.skipped += 1;
					}
				} catch (error) {
					if (error instanceof ImportStopped) throw error;
					tally.failures.push({
						name: entry.work.title,
						detail: formatMediaType(entry.work.mediaType) ?? kind,
						reason: error instanceof Error ? error.message : "Unexpected error.",
					});
				}
			}
			offset = listPage.nextOffset;
		}
	}

	private async addAnime(client: MalClient, entry: MalListEntry<AnimeMetadata>): Promise<Outcome> {
		const completed = entry.listStatus === "completed";
		const existing = this.notes.findNote({ kind: "anime", malId: entry.work.malId });
		if (existing !== null) return this.tickWatched(existing, entry, completed);

		const anime = await this.filledIn(entry.work, (id) => client.getAnime(id));
		return this.added(
			await this.anime.createAnimeNote(client, anime, {
				watched: completed,
				open: false,
				progress: progressOf(entry),
			}),
			anime.title,
		);
	}

	private async addManga(client: MalClient, entry: MalListEntry<MangaMetadata>): Promise<Outcome> {
		const completed = entry.listStatus === "completed";
		const existing = this.notes.findNote({ kind: "manga", malId: entry.work.malId });
		if (existing !== null) {
			if (!completed || isRead(this.notes.frontmatterOf(existing))) return "skipped";
			// Read is kept in step across every note carrying this manga, with
			// the day the list says it was finished rather than today.
			await this.anime.syncMangaRead(existing, true, { date: entry.finishDate });
			return "updated";
		}

		const manga = await this.filledIn(entry.work, (id) => client.getManga(id));
		return this.added(
			await this.anime.createMangaNote(client, manga, {
				read: completed,
				open: false,
				progress: progressOf(entry),
			}),
			manga.title,
		);
	}

	/**
	 * The list is asked for each work's own fields, but MAL has been known to
	 * answer with the title alone. An entry that came back that thin is
	 * fetched on its own rather than written half empty.
	 */
	private async filledIn<T extends { malId: number; mediaType: string | null }>(
		work: T,
		fetch: (id: number) => Promise<T>,
	): Promise<T> {
		return work.mediaType === null ? fetch(work.malId) : work;
	}

	/** A note already in the vault: ticked as watched, with the list's own date and count, if the list says it's done. */
	private async tickWatched(
		note: TFile,
		entry: MalListEntry<AnimeMetadata>,
		completed: boolean,
	): Promise<Outcome> {
		if (!completed || this.notes.frontmatterOf(note)?.watched === true) return "skipped";
		const episodes = animeProgressOf(this.notes.frontmatterOf(note)).episodes;
		await this.notes.rewriteFrontmatter(note, (content) =>
			markAnimeWatched(content, entry.finishDate, episodes),
		);
		return "updated";
	}

	private added(result: NoteResult, title: string): Outcome {
		if (result === "no-folder") {
			throw new ImportStopped("The anime/manga folder setting names a file, not a folder.");
		}
		if (result === "conflict") throw new Error(`A note of your own is already called "${title}".`);
		return "added";
	}
}
