import { Menu, Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import {
	buildAnimeFileName,
	buildAnimeNoteContent,
	refreshAnimeFrontmatter,
} from "./anime-note";
import { AnimeSearchModal } from "./anime-search-modal";
import {
	buildDirectorFileName,
	buildDirectorNoteContent,
	refreshDirectorFrontmatter,
} from "./director-note";
import { DirectorSearchModal } from "./director-search-modal";
import { FilmNoteLayout } from "./film-note-layout";
import { FilmSearchModal } from "./film-search-modal";
import { CsvFileModal } from "./import-file-modal";
import { ImportConfirmModal, ImportProgressModal } from "./import-progress-modal";
import { parseLetterboxdCsv, pickBestMatch, type LetterboxdRow } from "./letterboxd-import";
import {
	MalClient,
	MalError,
	type AnimeMetadata,
	type AnimeSearchResult,
	type MangaAuthor,
	type MangaMetadata,
	type MangaSearchResult,
	type MangakaMetadata,
} from "./mal";
import {
	applyMangaBlock,
	isAnimeOnlySeriesFrontmatter,
	isMangaOnlySeriesFrontmatter,
	malIdFrom,
	mangaMalIdFrom,
	relinkMangaka,
	removeMangaBlock,
	replaceMangaBlock,
} from "./manga-note";
import {
	buildMangakaFileName,
	buildMangakaNoteContent,
	refreshMangakaFrontmatter,
} from "./mangaka-note";
import { MangakaPickerModal } from "./mangaka-picker-modal";
import { MangaSearchModal } from "./manga-search-modal";
import {
	buildFileName,
	buildNoteContent,
	folderPrefix,
	joinPath,
	parseWikilink,
	refreshFrontmatter,
	relinkFrontmatter,
	sanitizeFileName,
	setWatchDate,
	type FilmMetadata,
	type LinkOptions,
} from "./note";
import {
	DEFAULT_SETTINGS,
	FilmTrackerSettingTab,
	type FilmTrackerSettings,
} from "./settings";
import {
	TmdbClient,
	TmdbError,
	type DirectorMetadata,
	type FilmSearchResult,
	type PersonSearchResult,
} from "./tmdb";

/** Kept well under TMDB's rate limit while an import works through a long list. */
const IMPORT_DELAY_MS = 250;

interface ImportFailure {
	name: string;
	year: number | null;
	reason: string;
}

function names(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default class FilmTrackerPlugin extends Plugin {
	settings: FilmTrackerSettings = DEFAULT_SETTINGS;
	private layout: FilmNoteLayout | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new FilmTrackerSettingTab(this.app, this));
		this.setUpLayout();

		this.addCommand({
			id: "add-film",
			name: "Add film",
			callback: () => this.startAddFilm(),
		});

		this.addCommand({
			id: "add-director",
			name: "Add director",
			callback: () => this.startAddDirector(),
		});

		this.addCommand({
			id: "add-anime",
			name: "Add anime",
			callback: () => this.startAddAnime(),
		});

		this.addCommand({
			id: "add-manga",
			name: "Add manga",
			callback: () => this.startAddManga(),
		});

		this.addCommand({
			id: "add-mangaka",
			name: "Add mangaka",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const mangaMalId = file === null ? null : this.mangaMalIdOf(file);
				if (file === null || mangaMalId === null) return false;
				if (!checking) void this.startAddMangaka(file, mangaMalId);
				return true;
			},
		});

		this.addCommand({
			id: "refresh-film-metadata",
			name: "Refresh metadata from TMDB",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const tmdbId = file === null ? null : this.tmdbIdOf(file);
				if (file === null || tmdbId === null) return false;
				if (!checking) {
					if (this.isDirectorNote(file)) void this.refreshDirectorNote(file, tmdbId);
					else void this.refreshNote(file, tmdbId);
				}
				return true;
			},
		});

		this.addCommand({
			id: "refresh-anime-metadata",
			name: "Refresh anime/manga metadata from MAL",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (file === null) return false;
				if (this.isMangakaNote(file)) {
					const mangakaMalId = this.malIdOf(file);
					if (mangakaMalId === null) return false;
					if (!checking) void this.refreshMangakaNote(file, mangakaMalId);
					return true;
				}
				const malId = this.malIdOf(file);
				const mangaMalId = this.mangaMalIdOf(file);
				if (malId === null && mangaMalId === null) return false;
				if (!checking) {
					void (async () => {
						if (malId !== null) await this.refreshAnimeNote(file, malId);
						if (mangaMalId !== null) await this.refreshMangaNote(file, mangaMalId);
					})();
				}
				return true;
			},
		});

		this.addCommand({
			id: "relink-film-notes",
			name: "Relink directors and genres",
			callback: () => void this.relinkAll(),
		});

		this.addCommand({
			id: "import-letterboxd",
			name: "Import from Letterboxd",
			callback: () => this.startImportFromLetterboxd(),
		});

		this.addRibbonIcon("film", "Add film or director", (evt) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("Add film")
					.setIcon("film")
					.onClick(() => this.startAddFilm()),
			);
			menu.addItem((item) =>
				item
					.setTitle("Add director")
					.setIcon("user")
					.onClick(() => this.startAddDirector()),
			);
			menu.addItem((item) =>
				item
					.setTitle("Add anime")
					.setIcon("tv")
					.onClick(() => this.startAddAnime()),
			);
			menu.addItem((item) =>
				item
					.setTitle("Add manga")
					.setIcon("book")
					.onClick(() => this.startAddManga()),
			);

			const activeFile = this.app.workspace.getActiveFile();
			const mangaMalId = activeFile === null ? null : this.mangaMalIdOf(activeFile);
			menu.addItem((item) => {
				item.setTitle("Add mangaka").setIcon("user").setDisabled(mangaMalId === null);
				if (activeFile !== null && mangaMalId !== null) {
					item.onClick(() => void this.startAddMangaka(activeFile, mangaMalId));
				}
			});

			menu.showAtMouseEvent(evt);
		});
	}

	/**
	 * Links are only written where a note by that name already exists, so a
	 * film never leaves an unresolved link behind. The relink command is what
	 * catches films added before their director note existed.
	 */
	private linkOptions(sourcePath: string): LinkOptions {
		return {
			directors: this.settings.linkDirectors,
			genres: this.settings.linkGenres,
			cast: this.settings.linkCast,
			composers: this.settings.linkComposers,
			addCast: this.settings.addCast,
			addComposers: this.settings.addComposers,
			castCount: this.settings.castCount,
			isResolved: (name) =>
				this.app.metadataCache.getFirstLinkpathDest(name, sourcePath) !== null,
		};
	}

	private tmdbIdOf(file: TFile): number | null {
		const id: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.tmdb_id;
		return typeof id === "number" ? id : null;
	}

	private malIdOf(file: TFile): number | null {
		return malIdFrom(this.app.metadataCache.getFileCache(file)?.frontmatter);
	}

	/** Reads `manga.mal_id` out of a note's parsed (nested) frontmatter, if present. */
	private mangaMalIdOf(file: TFile): number | null {
		return mangaMalIdFrom(this.app.metadataCache.getFileCache(file)?.frontmatter);
	}

	/**
	 * A not-yet-merged manga-only Series note: has `manga` but no `mal_id`
	 * yet — never a mangaka note (see `isMangaOnlySeriesFrontmatter`), which
	 * is what stops Add anime from ever merging into one.
	 */
	private isMangaOnlySeries(file: TFile): boolean {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return isMangaOnlySeriesFrontmatter(frontmatter, this.isMangakaNote(file));
	}

	/**
	 * A not-yet-merged anime-only Series note: has `mal_id` but no `manga`
	 * yet — never a mangaka note (see `isAnimeOnlySeriesFrontmatter`), which
	 * is what stops Add manga from ever merging into one.
	 */
	private isAnimeOnlySeries(file: TFile): boolean {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return isAnimeOnlySeriesFrontmatter(frontmatter, this.isMangakaNote(file));
	}

	/**
	 * Director and film TMDB IDs come from different ID spaces and can
	 * numerically collide, so "does this already exist" and "which kind of
	 * note is this" are both scoped to the director folder rather than
	 * matched vault-wide. An empty Director folder setting never counts as a
	 * director note, so an ambiguous "both folders are the vault root"
	 * configuration falls back to treating notes as films.
	 */
	private isDirectorNote(file: TFile): boolean {
		const prefix = folderPrefix(this.settings.directorFolder);
		return prefix !== "" && file.path.startsWith(prefix);
	}

	/**
	 * Mangaka and anime MAL ids come from different id spaces and can
	 * numerically collide, so "is this a mangaka note" is scoped to the
	 * mangaka folder rather than inferred from frontmatter shape — same
	 * reasoning as `isDirectorNote`.
	 */
	private isMangakaNote(file: TFile): boolean {
		const prefix = folderPrefix(this.settings.mangakaFolder);
		return prefix !== "" && file.path.startsWith(prefix);
	}

	private async refreshNote(file: TFile, tmdbId: number): Promise<void> {
		if (this.settings.apiKey === "") {
			new Notice("Set your TMDB API key in Film + Anime-Manga Tracker settings.");
			return;
		}

		try {
			const client = new TmdbClient(this.settings.apiKey);
			const film = await client.getFilm(tmdbId);
			const posterLink = await this.posterLinkIfMissing(client, film, file);

			await this.app.vault.process(file, (content) =>
				refreshFrontmatter(content, film, this.linkOptions(file.path), posterLink),
			);
			new Notice(`Refreshed ${film.title}`);
		} catch (error) {
			if (error instanceof TmdbError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not refresh the film", error);
			new Notice("Could not refresh the film. See the console for details.");
		}
	}

	/** Only fills in a poster that is missing; an existing one is never replaced. */
	private async posterLinkIfMissing(
		client: TmdbClient,
		film: FilmMetadata,
		file: TFile,
	): Promise<string | null> {
		const current: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.poster;
		if (typeof current === "string" && current.trim() !== "") return null;
		if (!film.posterPath) return null;

		const baseName = buildFileName(film.title, film.year);
		const poster = await this.savePoster(client, film, baseName, file.path);
		return poster === null
			? null
			: this.app.fileManager.generateMarkdownLink(poster, file.path).replace(/^!/, "");
	}

	private async refreshDirectorNote(file: TFile, tmdbId: number): Promise<void> {
		if (this.settings.apiKey === "") {
			new Notice("Set your TMDB API key in Film + Anime-Manga Tracker settings.");
			return;
		}

		try {
			const client = new TmdbClient(this.settings.apiKey);
			const director = await client.getPerson(tmdbId);
			const photoLink = await this.directorPhotoLinkIfMissing(client, director, file);

			await this.app.vault.process(file, (content) =>
				refreshDirectorFrontmatter(content, director, photoLink),
			);
			new Notice(`Refreshed ${director.name}`);
		} catch (error) {
			if (error instanceof TmdbError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not refresh the director", error);
			new Notice("Could not refresh the director. See the console for details.");
		}
	}

	/** Only fills in a photo that is missing; an existing one is never replaced. */
	private async directorPhotoLinkIfMissing(
		client: TmdbClient,
		director: DirectorMetadata,
		file: TFile,
	): Promise<string | null> {
		const current: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.poster;
		if (typeof current === "string" && current.trim() !== "") return null;
		if (!director.photoPath) return null;

		const baseName = buildDirectorFileName(director.name);
		const photo = await this.saveDirectorPhoto(client, director, baseName, file.path);
		return photo === null
			? null
			: this.app.fileManager.generateMarkdownLink(photo, file.path).replace(/^!/, "");
	}

	private async refreshAnimeNote(file: TFile, malId: number): Promise<void> {
		if (this.settings.malClientId === "") {
			new Notice("Set your MyAnimeList client ID in Film + Anime-Manga Tracker settings.");
			return;
		}

		try {
			const client = new MalClient(this.settings.malClientId);
			const anime = await client.getAnime(malId);
			const posterLink = await this.animePosterLinkIfMissing(client, anime, file);

			await this.app.vault.process(file, (content) =>
				refreshAnimeFrontmatter(content, anime, posterLink),
			);
			new Notice(`Refreshed ${anime.title}`);
		} catch (error) {
			if (error instanceof MalError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not refresh the anime", error);
			new Notice("Could not refresh the anime. See the console for details.");
		}
	}

	/** Only fills in a poster that is missing; an existing one is never replaced. */
	private async animePosterLinkIfMissing(
		client: MalClient,
		anime: AnimeMetadata,
		file: TFile,
	): Promise<string | null> {
		const current: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.poster;
		if (typeof current === "string" && current.trim() !== "") return null;
		if (!anime.posterUrl) return null;

		const baseName = buildAnimeFileName(anime.title, anime.year);
		const poster = await this.saveAnimePoster(client, anime, baseName, file.path);
		return poster === null
			? null
			: this.app.fileManager.generateMarkdownLink(poster, file.path).replace(/^!/, "");
	}

	private async refreshMangaNote(file: TFile, mangaMalId: number): Promise<void> {
		if (this.settings.malClientId === "") {
			new Notice("Set your MyAnimeList client ID in Film + Anime-Manga Tracker settings.");
			return;
		}

		try {
			const client = new MalClient(this.settings.malClientId);
			const manga = await client.getManga(mangaMalId);
			const posterLink = await this.mangaPosterLinkIfMissing(client, manga, file);
			const isResolved = this.linkOptions(file.path).isResolved;

			await this.app.vault.process(file, (content) =>
				applyMangaBlock(content, manga, posterLink, isResolved),
			);
			new Notice(`Refreshed ${manga.title}`);
		} catch (error) {
			if (error instanceof MalError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not refresh the manga", error);
			new Notice("Could not refresh the manga. See the console for details.");
		}
	}

	/** Only fills in a poster that is missing; an existing one is never replaced. */
	private async mangaPosterLinkIfMissing(
		client: MalClient,
		manga: MangaMetadata,
		file: TFile,
	): Promise<string | null> {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const mangaBlock: unknown = frontmatter?.manga;
		const current: unknown =
			typeof mangaBlock === "object" && mangaBlock !== null
				? (mangaBlock as Record<string, unknown>).poster
				: undefined;
		if (typeof current === "string" && current.trim() !== "") return null;
		if (!manga.posterUrl) return null;

		const baseName = sanitizeFileName(manga.title);
		const poster = await this.saveMangaPoster(client, manga, baseName, file.path);
		return poster === null
			? null
			: this.app.fileManager.generateMarkdownLink(poster, file.path).replace(/^!/, "");
	}

	private async refreshMangakaNote(file: TFile, mangakaMalId: number): Promise<void> {
		if (this.settings.malClientId === "") {
			new Notice("Set your MyAnimeList client ID in Film + Anime-Manga Tracker settings.");
			return;
		}

		try {
			const client = new MalClient(this.settings.malClientId);
			const mangaka = await client.getPerson(mangakaMalId);
			const photoLink = await this.mangakaPhotoLinkIfMissing(client, mangaka, file);

			await this.app.vault.process(file, (content) =>
				refreshMangakaFrontmatter(content, mangaka, photoLink),
			);
			new Notice(`Refreshed ${mangaka.name}`);
		} catch (error) {
			if (error instanceof MalError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not refresh the mangaka", error);
			new Notice("Could not refresh the mangaka. See the console for details.");
		}
	}

	/** Only fills in a photo that is missing; an existing one is never replaced. */
	private async mangakaPhotoLinkIfMissing(
		client: MalClient,
		mangaka: MangakaMetadata,
		file: TFile,
	): Promise<string | null> {
		const current: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.poster;
		if (typeof current === "string" && current.trim() !== "") return null;
		if (!mangaka.photoUrl) return null;

		const baseName = buildMangakaFileName(mangaka.name);
		const photo = await this.saveMangakaPhoto(client, mangaka, baseName, file.path);
		return photo === null
			? null
			: this.app.fileManager.generateMarkdownLink(photo, file.path).replace(/^!/, "");
	}

	private async mergeAnimeIntoNote(client: MalClient, anime: AnimeMetadata, file: TFile): Promise<void> {
		const posterLink = await this.animePosterLinkIfMissing(client, anime, file);
		await this.app.vault.process(file, (content) =>
			refreshAnimeFrontmatter(content, anime, posterLink),
		);
		await this.openNote(file);
		new Notice(`Linked anime to ${file.basename}`);
	}

	private async mergeMangaIntoNote(client: MalClient, manga: MangaMetadata, file: TFile): Promise<void> {
		const posterLink = await this.mangaPosterLinkIfMissing(client, manga, file);
		const isResolved = this.linkOptions(file.path).isResolved;
		await this.app.vault.process(file, (content) =>
			applyMangaBlock(content, manga, posterLink, isResolved),
		);
		await this.openNote(file);
		new Notice(`Linked manga to ${file.basename}`);
	}

	/**
	 * "Change manga" on the MANGA panel: pick a different manga for a Series
	 * note whose manga side turned out to be the wrong one. Only the `manga:`
	 * block is rewritten (see `replaceMangaBlock`) — the note is never
	 * recreated, so the anime side, its poster, `watched`, the body and every
	 * other property survive untouched.
	 */
	private startChangeManga(file: TFile): void {
		if (this.settings.malClientId === "") {
			new Notice("Set your MyAnimeList client ID in Film + Anime-Manga Tracker settings.");
			return;
		}
		const client = new MalClient(this.settings.malClientId);
		new MangaSearchModal(this.app, client, (result) => {
			void this.changeManga(client, result, file);
		}).open();
	}

	private async changeManga(
		client: MalClient,
		result: MangaSearchResult,
		file: TFile,
	): Promise<void> {
		try {
			const manga = await client.getManga(result.id);
			// A fresh poster, not the one already on the note: that image is
			// the previous (wrong) manga's cover.
			const poster = await this.saveMangaPoster(
				client,
				manga,
				sanitizeFileName(manga.title),
				file.path,
			);
			const posterLink =
				poster === null
					? null
					: this.app.fileManager.generateMarkdownLink(poster, file.path).replace(/^!/, "");
			const isResolved = this.linkOptions(file.path).isResolved;

			await this.app.vault.process(file, (content) =>
				replaceMangaBlock(content, manga, posterLink, isResolved),
			);
			new Notice(`Changed the manga to ${manga.title}`);
		} catch (error) {
			if (error instanceof MalError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not change the manga", error);
			new Notice("Could not change the manga. See the console for details.");
		}
	}

	/** "Remove manga" on the MANGA panel — drops the `manga:` block and nothing else. */
	private async removeManga(file: TFile): Promise<void> {
		let removed = false;
		await this.app.vault.process(file, (content) => {
			const next = removeMangaBlock(content);
			removed = next !== content;
			return next;
		});
		new Notice(removed ? `Removed the manga from ${file.basename}` : "This note has no manga.");
	}

	private async relinkAll(): Promise<void> {
		let changed = 0;

		for (const file of this.app.vault.getMarkdownFiles()) {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (frontmatter?.tmdb_id === undefined) continue;

			const values = {
				directors: this.settings.linkDirectors ? names(frontmatter.directors) : undefined,
				genres: this.settings.linkGenres ? names(frontmatter.genres) : undefined,
				cast: this.settings.linkCast ? names(frontmatter.cast) : undefined,
				composers: this.settings.linkComposers ? names(frontmatter.composers) : undefined,
			};
			const isResolved = this.linkOptions(file.path).isResolved;

			let touched = false;
			await this.app.vault.process(file, (content) => {
				const next = relinkFrontmatter(content, values, isResolved);
				touched = next !== content;
				return next;
			});
			if (touched) changed += 1;
		}

		new Notice(changed === 1 ? "Relinked 1 film note." : `Relinked ${changed} film notes.`);
	}

	onunload(): void {
		this.layout?.removeAll();
	}

	setShowConnections(value: boolean): void {
		this.layout?.setShowConnections(value);
		this.layout?.refresh();
	}

	setShowFilmography(value: boolean): void {
		this.layout?.setShowFilmography(value);
		this.layout?.refresh();
	}

	private setUpLayout(): void {
		const layout = new FilmNoteLayout(
			this.app,
			this.settings.showConnections,
			this.settings.showFilmography,
			{
				change: (file) => this.startChangeManga(file),
				remove: (file) => void this.removeManga(file),
			},
		);
		this.layout = layout;
		const refresh = () => layout.refresh();

		this.registerEvent(this.app.workspace.on("layout-change", refresh));
		this.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
		this.registerEvent(this.app.workspace.on("file-open", refresh));
		this.registerEvent(this.app.metadataCache.on("changed", refresh));
		/**
		 * Connections compare the open note against every other film in the
		 * vault, so on a cold start they need the vault's metadata cache fully
		 * populated, not just the active file's own (already-cached)
		 * frontmatter. `resolved` fires once per vault and may well have
		 * already happened before this listener is registered, so it cannot
		 * be relied on alone — the delayed retry below is what actually
		 * catches a restored workspace up.
		 */
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
		this.app.workspace.onLayoutReady(() => {
			refresh();
			for (const delayMs of [1000, 3000, 6000, 12000]) {
				window.setTimeout(refresh, delayMs);
			}
		});
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<FilmTrackerSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private startAddFilm(): void {
		if (this.settings.apiKey === "") {
			new Notice("Set your TMDB API key in Film + Anime-Manga Tracker settings.");
			return;
		}
		const client = new TmdbClient(this.settings.apiKey);
		new FilmSearchModal(this.app, client, (result) => {
			void this.addFilm(client, result);
		}).open();
	}

	private async addFilm(client: TmdbClient, result: FilmSearchResult): Promise<void> {
		try {
			const film = await client.getFilm(result.id);
			const existing = this.findNoteByTmdbId(film.tmdbId, this.settings.filmFolder);
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.openNote(existing);
				return;
			}
			await this.createFilmNote(client, film);
		} catch (error) {
			if (error instanceof TmdbError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not add the film", error);
			new Notice("Could not add the film. See the console for details.");
		}
	}

	/**
	 * `open: false` is what the Letterboxd import uses: hundreds of films
	 * should not each open a tab or pop a Notice.
	 */
	private async createFilmNote(
		client: TmdbClient,
		film: FilmMetadata,
		options: { watchDate?: string | null; open?: boolean } = {},
	): Promise<"created" | "conflict"> {
		const open = options.open !== false;

		if (!(await this.ensureFolder(this.settings.filmFolder))) return "conflict";

		const baseName = buildFileName(film.title, film.year);
		const notePath = joinPath(this.settings.filmFolder, `${baseName}.md`);

		const conflict = this.app.vault.getAbstractFileByPath(notePath);
		if (conflict instanceof TFile) {
			if (open) {
				new Notice(`A note already exists at ${notePath}`);
				await this.openNote(conflict);
			}
			return "conflict";
		}

		const poster = await this.savePoster(client, film, baseName, notePath);
		const posterLink = poster
			? this.app.fileManager.generateMarkdownLink(poster, notePath)
			: null;

		let content = buildNoteContent(film, posterLink, this.linkOptions(notePath));
		if (options.watchDate) content = setWatchDate(content, options.watchDate);

		const note = await this.app.vault.create(notePath, content);
		if (!open) return "created";

		await this.openNote(note);
		if (poster) {
			new Notice(`Added ${film.title}`);
		} else if (film.posterPath) {
			new Notice(`Added ${film.title}, but the poster could not be downloaded.`);
		} else {
			new Notice(`Added ${film.title}. TMDB has no poster for this film.`);
		}
		return "created";
	}

	private startAddDirector(): void {
		if (this.settings.apiKey === "") {
			new Notice("Set your TMDB API key in Film + Anime-Manga Tracker settings.");
			return;
		}
		const client = new TmdbClient(this.settings.apiKey);
		new DirectorSearchModal(this.app, client, (result) => {
			void this.addDirector(client, result);
		}).open();
	}

	private async addDirector(client: TmdbClient, result: PersonSearchResult): Promise<void> {
		try {
			const director = await client.getPerson(result.id);
			const existing = this.findNoteByTmdbId(director.tmdbId, this.settings.directorFolder);
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.openNote(existing);
				return;
			}
			await this.createDirectorNote(client, director);
		} catch (error) {
			if (error instanceof TmdbError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not add the director", error);
			new Notice("Could not add the director. See the console for details.");
		}
	}

	private async createDirectorNote(client: TmdbClient, director: DirectorMetadata): Promise<void> {
		if (!(await this.ensureFolder(this.settings.directorFolder))) return;

		const baseName = buildDirectorFileName(director.name);
		const notePath = joinPath(this.settings.directorFolder, `${baseName}.md`);

		const conflict = this.app.vault.getAbstractFileByPath(notePath);
		if (conflict instanceof TFile) {
			new Notice(`A note already exists at ${notePath}`);
			await this.openNote(conflict);
			return;
		}

		const photo = await this.saveDirectorPhoto(client, director, baseName, notePath);
		const photoLink = photo ? this.app.fileManager.generateMarkdownLink(photo, notePath) : null;

		const content = buildDirectorNoteContent(director, photoLink);
		const note = await this.app.vault.create(notePath, content);
		await this.openNote(note);

		if (photo) {
			new Notice(`Added ${director.name}`);
		} else if (director.photoPath) {
			new Notice(`Added ${director.name}, but the photo could not be downloaded.`);
		} else {
			new Notice(`Added ${director.name}. TMDB has no photo for this person.`);
		}
	}

	private startAddAnime(): void {
		if (this.settings.malClientId === "") {
			new Notice("Set your MyAnimeList client ID in Film + Anime-Manga Tracker settings.");
			return;
		}
		const client = new MalClient(this.settings.malClientId);
		new AnimeSearchModal(this.app, client, (result) => {
			void this.addAnime(client, result);
		}).open();
	}

	private async addAnime(client: MalClient, result: AnimeSearchResult): Promise<void> {
		try {
			const anime = await client.getAnime(result.id);
			const existing = this.findNoteByMalId(anime.malId, this.settings.animeFolder);
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.openNote(existing);
				return;
			}

			// Linking an anime to a manga is entirely manual: the open note is
			// the user's choice of target, and nothing else in the vault is
			// searched or guessed at. Any other note open, or none, means a new
			// independent Series note.
			const active = this.app.workspace.getActiveFile();
			if (active !== null && this.isMangaOnlySeries(active)) {
				await this.mergeAnimeIntoNote(client, anime, active);
				return;
			}

			await this.createAnimeNote(client, anime);
		} catch (error) {
			if (error instanceof MalError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not add the anime", error);
			new Notice("Could not add the anime. See the console for details.");
		}
	}

	private async createAnimeNote(client: MalClient, anime: AnimeMetadata): Promise<void> {
		if (!(await this.ensureFolder(this.settings.animeFolder))) return;

		const baseName = buildAnimeFileName(anime.title, anime.year);
		const notePath = joinPath(this.settings.animeFolder, `${baseName}.md`);

		const conflict = this.app.vault.getAbstractFileByPath(notePath);
		if (conflict instanceof TFile) {
			new Notice(`A note already exists at ${notePath}`);
			await this.openNote(conflict);
			return;
		}

		const poster = await this.saveAnimePoster(client, anime, baseName, notePath);
		const posterLink = poster
			? this.app.fileManager.generateMarkdownLink(poster, notePath)
			: null;

		const content = buildAnimeNoteContent(anime, posterLink);
		const note = await this.app.vault.create(notePath, content);
		await this.openNote(note);

		if (poster) {
			new Notice(`Added ${anime.title}`);
		} else if (anime.posterUrl) {
			new Notice(`Added ${anime.title}, but the poster could not be downloaded.`);
		} else {
			new Notice(`Added ${anime.title}. MyAnimeList has no poster for this anime.`);
		}
	}

	private startAddManga(): void {
		if (this.settings.malClientId === "") {
			new Notice("Set your MyAnimeList client ID in Film + Anime-Manga Tracker settings.");
			return;
		}
		const client = new MalClient(this.settings.malClientId);
		new MangaSearchModal(this.app, client, (result) => {
			void this.addManga(client, result);
		}).open();
	}

	private async addManga(client: MalClient, result: MangaSearchResult): Promise<void> {
		try {
			const manga = await client.getManga(result.id);
			const existing = this.findNoteByMangaMalId(manga.malId, this.settings.animeFolder);
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.openNote(existing);
				return;
			}

			// Manual in exactly the same way as `addAnime` � the open note is
			// the only merge target ever considered.
			const active = this.app.workspace.getActiveFile();
			if (active !== null && this.isAnimeOnlySeries(active)) {
				await this.mergeMangaIntoNote(client, manga, active);
				return;
			}

			await this.createMangaNote(client, manga);
		} catch (error) {
			if (error instanceof MalError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not add the manga", error);
			new Notice("Could not add the manga. See the console for details.");
		}
	}

	private async createMangaNote(client: MalClient, manga: MangaMetadata): Promise<void> {
		if (!(await this.ensureFolder(this.settings.animeFolder))) return;

		const baseName = sanitizeFileName(manga.title);
		const notePath = joinPath(this.settings.animeFolder, `${baseName}.md`);

		const conflict = this.app.vault.getAbstractFileByPath(notePath);
		if (conflict instanceof TFile) {
			new Notice(`A note already exists at ${notePath}`);
			await this.openNote(conflict);
			return;
		}

		const poster = await this.saveMangaPoster(client, manga, baseName, notePath);
		const posterLink = poster
			? this.app.fileManager.generateMarkdownLink(poster, notePath)
			: null;
		const isResolved = this.linkOptions(notePath).isResolved;

		const content = applyMangaBlock("---\n---\n", manga, posterLink, isResolved);
		const note = await this.app.vault.create(notePath, content);
		await this.openNote(note);

		if (poster) {
			new Notice(`Added ${manga.title}`);
		} else if (manga.posterUrl) {
			new Notice(`Added ${manga.title}, but the poster could not be downloaded.`);
		} else {
			new Notice(`Added ${manga.title}. MyAnimeList has no poster for this manga.`);
		}
	}

	/**
	 * Unlike Add anime/Add manga/Add director, this never searches MAL live —
	 * MAL's API has no person-search endpoint (confirmed: `GET /people?q=...`
	 * returns 404), so the only source of a mangaka's id is a manga's own
	 * `authors` list. This is why the command only runs against the active
	 * note's own `manga.mal_id` rather than opening a search modal.
	 */
	private async startAddMangaka(file: TFile, mangaMalId: number): Promise<void> {
		if (this.settings.malClientId === "") {
			new Notice("Set your MyAnimeList client ID in Film + Anime-Manga Tracker settings.");
			return;
		}

		const client = new MalClient(this.settings.malClientId);
		try {
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

			new MangakaPickerModal(this.app, candidates, (author) => {
				void this.processMangaka(author, file, client, manga);
			}).open();
		} catch (error) {
			if (error instanceof MalError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not add the mangaka", error);
			new Notice("Could not add the mangaka. See the console for details.");
		}
	}

	/**
	 * Finds or creates the mangaka note for one candidate, then re-applies the
	 * manga block on the note Add Mangaka was run from — `manga` here is the
	 * same already-fetched data `startAddMangaka` used to build `candidates`,
	 * so this costs no extra MAL request. `formatNames`/`isResolved` (already
	 * exercised by every other manga write) picks up the mangaka note that
	 * now exists and turns that name into a `[[wikilink]]` in the same pass —
	 * `read`, the manga's own poster and any unknown sub-field are preserved
	 * exactly, the same guarantee `applyMangaBlock` always gives.
	 */
	private async processMangaka(
		candidate: MangaAuthor,
		activeFile: TFile,
		client: MalClient,
		manga: MangaMetadata,
	): Promise<void> {
		if (candidate.malId === null) return;

		const existing = this.findNoteByMalId(candidate.malId, this.settings.mangakaFolder);
		if (existing !== null) {
			await this.refreshMangakaNote(existing, candidate.malId);
			await this.openNote(existing);
			await this.relinkMangakaOnActiveManga(activeFile, manga);
			return;
		}

		try {
			const mangaka = await client.getPerson(candidate.malId);
			await this.createMangakaNote(client, mangaka);
			await this.relinkMangakaOnActiveManga(activeFile, manga);
			await this.relinkMangakaAcrossVault(mangaka.name, activeFile);
		} catch (error) {
			if (error instanceof MalError) {
				new Notice(error.message);
				return;
			}
			console.error("Film + Anime-Manga Tracker: could not add the mangaka", error);
			new Notice("Could not add the mangaka. See the console for details.");
		}
	}

	private async relinkMangakaOnActiveManga(activeFile: TFile, manga: MangaMetadata): Promise<void> {
		const isResolved = this.linkOptions(activeFile.path).isResolved;
		await this.app.vault.process(activeFile, (content) =>
			applyMangaBlock(content, manga, null, isResolved),
		);
	}

	/**
	 * Catches up every OTHER manga-bearing note whose `manga.mangaka` already
	 * names this person in plain text, converting it to a `[[wikilink]]` now
	 * that their note exists — the same thing `relinkMangakaOnActiveManga`
	 * already does for the note Add Mangaka was run from, extended
	 * vault-wide. Scoped to the same folder `findNoteByMangaMalId` uses, and
	 * only touches notes that genuinely reference this exact name, so an
	 * unrelated manga note is never written to.
	 */
	private async relinkMangakaAcrossVault(mangakaName: string, skip: TFile): Promise<void> {
		const prefix = folderPrefix(this.settings.animeFolder);
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (file.path === skip.path) continue;
			if (prefix !== "" && !file.path.startsWith(prefix)) continue;

			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (mangaMalIdFrom(frontmatter) === null) continue;

			const manga: unknown = frontmatter?.manga;
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

			const isResolved = this.linkOptions(file.path).isResolved;
			await this.app.vault.process(file, (content) => relinkMangaka(content, names, isResolved));
		}
	}

	private async createMangakaNote(client: MalClient, mangaka: MangakaMetadata): Promise<void> {
		if (!(await this.ensureFolder(this.settings.mangakaFolder))) return;

		const baseName = buildMangakaFileName(mangaka.name);
		const notePath = joinPath(this.settings.mangakaFolder, `${baseName}.md`);

		const conflict = this.app.vault.getAbstractFileByPath(notePath);
		if (conflict instanceof TFile) {
			new Notice(`A note already exists at ${notePath}`);
			await this.openNote(conflict);
			return;
		}

		const photo = await this.saveMangakaPhoto(client, mangaka, baseName, notePath);
		const photoLink = photo ? this.app.fileManager.generateMarkdownLink(photo, notePath) : null;

		const content = buildMangakaNoteContent(mangaka, photoLink);
		const note = await this.app.vault.create(notePath, content);
		await this.openNote(note);

		if (photo) {
			new Notice(`Added ${mangaka.name}`);
		} else if (mangaka.photoUrl) {
			new Notice(`Added ${mangaka.name}, but the photo could not be downloaded.`);
		} else {
			new Notice(`Added ${mangaka.name}. MyAnimeList has no photo for this person.`);
		}
	}

	startImportFromLetterboxd(): void {
		if (this.settings.apiKey === "") {
			new Notice("Set your TMDB API key in Film + Anime-Manga Tracker settings.");
			return;
		}
		new CsvFileModal(this.app, (file) => void this.beginLetterboxdImport(file)).open();
	}

	private async beginLetterboxdImport(file: TFile): Promise<void> {
		let rows: LetterboxdRow[];
		try {
			const content = await this.app.vault.read(file);
			rows = parseLetterboxdCsv(content);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not read that file.";
			new Notice(message);
			return;
		}

		if (rows.length === 0) {
			new Notice("No films found in that file.");
			return;
		}

		new ImportConfirmModal(this.app, rows.length, () => void this.runLetterboxdImport(rows)).open();
	}

	private async runLetterboxdImport(rows: LetterboxdRow[]): Promise<void> {
		const client = new TmdbClient(this.settings.apiKey);
		const progress = new ImportProgressModal(this.app);
		progress.open();

		let imported = 0;
		let skipped = 0;
		const failures: ImportFailure[] = [];

		for (let i = 0; i < rows.length; i++) {
			if (progress.isCancelled()) break;
			const row = rows[i];
			progress.setStatus(`${i + 1}/${rows.length}: ${row.name}`);

			try {
				const outcome = await this.importRow(client, row);
				if (outcome === "imported") imported += 1;
				else skipped += 1;
			} catch (error) {
				const reason = error instanceof Error ? error.message : "Unexpected error.";
				failures.push({ name: row.name, year: row.year, reason });
			}

			if (i < rows.length - 1) await delay(IMPORT_DELAY_MS);
		}

		const cancelled = progress.isCancelled();
		progress.close();
		await this.writeImportReport(imported, skipped, failures);

		new Notice(
			`Imported ${imported}, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}, ` +
				`${failures.length} not matched${cancelled ? " (cancelled)" : ""}.`,
		);
	}

	private async importRow(
		client: TmdbClient,
		row: LetterboxdRow,
	): Promise<"imported" | "skipped"> {
		const results = await client.search(row.name);
		const match = pickBestMatch(results, row.year);
		if (match === null) throw new Error(`No TMDB match found for "${row.name}".`);

		const existing = this.findNoteByTmdbId(match.id, this.settings.filmFolder);
		if (existing) {
			if (row.watchedDate) {
				await this.app.vault.process(existing, (content) =>
					setWatchDate(content, row.watchedDate as string),
				);
			}
			return "skipped";
		}

		const film = await client.getFilm(match.id);
		const result = await this.createFilmNote(client, film, {
			watchDate: row.watchedDate,
			open: false,
		});
		if (result === "conflict") {
			throw new Error(`A note already exists for "${film.title}" but has no tmdb_id.`);
		}
		return "imported";
	}

	private async writeImportReport(
		imported: number,
		skipped: number,
		failures: ImportFailure[],
	): Promise<void> {
		if (failures.length === 0) return;

		const cell = (value: string) => value.replace(/\|/g, "\\|");
		const lines = [
			"# Film + Anime-Manga Tracker Import Report",
			"",
			`Imported: ${imported}`,
			`Skipped (already in vault): ${skipped}`,
			`Not matched: ${failures.length}`,
			"",
			"| Name | Year | Reason |",
			"| --- | --- | --- |",
			...failures.map((f) => `| ${cell(f.name)} | ${f.year ?? ""} | ${cell(f.reason)} |`),
			"",
		];

		await this.app.vault.create(this.availablePath("Film + Anime-Manga Tracker Import Report.md"), lines.join("\n"));
	}

	private async savePoster(
		client: TmdbClient,
		film: FilmMetadata,
		baseName: string,
		notePath: string,
	): Promise<TFile | null> {
		if (!film.posterPath) return null;
		try {
			const data = await client.downloadImage(film.posterPath);
			const path = await this.resolveImagePath(`${baseName}.jpg`, notePath, this.settings.posterFolder);
			return await this.app.vault.createBinary(path, data);
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: could not save the poster", error);
			return null;
		}
	}

	private async saveDirectorPhoto(
		client: TmdbClient,
		director: DirectorMetadata,
		baseName: string,
		notePath: string,
	): Promise<TFile | null> {
		if (!director.photoPath) return null;
		try {
			const data = await client.downloadImage(director.photoPath);
			const path = await this.resolveImagePath(
				`${baseName}.jpg`,
				notePath,
				this.settings.directorPhotoFolder,
			);
			return await this.app.vault.createBinary(path, data);
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: could not save the director photo", error);
			return null;
		}
	}

	private async saveAnimePoster(
		client: MalClient,
		anime: AnimeMetadata,
		baseName: string,
		notePath: string,
	): Promise<TFile | null> {
		if (!anime.posterUrl) return null;
		try {
			const data = await client.downloadImage(anime.posterUrl);
			const path = await this.resolveImagePath(
				`${baseName}.jpg`,
				notePath,
				this.settings.animePosterFolder,
			);
			return await this.app.vault.createBinary(path, data);
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: could not save the anime poster", error);
			return null;
		}
	}

	private async resolveImagePath(fileName: string, notePath: string, folder: string): Promise<string> {
		if (folder === "") {
			return this.app.fileManager.getAvailablePathForAttachment(fileName, notePath);
		}
		if (!(await this.ensureFolder(folder))) {
			return this.app.fileManager.getAvailablePathForAttachment(fileName, notePath);
		}
		return this.availablePath(joinPath(folder, fileName));
	}

	private availablePath(path: string): string {
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		const dot = path.lastIndexOf(".");
		const base = dot === -1 ? path : path.slice(0, dot);
		const extension = dot === -1 ? "" : path.slice(dot);
		let index = 1;
		while (this.app.vault.getAbstractFileByPath(`${base} ${index}${extension}`)) {
			index += 1;
		}
		return `${base} ${index}${extension}`;
	}

	private async ensureFolder(folder: string): Promise<boolean> {
		const path = normalizePath(folder.trim());
		if (path === "" || path === "/") return true;

		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return true;
		if (existing) {
			new Notice(`"${path}" is a file, not a folder. Check your Film + Anime-Manga Tracker settings.`);
			return false;
		}

		await this.app.vault.createFolder(path);
		return true;
	}

	/**
	 * Scoped to `folder` rather than searched vault-wide: film and director
	 * TMDB IDs are different ID spaces that can numerically collide, so
	 * limiting the search to each type's own folder is what keeps a film
	 * and a director from ever being mismatched for one another.
	 */
	private findNoteByTmdbId(tmdbId: number, folder: string): TFile | null {
		const prefix = folderPrefix(folder);
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (prefix !== "" && !file.path.startsWith(prefix)) continue;
			if (this.app.metadataCache.getFileCache(file)?.frontmatter?.tmdb_id === tmdbId) {
				return file;
			}
		}
		return null;
	}

	/**
	 * Scoped to `folder` for the same reason as `findNoteByTmdbId`: MAL and
	 * TMDB ids are separate id spaces that can numerically collide.
	 */
	private findNoteByMalId(malId: number, folder: string): TFile | null {
		const prefix = folderPrefix(folder);
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (prefix !== "" && !file.path.startsWith(prefix)) continue;
			if (this.app.metadataCache.getFileCache(file)?.frontmatter?.mal_id === malId) {
				return file;
			}
		}
		return null;
	}

	/** Scoped to `folder` for the same reason as `findNoteByTmdbId`/`findNoteByMalId`. */
	private findNoteByMangaMalId(mangaMalId: number, folder: string): TFile | null {
		const prefix = folderPrefix(folder);
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (prefix !== "" && !file.path.startsWith(prefix)) continue;
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (mangaMalIdFrom(frontmatter) === mangaMalId) return file;
		}
		return null;
	}

	private async saveMangaPoster(
		client: MalClient,
		manga: MangaMetadata,
		baseName: string,
		notePath: string,
	): Promise<TFile | null> {
		if (!manga.posterUrl) return null;
		try {
			const data = await client.downloadImage(manga.posterUrl);
			const path = await this.resolveImagePath(
				`${baseName} (Manga).jpg`,
				notePath,
				this.settings.animePosterFolder,
			);
			return await this.app.vault.createBinary(path, data);
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: could not save the manga poster", error);
			return null;
		}
	}

	private async saveMangakaPhoto(
		client: MalClient,
		mangaka: MangakaMetadata,
		baseName: string,
		notePath: string,
	): Promise<TFile | null> {
		if (!mangaka.photoUrl) return null;
		try {
			const data = await client.downloadImage(mangaka.photoUrl);
			const path = await this.resolveImagePath(
				`${baseName}.jpg`,
				notePath,
				this.settings.mangakaPhotoFolder,
			);
			return await this.app.vault.createBinary(path, data);
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: could not save the mangaka photo", error);
			return null;
		}
	}

	private async openNote(file: TFile): Promise<void> {
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}
