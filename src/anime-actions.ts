import { Notice, type App, type TFile } from "obsidian";
import {
	animeProgressOf,
	buildAnimeFileName,
	buildAnimeNoteContent,
	markAnimeWatched,
	refreshAnimeFrontmatter,
	setAnimeProgress,
} from "./anime-note";
import type { ConfirmAnswer, ConfirmRequest } from "./confirm-modal";
import type { LinkChoice } from "./link-confirm-modal";
import type {
	AnimeMetadata,
	AnimeSearchResult,
	MalClient,
	MangaAuthor,
	MangaMetadata,
	MangaSearchResult,
	MangakaMetadata,
} from "./mal";
import {
	applyMangaBlock,
	mangaProgressOf,
	relinkMangaka,
	removeMangaBlock,
	replaceMangaBlock,
	setMangaProgress,
	setMangaRead,
	type MangaReadOptions,
} from "./manga-note";
import { buildMangakaFileName, buildMangakaNoteContent, refreshMangakaFrontmatter } from "./mangaka-note";
import { buildFileName, markWatched, parseWikilink, sanitizeFileName, today } from "./note";
import { isAnimeOnlySeries, isMangaOnlySeries } from "./note-kind";
import type { FilmTrackerSettings } from "./settings";
import {
	mangaPoster,
	noteName,
	reportFailures,
	topLevelPoster,
	type VaultNotes,
} from "./vault-notes";

function mangaRead(frontmatter: Record<string, unknown> | undefined): boolean {
	const manga: unknown = frontmatter?.manga;
	return typeof manga === "object" && manga !== null && (manga as Record<string, unknown>).read === true;
}

/**
 * How far someone else's list says they got, for a note being written from
 * it: the count, and the day they finished. Either can be missing — MAL only
 * has a finishing date where the user filled one in.
 */
export interface ImportedProgress {
	count: number | null;
	date: string | null;
}

/** The dialogs the anime and manga flows need, supplied by the plugin (see main.ts). */
export interface AnimeUi {
	/** "Link to this note?" — see `LinkConfirmModal`; `null` when dismissed. */
	confirmLink(
		workTitle: string,
		side: "anime" | "manga",
		noteName: string,
		alsoIn: string[],
	): Promise<LinkChoice | null>;
	/** Lets the user pick one of a manga's credited authors; closing it picks nobody. */
	pickMangaka(candidates: MangaAuthor[], onPick: (author: MangaAuthor) => void): void;
	/** Asks before something is deleted — see `ConfirmModal`. */
	confirm(request: ConfirmRequest): Promise<ConfirmAnswer>;
}

/** What a Series note's manga is called in a dialog: its title, or "the manga" when that's missing. */
function mangaTitleOf(frontmatter: Record<string, unknown> | undefined): string {
	const manga: unknown = frontmatter?.manga;
	const title: unknown = typeof manga === "object" && manga !== null ? (manga as Record<string, unknown>).title : null;
	return typeof title === "string" && title.trim() !== "" ? title : "the manga";
}

/** What became of a note a command was asked to create. */
export type NoteResult = "created" | "conflict" | "no-folder";

/** How a dialog says where a deleted file goes. */
const DELETED_FILES = `It's deleted the way Obsidian's "Deleted files" setting says.`;

/** Everything the plugin does with MyAnimeList: Series notes (anime and manga) and mangaka notes. */
export class AnimeActions {
	private readonly app: App;
	private readonly notes: VaultNotes;
	private readonly settings: () => FilmTrackerSettings;
	private readonly ui: AnimeUi;

	constructor(app: App, notes: VaultNotes, settings: () => FilmTrackerSettings, ui: AnimeUi) {
		this.app = app;
		this.notes = notes;
		this.settings = settings;
		this.ui = ui;
	}

	/** "Refresh anime/manga metadata from MAL": both sides of a Series note, or a mangaka note. */
	async refresh(client: MalClient, file: TFile): Promise<void> {
		const note = this.notes.kindOf(file);
		if (note?.kind === "mangaka") {
			await this.refreshMangaka(client, file, note.malId);
			return;
		}
		if (note?.kind !== "series") return;
		if (note.animeMalId !== null) await this.refreshAnime(client, file, note.animeMalId);
		if (note.mangaMalId !== null) await this.refreshManga(client, file, note.mangaMalId);
	}

	private async refreshAnime(client: MalClient, file: TFile, malId: number): Promise<void> {
		await reportFailures("refresh the anime", async () => {
			const anime = await client.getAnime(malId);
			const posterLink = await this.animePosterLinkIfMissing(client, anime, file);

			const previous = this.notes.frontmatterOf(file);
			const refreshed = await this.notes.rewriteFrontmatter(file, (content) =>
				refreshAnimeFrontmatter(content, anime, posterLink, previous),
			);
			if (refreshed) new Notice(`Refreshed ${anime.title}`);
		});
	}

	/**
	 * Only fills in a poster that is missing; an existing one is never
	 * replaced. When another note already carries this anime (one per manga
	 * it adapts), that note's poster file is reused instead of downloaded again.
	 */
	private async animePosterLinkIfMissing(
		client: MalClient,
		anime: AnimeMetadata,
		file: TFile,
	): Promise<string | null> {
		const current: unknown = this.notes.frontmatterOf(file)?.poster;
		if (typeof current === "string" && current.trim() !== "") return null;

		const others = this.notes.otherNotesWith({ kind: "anime", malId: anime.malId }, file);
		const shared = this.notes.sharedImage(others, topLevelPoster);
		if (shared !== null) return this.notes.imageLink(shared, file.path);

		const poster = await this.saveAnimePoster(client, anime, buildAnimeFileName(anime.title, anime.year), file.path);
		return poster === null ? null : this.notes.imageLink(poster, file.path);
	}

	private async saveAnimePoster(
		client: MalClient,
		anime: AnimeMetadata,
		baseName: string,
		notePath: string,
	): Promise<TFile | null> {
		const posterUrl = anime.posterUrl;
		if (!posterUrl) return null;
		return this.notes.saveImage(
			() => client.downloadImage(posterUrl),
			`${baseName}.jpg`,
			notePath,
			this.settings().animePosterFolder,
			"the anime poster",
		);
	}

	private async refreshManga(client: MalClient, file: TFile, mangaMalId: number): Promise<void> {
		await reportFailures("refresh the manga", async () => {
			const manga = await client.getManga(mangaMalId);
			const posterLink = await this.mangaPosterLinkIfMissing(client, manga, file);
			const isResolved = this.notes.isResolved(file.path);

			const previous = this.notes.frontmatterOf(file);
			const refreshed = await this.notes.rewriteFrontmatter(file, (content) =>
				applyMangaBlock(content, manga, posterLink, isResolved, previous),
			);
			if (refreshed) new Notice(`Refreshed ${manga.title}`);
		});
	}

	/**
	 * Only fills in a poster that is missing; an existing one is never
	 * replaced. The same manga on another Series note (another adaptation)
	 * lends its poster file, the way `animePosterLinkIfMissing` does.
	 */
	private async mangaPosterLinkIfMissing(
		client: MalClient,
		manga: MangaMetadata,
		file: TFile,
	): Promise<string | null> {
		const frontmatter = this.notes.frontmatterOf(file);
		const current = frontmatter === undefined ? undefined : mangaPoster(frontmatter);
		if (typeof current === "string" && current.trim() !== "") return null;
		return this.mangaPosterLink(client, manga, file, file.path);
	}

	/**
	 * A link, from `sourcePath`, to this manga's poster: another note's file
	 * when one already has it (`except` is the note being written, whose own
	 * poster doesn't count), otherwise a fresh download.
	 */
	private async mangaPosterLink(
		client: MalClient,
		manga: MangaMetadata,
		except: TFile | null,
		sourcePath: string,
	): Promise<string | null> {
		const others = this.notes.otherNotesWith({ kind: "manga", malId: manga.malId }, except);
		const shared = this.notes.sharedImage(others, mangaPoster);
		if (shared !== null) return this.notes.imageLink(shared, sourcePath);

		const posterUrl = manga.posterUrl;
		if (!posterUrl) return null;
		const poster = await this.notes.saveImage(
			() => client.downloadImage(posterUrl),
			`${sanitizeFileName(manga.title)} (Manga).jpg`,
			sourcePath,
			this.settings().animePosterFolder,
			"the manga poster",
		);
		return poster === null ? null : this.notes.imageLink(poster, sourcePath);
	}

	private async refreshMangaka(client: MalClient, file: TFile, mangakaMalId: number): Promise<void> {
		await reportFailures("refresh the mangaka", async () => {
			const mangaka = await client.getPerson(mangakaMalId);
			const photoLink = await this.mangakaPhotoLinkIfMissing(client, mangaka, file);

			const refreshed = await this.notes.rewriteFrontmatter(file, (content) =>
				refreshMangakaFrontmatter(content, mangaka, photoLink),
			);
			if (refreshed) new Notice(`Refreshed ${mangaka.name}`);
		});
	}

	/** Only fills in a photo that is missing; an existing one is never replaced. */
	private async mangakaPhotoLinkIfMissing(
		client: MalClient,
		mangaka: MangakaMetadata,
		file: TFile,
	): Promise<string | null> {
		const current: unknown = this.notes.frontmatterOf(file)?.poster;
		if (typeof current === "string" && current.trim() !== "") return null;

		const photo = await this.saveMangakaPhoto(client, mangaka, buildMangakaFileName(mangaka.name), file.path);
		return photo === null ? null : this.notes.imageLink(photo, file.path);
	}

	private async saveMangakaPhoto(
		client: MalClient,
		mangaka: MangakaMetadata,
		baseName: string,
		notePath: string,
	): Promise<TFile | null> {
		const photoUrl = mangaka.photoUrl;
		if (!photoUrl) return null;
		return this.notes.saveImage(
			() => client.downloadImage(photoUrl),
			`${baseName}.jpg`,
			notePath,
			this.settings().mangakaPhotoFolder,
			"the mangaka photo",
		);
	}

	/**
	 * Links an anime into a manga-only Series note. If the same anime is
	 * already on another note and ticked `watched` there, it arrives ticked:
	 * it's one anime, watched once.
	 */
	private async mergeAnimeIntoNote(client: MalClient, anime: AnimeMetadata, file: TFile): Promise<void> {
		const posterLink = await this.animePosterLinkIfMissing(client, anime, file);
		const watchedElsewhere = this.notes
			.otherNotesWith({ kind: "anime", malId: anime.malId }, file)
			.some((note) => this.notes.frontmatterOf(note)?.watched === true);
		const merged = await this.notes.rewriteFrontmatter(file, (content) => {
			const next = refreshAnimeFrontmatter(content, anime, posterLink);
			return watchedElsewhere ? markWatched(next) : next;
		});
		if (!merged) return;
		await this.notes.openNote(file);
		new Notice(`Linked ${anime.title} to ${file.basename}`);
	}

	/** Links a manga into an anime-only Series note, arriving `read` if another note already has it read. */
	private async mergeMangaIntoNote(client: MalClient, manga: MangaMetadata, file: TFile): Promise<void> {
		const posterLink = await this.mangaPosterLinkIfMissing(client, manga, file);
		const isResolved = this.notes.isResolved(file.path);
		const readElsewhere = this.isMangaReadElsewhere(manga.malId, file);
		const merged = await this.notes.rewriteFrontmatter(file, (content) => {
			const next = applyMangaBlock(content, manga, posterLink, isResolved);
			return readElsewhere ? setMangaRead(next, true) : next;
		});
		if (!merged) return;
		await this.notes.openNote(file);
		new Notice(`Linked ${manga.title} to ${file.basename}`);
	}

	private isMangaReadElsewhere(mangaMalId: number, file: TFile | null): boolean {
		return this.notes
			.otherNotesWith({ kind: "manga", malId: mangaMalId }, file)
			.some((note) => mangaRead(this.notes.frontmatterOf(note)));
	}

	/**
	 * Asks whether to link a work into `target` (see `LinkConfirmModal`).
	 * `null` means there's nothing more to do: the dialog was dismissed, or
	 * another note already pairs this anime with this manga — that note is
	 * opened instead, since a second copy of one pairing would only split its
	 * `watched` and `read` between two notes.
	 */
	private async confirmLink(
		target: TFile,
		pair: { animeMalId: number; mangaMalId: number },
		workTitle: string,
		side: "anime" | "manga",
		alsoIn: TFile[],
	): Promise<LinkChoice | null> {
		const paired = this.notes.findNote({ kind: "pair", ...pair });
		if (paired !== null) {
			new Notice(`Already linked in ${paired.basename}`);
			await this.notes.openNote(paired);
			return null;
		}
		return this.ui.confirmLink(
			workTitle,
			side,
			target.basename,
			alsoIn.map((note) => note.basename),
		);
	}

	/**
	 * Linking an anime to a manga is manual: the manga-only note open in the
	 * editor is the only candidate, nothing else in the vault is searched or
	 * guessed at, and the user confirms it. Linking is decided before the
	 * duplicate check, because the same anime may rightly sit on more than
	 * one Series note — one per manga it adapts. Only a note of its own is
	 * refused when the anime is already in the vault.
	 */
	async addAnime(client: MalClient, result: AnimeSearchResult): Promise<void> {
		await reportFailures("add the anime", async () => {
			const anime = await client.getAnime(result.id);

			const target = this.notes.visibleNote();
			const targetKind = target === null ? null : this.notes.kindOf(target);
			if (target !== null && isMangaOnlySeries(targetKind)) {
				const pair = { animeMalId: anime.malId, mangaMalId: targetKind.mangaMalId };
				const others = this.notes.findNotes({ kind: "anime", malId: anime.malId });
				const choice = await this.confirmLink(target, pair, anime.title, "anime", others);
				if (choice === null) return;
				if (choice === "link") {
					await this.mergeAnimeIntoNote(client, anime, target);
					return;
				}
			}

			const existing = this.notes.findNote({ kind: "anime", malId: anime.malId });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.notes.openNote(existing);
				return;
			}

			await this.createAnimeNote(client, anime);
		});
	}

	/**
	 * `manga` is what Add adaptation passes: the new note gets that manga's
	 * block as well, with its poster reused from the note the adaptation was
	 * added from and `read` in step with it. The anime's own poster and
	 * `watched` follow the same rule when the anime is already on another
	 * note (it adapts more than one manga).
	 */
	/**
	 * A Series note for an anime, with a manga's block in it when one is
	 * given. `open` is what a list import turns off: it wants the note
	 * written, not opened and announced one by one.
	 */
	async createAnimeNote(
		client: MalClient,
		anime: AnimeMetadata,
		options: {
			manga?: MangaMetadata | null;
			watched?: boolean;
			open?: boolean;
			progress?: ImportedProgress;
		} = {},
	): Promise<NoteResult> {
		const manga = options.manga ?? null;
		const open = options.open !== false;

		const target = await this.notes.newNotePath(this.settings().animeFolder, [
			buildAnimeFileName(anime.title, anime.year),
		]);
		if (target === null) return "no-folder";
		if ("conflict" in target) {
			if (open) await this.notes.openConflict(target.conflict);
			return "conflict";
		}
		const notePath = target.path;

		const sameAnime = this.notes.findNotes({ kind: "anime", malId: anime.malId });
		const poster =
			this.notes.sharedImage(sameAnime, topLevelPoster) ??
			(await this.saveAnimePoster(client, anime, noteName(notePath), notePath));
		const posterLink = poster ? this.notes.imageLink(poster, notePath) : null;

		let content = buildAnimeNoteContent(anime, posterLink);
		const progress = options.progress;
		if (options.watched === true) {
			// Straight off someone's list: their own finishing date, not today's.
			content = markAnimeWatched(content, progress?.date ?? null, anime.episodes);
		} else if (sameAnime.some((note) => this.notes.frontmatterOf(note)?.watched === true)) {
			content = markWatched(content);
		} else if (progress?.count != null) {
			content = setAnimeProgress(content, progress.count, anime.episodes, progress.date ?? null);
		}
		if (manga !== null) {
			const mangaPosterLink = await this.mangaPosterLink(client, manga, null, notePath);
			content = applyMangaBlock(content, manga, mangaPosterLink, this.notes.isResolved(notePath));
			if (this.isMangaReadElsewhere(manga.malId, null)) content = setMangaRead(content, true);
		}

		const note = await this.app.vault.create(notePath, content);
		if (!open) return "created";
		await this.notes.openNote(note);

		if (manga !== null) {
			new Notice(`Added ${anime.title} as another adaptation of ${manga.title}`);
		} else if (poster) {
			new Notice(`Added ${anime.title}`);
		} else if (anime.posterUrl) {
			new Notice(`Added ${anime.title}, but the poster could not be downloaded.`);
		} else {
			new Notice(`Added ${anime.title}. MyAnimeList has no poster for this anime.`);
		}
		return "created";
	}

	/**
	 * Manual in exactly the same way as `addAnime`: the anime-only note open
	 * in the editor is the only link target, confirmed by the user, and
	 * decided before the duplicate check — one manga has as many Series notes
	 * as it has adaptations.
	 */
	async addManga(client: MalClient, result: MangaSearchResult): Promise<void> {
		await reportFailures("add the manga", async () => {
			const manga = await client.getManga(result.id);

			const target = this.notes.visibleNote();
			const targetKind = target === null ? null : this.notes.kindOf(target);
			if (target !== null && isAnimeOnlySeries(targetKind)) {
				const pair = { animeMalId: targetKind.animeMalId, mangaMalId: manga.malId };
				const others = this.notes.findNotes({ kind: "manga", malId: manga.malId });
				const choice = await this.confirmLink(target, pair, manga.title, "manga", others);
				if (choice === null) return;
				if (choice === "link") {
					await this.mergeMangaIntoNote(client, manga, target);
					return;
				}
			}

			const existing = this.notes.findNote({ kind: "manga", malId: manga.malId });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.notes.openNote(existing);
				return;
			}

			await this.createMangaNote(client, manga);
		});
	}

	/**
	 * A manga-only note keeps its plain title — anime of any year can be
	 * linked into it later — and takes the year only when another work
	 * already holds that name (a light novel and its manga often share one).
	 */
	async createMangaNote(
		client: MalClient,
		manga: MangaMetadata,
		options: { read?: boolean; open?: boolean; progress?: ImportedProgress } = {},
	): Promise<NoteResult> {
		const open = options.open !== false;

		const names = [sanitizeFileName(manga.title), buildFileName(manga.title, manga.year)];
		const target = await this.notes.newNotePath(this.settings().animeFolder, [...new Set(names)]);
		if (target === null) return "no-folder";
		if ("conflict" in target) {
			if (open) await this.notes.openConflict(target.conflict);
			return "conflict";
		}
		const notePath = target.path;

		const posterLink = await this.mangaPosterLink(client, manga, null, notePath);
		let content = applyMangaBlock("---\n---\n", manga, posterLink, this.notes.isResolved(notePath));
		const progress = options.progress;
		if (options.read === true) {
			content = setMangaRead(content, true, { date: progress?.date ?? null, chapters: manga.chapters });
		} else if (this.isMangaReadElsewhere(manga.malId, null)) {
			content = setMangaRead(content, true, { date: null });
		} else if (progress?.count != null) {
			content = setMangaProgress(content, progress.count, manga.chapters, progress.date ?? null);
		}
		const note = await this.app.vault.create(notePath, content);
		if (!open) return "created";
		await this.notes.openNote(note);

		if (posterLink) {
			new Notice(`Added ${manga.title}`);
		} else if (manga.posterUrl) {
			new Notice(`Added ${manga.title}, but the poster could not be downloaded.`);
		} else {
			new Notice(`Added ${manga.title}. MyAnimeList has no poster for this manga.`);
		}
		return "created";
	}

	/**
	 * "Add adaptation" on the MANGA panel: pairs this note's manga with
	 * another anime in one step — a remake, another series, a film. The anime
	 * keeps a single note where it can: its existing anime-only note gets the
	 * manga. Failing that, a manga-only note takes the anime in, and anything
	 * else gets a new Series note for the pairing.
	 */
	async addAdaptation(
		client: MalClient,
		result: AnimeSearchResult,
		source: TFile,
		mangaMalId: number,
	): Promise<void> {
		await reportFailures("add the adaptation", async () => {
			const anime = await client.getAnime(result.id);

			const paired = this.notes.findNote({ kind: "pair", animeMalId: anime.malId, mangaMalId });
			if (paired !== null) {
				new Notice(`Already linked in ${paired.basename}`);
				await this.notes.openNote(paired);
				return;
			}

			const animeOnly = this.notes
				.findNotes({ kind: "anime", malId: anime.malId })
				.find((note) => isAnimeOnlySeries(this.notes.kindOf(note)));
			if (animeOnly === undefined && isMangaOnlySeries(this.notes.kindOf(source))) {
				await this.mergeAnimeIntoNote(client, anime, source);
				return;
			}

			const manga = await client.getManga(mangaMalId);
			if (animeOnly !== undefined) {
				await this.mergeMangaIntoNote(client, manga, animeOnly);
				return;
			}

			await this.createAnimeNote(client, anime, { manga });
		});
	}

	/**
	 * The MANGA panel's Read checkbox. The same manga can sit on several
	 * Series notes — one per adaptation — but it is read once, so `read` is
	 * set on every note that carries it, not only the one on screen.
	 */
	async syncMangaRead(file: TFile, read: boolean, options: MangaReadOptions = {}): Promise<void> {
		const progress = mangaProgressOf(this.notes.frontmatterOf(file));
		// Ticked by hand: finished today, and every chapter of it. An importer
		// knows better on both counts and says so itself.
		const date = options.date === undefined ? today() : options.date;
		const chapters = options.chapters === undefined ? progress.chapters : options.chapters;
		await this.writeToMangaNotes(file, (content) =>
			setMangaRead(content, read, { date, chapters: read ? chapters : null }),
		);
	}

	/**
	 * The same manga sits on one note per adaptation, and it is read once, so
	 * everything about the reading — `read`, the date, the chapter count — is
	 * written to every note carrying it, not only the one on screen.
	 */
	private async writeToMangaNotes(file: TFile, rewrite: (content: string) => string): Promise<void> {
		const mangaMalId = this.notes.seriesMangaIdOf(file);
		const notes = mangaMalId === null ? [] : this.notes.findNotes({ kind: "manga", malId: mangaMalId });
		if (!notes.some((note) => note.path === file.path)) notes.push(file);
		for (const note of notes) {
			await this.notes.rewriteFrontmatter(note, rewrite);
		}
	}

	/**
	 * "Mark as watched today" on the anime side: `watched`, and `watch_date`
	 * unless the note already has one. A note already ticked says so rather
	 * than pretending something happened.
	 */
	async markWatchedToday(file: TFile): Promise<void> {
		const progress = animeProgressOf(this.notes.frontmatterOf(file));
		const date = today();
		if (!(await this.notes.rewriteFrontmatter(file, (content) => markAnimeWatched(content, date, progress.episodes)))) {
			return;
		}
		new Notice(
			progress.done
				? `${file.basename} was already watched.`
				: `Marked ${file.basename} as watched today.`,
		);
	}

	/** "Mark as read today" on the manga side — `read` and `read_date`, across every note carrying it. */
	async markReadToday(file: TFile): Promise<void> {
		const progress = mangaProgressOf(this.notes.frontmatterOf(file));
		await this.syncMangaRead(file, true);
		new Notice(progress.done ? "That manga was already read." : "Marked the manga as read today.");
	}

	/**
	 * "Watch one more episode": `episodes_watched` up by one, and the last
	 * episode finishes the anime off (see `setAnimeProgress`).
	 */
	async watchOneMoreEpisode(file: TFile): Promise<void> {
		const progress = animeProgressOf(this.notes.frontmatterOf(file));
		if (progress.episodes !== null && progress.watched >= progress.episodes) {
			new Notice(`${file.basename} is already fully watched.`);
			return;
		}

		const watched = progress.watched + 1;
		const date = today();
		if (!(await this.notes.rewriteFrontmatter(file, (content) => setAnimeProgress(content, watched, progress.episodes, date)))) {
			return;
		}
		new Notice(`Episode ${watched}${progress.episodes === null ? "" : ` of ${progress.episodes}`} watched.`);
	}

	/** "Read one more chapter" — the manga side of `watchOneMoreEpisode`, written to every note carrying the manga. */
	async readOneMoreChapter(file: TFile): Promise<void> {
		const progress = mangaProgressOf(this.notes.frontmatterOf(file));
		if (progress.chapters !== null && progress.read >= progress.chapters) {
			new Notice("That manga is already fully read.");
			return;
		}

		const read = progress.read + 1;
		const date = today();
		await this.writeToMangaNotes(file, (content) => setMangaProgress(content, read, progress.chapters, date));
		new Notice(`Chapter ${read}${progress.chapters === null ? "" : ` of ${progress.chapters}`} read.`);
	}

	/**
	 * "Change manga" on the MANGA panel: pick a different manga for a Series
	 * note whose manga side turned out to be the wrong one. Only the `manga:`
	 * block is rewritten (see `replaceMangaBlock`) — the note is never
	 * recreated, so the anime side, its poster, `watched`, the body and every
	 * other property survive untouched.
	 */
	async changeManga(client: MalClient, result: MangaSearchResult, file: TFile): Promise<void> {
		await reportFailures("change the manga", async () => {
			const manga = await client.getManga(result.id);
			// Looked up while the old manga is still on the note: if nothing
			// else uses its poster, the user is offered to delete it after.
			const oldPoster = this.notes.unusedMangaPoster(file);
			// Not the poster already on the note — that is the previous (wrong)
			// manga's cover — but this manga's, reused from another note that
			// has it, or downloaded. Likewise `read` starts from the new manga's
			// state elsewhere, never the old one's.
			const posterLink = await this.mangaPosterLink(client, manga, file, file.path);
			const isResolved = this.notes.isResolved(file.path);
			const readElsewhere = this.isMangaReadElsewhere(manga.malId, file);

			const changed = await this.notes.rewriteFrontmatter(file, (content) => {
				const next = replaceMangaBlock(content, manga, posterLink, isResolved);
				return readElsewhere ? setMangaRead(next, true) : next;
			});
			if (!changed) return;
			new Notice(`Changed the manga to ${manga.title}`);

			if (oldPoster === null) return;
			const answer = await this.ui.confirm({
				title: "Delete the old poster?",
				message: `No note uses ${oldPoster.name} now that ${file.basename} has ${manga.title}. ${DELETED_FILES}`,
				confirmLabel: "Delete",
				cancelLabel: "Keep",
			});
			if (answer !== null) await this.notes.deleteFile(oldPoster);
		});
	}

	/**
	 * "Remove manga" on the MANGA panel: drops the `manga:` block and nothing
	 * else, once the user confirms. When no other note uses the manga's
	 * poster, the same dialog offers to delete it as well.
	 */
	async removeManga(file: TFile): Promise<void> {
		const frontmatter = this.notes.frontmatterOf(file);
		if (frontmatter?.manga === undefined) {
			new Notice("This note has no manga.");
			return;
		}

		const poster = this.notes.unusedMangaPoster(file);
		const rest = isMangaOnlySeries(this.notes.kindOf(file))
			? "The note has no anime, so what's left is a plain note the plugin no longer tracks."
			: "The anime and the rest of the note stay as they are.";
		const answer = await this.ui.confirm({
			title: "Remove the manga?",
			message: `This removes ${mangaTitleOf(frontmatter)} from ${file.basename}: only its manga properties are deleted. ${rest}`,
			confirmLabel: "Remove",
			option:
				poster === null
					? undefined
					: { name: "Also delete its poster", desc: `No other note uses ${poster.name}. ${DELETED_FILES}` },
		});
		if (answer === null) return;

		let removed = false;
		const readable = await this.notes.rewriteFrontmatter(file, (content) => {
			const next = removeMangaBlock(content);
			removed = next !== content;
			return next;
		});
		if (!readable) return;
		if (!removed) {
			new Notice("This note has no manga.");
			return;
		}

		const posterDeleted = answer.option && poster !== null && (await this.notes.deleteFile(poster));
		new Notice(
			posterDeleted
				? `Removed the manga and its poster from ${file.basename}`
				: `Removed the manga from ${file.basename}`,
		);
	}

	/**
	 * Unlike Add anime/Add manga/Add director, this never searches MAL live —
	 * MAL's API has no person-search endpoint (confirmed: `GET /people?q=...`
	 * returns 404), so the only source of a mangaka's id is a manga's own
	 * `authors` list. This is why the command only runs against the active
	 * note's own `manga.mal_id` rather than opening a search modal.
	 */
	async addMangaka(client: MalClient, file: TFile, mangaMalId: number): Promise<void> {
		await reportFailures("add the mangaka", async () => {
			const manga = await client.getManga(mangaMalId);
			const candidates = manga.mangaka.filter((author) => author.malId !== null);
			if (candidates.length === 0) {
				new Notice("No mangaka found for this manga.");
				return;
			}

			if (candidates.length === 1) {
				await this.processMangaka(candidates[0], file, client, manga);
				return;
			}

			this.ui.pickMangaka(candidates, (author) => {
				void this.processMangaka(author, file, client, manga);
			});
		});
	}

	/**
	 * Finds or creates the mangaka note for one candidate, then re-applies the
	 * manga block on the note Add Mangaka was run from — `manga` here is the
	 * same already-fetched data `addMangaka` used to build `candidates`,
	 * so this costs no extra MAL request. `formatNames`/`isResolved` (already
	 * exercised by every other manga write) picks up the mangaka note that
	 * now exists and turns that name into a `[[wikilink]]` in the same pass —
	 * `read`, the manga's own poster and any unknown sub-field are preserved
	 * exactly, the same guarantee `applyMangaBlock` always gives.
	 */
	async processMangaka(
		candidate: MangaAuthor,
		activeFile: TFile,
		client: MalClient,
		manga: MangaMetadata,
	): Promise<void> {
		const mangakaMalId = candidate.malId;
		if (mangakaMalId === null) return;

		const existing = this.notes.findNote({ kind: "mangaka", malId: mangakaMalId });
		if (existing !== null) {
			await this.refreshMangaka(client, existing, mangakaMalId);
			await this.notes.openNote(existing);
			await this.relinkMangakaOnActiveManga(activeFile, manga);
			return;
		}

		await reportFailures("add the mangaka", async () => {
			const mangaka = await client.getPerson(mangakaMalId);
			await this.createMangakaNote(client, mangaka);
			await this.relinkMangakaOnActiveManga(activeFile, manga);
			await this.relinkMangakaAcrossVault(mangaka.name, activeFile);
		});
	}

	private async relinkMangakaOnActiveManga(activeFile: TFile, manga: MangaMetadata): Promise<void> {
		const isResolved = this.notes.isResolved(activeFile.path);
		await this.notes.rewriteFrontmatter(activeFile, (content) =>
			applyMangaBlock(content, manga, null, isResolved),
		);
	}

	/**
	 * Catches up every OTHER manga-bearing note whose `manga.mangaka` already
	 * names this person in plain text, converting it to a `[[wikilink]]` now
	 * that their note exists — the same thing `relinkMangakaOnActiveManga`
	 * already does for the note Add Mangaka was run from, extended
	 * vault-wide. Only Series notes with a manga side are considered, wherever
	 * they are kept, and only ones that genuinely reference this exact name,
	 * so an unrelated note is never written to.
	 */
	private async relinkMangakaAcrossVault(mangakaName: string, skip: TFile): Promise<void> {
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (file.path === skip.path) continue;
			if (this.notes.seriesMangaIdOf(file) === null) continue;

			const manga: unknown = this.notes.frontmatterOf(file)?.manga;
			const mangaka: unknown =
				typeof manga === "object" && manga !== null
					? (manga as Record<string, unknown>).mangaka
					: undefined;
			const names = Array.isArray(mangaka)
				? mangaka.filter((value): value is string => typeof value === "string")
				: [];
			const hasPlainMatch = names.some(
				(name) => name.trim() === mangakaName && parseWikilink(name) === null,
			);
			if (!hasPlainMatch) continue;

			const isResolved = this.notes.isResolved(file.path);
			await this.app.vault.process(file, (content) => relinkMangaka(content, names, isResolved));
		}
	}

	private async createMangakaNote(client: MalClient, mangaka: MangakaMetadata): Promise<void> {
		const target = await this.notes.newNotePath(this.settings().mangakaFolder, [
			buildMangakaFileName(mangaka.name),
		]);
		if (target === null) return;
		if ("conflict" in target) {
			await this.notes.openConflict(target.conflict);
			return;
		}
		const notePath = target.path;

		const photo = await this.saveMangakaPhoto(client, mangaka, noteName(notePath), notePath);
		const photoLink = photo ? this.notes.imageLink(photo, notePath) : null;

		const content = buildMangakaNoteContent(mangaka, photoLink);
		const note = await this.app.vault.create(notePath, content);
		await this.notes.openNote(note);

		if (photo) {
			new Notice(`Added ${mangaka.name}`);
		} else if (mangaka.photoUrl) {
			new Notice(`Added ${mangaka.name}, but the photo could not be downloaded.`);
		} else {
			new Notice(`Added ${mangaka.name}. MyAnimeList has no photo for this person.`);
		}
	}
}
