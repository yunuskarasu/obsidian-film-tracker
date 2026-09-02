import { Menu, Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
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
	buildFileName,
	buildNoteContent,
	joinPath,
	refreshFrontmatter,
	relinkFrontmatter,
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

	/** Empty means "match every path" (vault root), same as `ensureFolder`. */
	private folderPrefix(folder: string): string {
		const trimmed = folder.trim();
		return trimmed === "" ? "" : `${normalizePath(trimmed)}/`;
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
		const prefix = this.folderPrefix(this.settings.directorFolder);
		return prefix !== "" && file.path.startsWith(prefix);
	}

	private async refreshNote(file: TFile, tmdbId: number): Promise<void> {
		if (this.settings.apiKey === "") {
			new Notice("Set your TMDB API key in Film Tracker settings.");
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
			console.error("Film Tracker: could not refresh the film", error);
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
			new Notice("Set your TMDB API key in Film Tracker settings.");
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
			console.error("Film Tracker: could not refresh the director", error);
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
			new Notice("Set your TMDB API key in Film Tracker settings.");
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
			console.error("Film Tracker: could not add the film", error);
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
			new Notice("Set your TMDB API key in Film Tracker settings.");
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
			console.error("Film Tracker: could not add the director", error);
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

	startImportFromLetterboxd(): void {
		if (this.settings.apiKey === "") {
			new Notice("Set your TMDB API key in Film Tracker settings.");
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
			"# Film Tracker Import Report",
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

		await this.app.vault.create(this.availablePath("Film Tracker Import Report.md"), lines.join("\n"));
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
			console.error("Film Tracker: could not save the poster", error);
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
			console.error("Film Tracker: could not save the director photo", error);
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
			new Notice(`"${path}" is a file, not a folder. Check your Film Tracker settings.`);
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
		const prefix = this.folderPrefix(folder);
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (prefix !== "" && !file.path.startsWith(prefix)) continue;
			if (this.app.metadataCache.getFileCache(file)?.frontmatter?.tmdb_id === tmdbId) {
				return file;
			}
		}
		return null;
	}

	private async openNote(file: TFile): Promise<void> {
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}
