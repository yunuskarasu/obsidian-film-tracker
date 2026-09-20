import { Menu, Notice, Plugin, TFile, debounce } from "obsidian";
import { AnimeActions } from "./anime-actions";
import { ConfirmModal } from "./confirm-modal";
import { FilmActions } from "./film-actions";
import { FilmNoteLayout } from "./film-note-layout";
import { CsvFileModal } from "./import-file-modal";
import { ImportConfirmModal, ImportProgressModal } from "./import-progress-modal";
import { isWatchedExport, parseLetterboxdCsv, type LetterboxdRow } from "./letterboxd-import";
import { LetterboxdImporter } from "./letterboxd-importer";
import { LinkConfirmModal } from "./link-confirm-modal";
import { MalClient } from "./mal";
import { MalImportModal } from "./mal-import-modal";
import { MalListImporter } from "./mal-importer";
import { MangakaPickerModal } from "./mangaka-picker-modal";
import type { NoteKind } from "./note-kind";
import { openAnimeSearch, openDirectorSearch, openFilmSearch, openMangaSearch } from "./search-modal";
import { isMissingHere, keychainOf, moveKeysToKeychain, readKey, type ApiKey } from "./secrets";
import { DEFAULT_SETTINGS, FilmTrackerSettingTab, type FilmTrackerSettings } from "./settings";
import { TmdbClient } from "./tmdb";
import { VaultNotes } from "./vault-notes";

/**
 * The plugin itself: commands, the ribbon menu, the settings tab and the note
 * layout. What the commands actually do lives in `FilmActions` (TMDB),
 * `AnimeActions` (MyAnimeList) and `LetterboxdImporter`; this class opens
 * the search boxes and dialogs and hands them the user's choices.
 */
export default class FilmTrackerPlugin extends Plugin {
	settings: FilmTrackerSettings = DEFAULT_SETTINGS;
	private layout: FilmNoteLayout | null = null;
	private readonly notes = new VaultNotes(this.app);
	private readonly films = new FilmActions(this.app, this.notes, () => this.settings);
	private readonly anime = new AnimeActions(this.app, this.notes, () => this.settings, {
		confirmLink: (workTitle, side, noteName, alsoIn) =>
			new Promise((resolve) => {
				new LinkConfirmModal(this.app, workTitle, side, noteName, alsoIn, resolve).open();
			}),
		pickMangaka: (candidates, onPick) => new MangakaPickerModal(this.app, candidates, onPick).open(),
		confirm: (request) =>
			new Promise((resolve) => {
				new ConfirmModal(this.app, request, resolve).open();
			}),
	});
	private readonly importer = new LetterboxdImporter(this.app, this.notes, this.films);
	private readonly malImporter = new MalListImporter(this.app, this.notes, this.anime);

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
				const mangaMalId = file === null ? null : this.notes.seriesMangaIdOf(file);
				if (file === null || mangaMalId === null) return false;
				if (!checking) this.startAddMangaka(file, mangaMalId);
				return true;
			},
		});

		this.addCommand({
			id: "refresh-film-metadata",
			name: "Refresh metadata from TMDB",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const kind = file === null ? undefined : this.notes.kindOf(file)?.kind;
				if (file === null || (kind !== "film" && kind !== "director")) return false;
				if (!checking) {
					const client = this.tmdb();
					if (client !== null) void this.films.refresh(client, file);
				}
				return true;
			},
		});

		this.addCommand({
			id: "refresh-anime-metadata",
			name: "Refresh anime/manga metadata from MAL",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const kind = file === null ? undefined : this.notes.kindOf(file)?.kind;
				if (file === null || (kind !== "series" && kind !== "mangaka")) return false;
				if (!checking) {
					const client = this.mal();
					if (client !== null) void this.anime.refresh(client, file);
				}
				return true;
			},
		});

		this.addCommand({
			id: "watched-today",
			name: "Mark as watched today",
			checkCallback: (checking) => {
				const note = this.activeNote();
				const film = note?.kind.kind === "film";
				const anime = note?.kind.kind === "series" && note.kind.animeMalId !== null;
				if (note === null || !(film || anime)) return false;
				if (!checking) {
					void (film ? this.films.markWatchedToday(note.file) : this.anime.markWatchedToday(note.file));
				}
				return true;
			},
		});

		this.addCommand({
			id: "read-today",
			name: "Mark manga as read today",
			checkCallback: (checking) => this.onMangaSide(checking, (file) => this.anime.markReadToday(file)),
		});

		this.addCommand({
			id: "watch-episode",
			name: "Watch one more episode",
			checkCallback: (checking) => {
				const note = this.activeNote();
				if (note === null || note.kind.kind !== "series" || note.kind.animeMalId === null) return false;
				if (!checking) void this.anime.watchOneMoreEpisode(note.file);
				return true;
			},
		});

		this.addCommand({
			id: "read-chapter",
			name: "Read one more chapter",
			checkCallback: (checking) => this.onMangaSide(checking, (file) => this.anime.readOneMoreChapter(file)),
		});

		this.addCommand({
			id: "relink-film-notes",
			name: "Relink directors and genres",
			callback: () => void this.films.relinkAll(),
		});

		this.addCommand({
			id: "import-letterboxd",
			name: "Import from Letterboxd",
			callback: () => this.startImportFromLetterboxd(),
		});

		this.addCommand({
			id: "import-mal",
			name: "Import from MyAnimeList",
			callback: () => this.startImportFromMal(),
		});

		this.addRibbonIcon("film", "Add film, anime or manga", (evt) => {
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
			const mangaMalId = activeFile === null ? null : this.notes.seriesMangaIdOf(activeFile);
			menu.addItem((item) => {
				item.setTitle("Add mangaka").setIcon("user").setDisabled(mangaMalId === null);
				if (activeFile !== null && mangaMalId !== null) {
					item.onClick(() => this.startAddMangaka(activeFile, mangaMalId));
				}
			});

			menu.showAtMouseEvent(evt);
		});
	}

	onunload(): void {
		this.layout?.removeAll();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<FilmTrackerSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };

		// On Obsidian 1.11.4 or later, keys typed in before move into its
		// keychain, and out of data.json (see `moveKeysToKeychain`).
		const keychain = keychainOf(this.app);
		if (keychain !== null && moveKeysToKeychain(keychain, this.settings)) await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	setShowConnections(value: boolean): void {
		this.layout?.setShowConnections(value);
		this.layout?.refresh();
	}

	setShowFilmography(value: boolean): void {
		this.layout?.setShowFilmography(value);
		this.layout?.refresh();
	}

	/** A film note goes to TMDB's side of the plugin, an anime note to MAL's; both write the same two fields. */
	private async watchedToday(file: TFile): Promise<void> {
		const kind = this.notes.kindOf(file);
		if (kind?.kind === "film") await this.films.markWatchedToday(file);
		else if (kind?.kind === "series" && kind.animeMalId !== null) await this.anime.markWatchedToday(file);
	}

	/**
	 * The same four commands on a note's own menus — right-click in the editor,
	 * the tab's ⋮ menu, or the file explorer — so watching an episode doesn't
	 * have to go through the command palette. Only what the note actually has
	 * is offered.
	 */
	private addNoteMenuItems(menu: Menu, file: TFile | null): void {
		const kind = file === null ? null : this.notes.kindOf(file);
		if (file === null || kind === null) return;

		const entries: { title: string; icon: string; run: () => void }[] = [];
		const anime = kind.kind === "series" && kind.animeMalId !== null;
		if (kind.kind === "film" || anime) {
			entries.push({ title: "Mark as watched today", icon: "check", run: () => void this.watchedToday(file) });
		}
		if (anime) {
			entries.push({
				title: "Watch one more episode",
				icon: "play",
				run: () => void this.anime.watchOneMoreEpisode(file),
			});
		}
		if (kind.kind === "series" && kind.mangaMalId !== null) {
			entries.push({
				title: "Mark manga as read today",
				icon: "check",
				run: () => void this.anime.markReadToday(file),
			});
			entries.push({
				title: "Read one more chapter",
				icon: "book-open",
				run: () => void this.anime.readOneMoreChapter(file),
			});
		}

		for (const entry of entries) {
			menu.addItem((item) => item.setTitle(entry.title).setIcon(entry.icon).onClick(entry.run));
		}
	}

	/** The note in the editor and what it is, for the commands that only apply to one kind of note. */
	private activeNote(): { file: TFile; kind: NoteKind } | null {
		const file = this.app.workspace.getActiveFile();
		const kind = file === null ? null : this.notes.kindOf(file);
		return file === null || kind === null ? null : { file, kind };
	}

	/** A command that needs the manga side of the note in the editor. */
	private onMangaSide(checking: boolean, run: (file: TFile) => Promise<void>): boolean {
		const note = this.activeNote();
		if (note === null || note.kind.kind !== "series" || note.kind.mangaMalId === null) return false;
		if (!checking) void run(note.file);
		return true;
	}

	/** A TMDB client, or `null` once the user has been pointed at the missing key. */
	private tmdb(): TmdbClient | null {
		const key = this.key("tmdb", "TMDB API key");
		return key === null ? null : new TmdbClient(key);
	}

	/** A MyAnimeList client, or `null` once the user has been pointed at the missing client ID. */
	private mal(): MalClient | null {
		const clientId = this.key("mal", "MyAnimeList client ID");
		return clientId === null ? null : new MalClient(clientId);
	}

	/** One of the keys (see secrets.ts), or `null` after a Notice saying where to set it. */
	private key(key: ApiKey, name: string): string | null {
		const keychain = keychainOf(this.app);
		const value = readKey(keychain, this.settings, key);
		if (value !== "") return value;
		new Notice(
			isMissingHere(keychain, this.settings, key)
				? `Your ${name} isn't in this device's keychain yet. Add it in Film + Anime-Manga Tracker settings.`
				: `Set your ${name} in Film + Anime-Manga Tracker settings.`,
		);
		return null;
	}

	private setUpLayout(): void {
		const layout = new FilmNoteLayout(
			this.app,
			this.settings.showConnections,
			this.settings.showFilmography,
			{
				change: (file) => this.startChangeManga(file),
				remove: (file) => void this.anime.removeManga(file),
				addAdaptation: (file) => this.startAddAdaptation(file),
				setRead: (file, read) => void this.anime.syncMangaRead(file, read),
				readChapter: (file) => void this.anime.readOneMoreChapter(file),
				watchEpisode: (file) => void this.anime.watchOneMoreEpisode(file),
				watchedToday: (file) => void this.watchedToday(file),
			},
		);
		this.layout = layout;
		const refresh = () => layout.refresh();

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				this.addNoteMenuItems(menu, file instanceof TFile ? file : null);
			}),
		);
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, _editor, info) => {
				this.addNoteMenuItems(menu, info.file ?? null);
			}),
		);

		// Opening a note, switching tabs or modes: redraw at once, so the
		// poster never appears a beat after the note itself.
		this.registerEvent(this.app.workspace.on("layout-change", refresh));
		this.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
		this.registerEvent(this.app.workspace.on("file-open", refresh));

		/**
		 * Metadata changes arrive in bursts — every save of any note fires
		 * `changed`, and `resolved` follows it each time — so those wait for a
		 * quiet moment and redraw once. Connections compare the open note
		 * against every other film in the vault, which is why they listen at
		 * all: on a cold start the cache fills in after the workspace is
		 * restored, and the delayed retries below catch that up too.
		 */
		const refreshSoon = debounce(refresh, 250, true);
		this.register(() => refreshSoon.cancel());
		this.registerEvent(this.app.metadataCache.on("changed", () => refreshSoon()));
		this.registerEvent(this.app.metadataCache.on("resolved", () => refreshSoon()));
		this.app.workspace.onLayoutReady(() => {
			refresh();
			for (const delayMs of [1000, 3000, 6000, 12000]) {
				const timer = window.setTimeout(refresh, delayMs);
				this.register(() => window.clearTimeout(timer));
			}
		});
	}

	private startAddFilm(): void {
		const client = this.tmdb();
		if (client === null) return;
		openFilmSearch(this.app, client, (result) => void this.films.addFilm(client, result));
	}

	private startAddDirector(): void {
		const client = this.tmdb();
		if (client === null) return;
		openDirectorSearch(this.app, client, (result) => void this.films.addDirector(client, result));
	}

	private startAddAnime(): void {
		const client = this.mal();
		if (client === null) return;
		openAnimeSearch(this.app, client, (result) => void this.anime.addAnime(client, result));
	}

	private startAddManga(): void {
		const client = this.mal();
		if (client === null) return;
		openMangaSearch(this.app, client, (result) => void this.anime.addManga(client, result));
	}

	private startAddMangaka(file: TFile, mangaMalId: number): void {
		const client = this.mal();
		if (client === null) return;
		void this.anime.addMangaka(client, file, mangaMalId);
	}

	/** "Change manga" on the MANGA panel: the same search box Add manga uses, swapping in the pick. */
	private startChangeManga(file: TFile): void {
		const client = this.mal();
		if (client === null) return;
		openMangaSearch(this.app, client, (result) => void this.anime.changeManga(client, result, file));
	}

	/** "Add adaptation" on the MANGA panel: an anime search whose pick is paired with this note's manga. */
	private startAddAdaptation(file: TFile): void {
		const client = this.mal();
		if (client === null) return;
		const mangaMalId = this.notes.seriesMangaIdOf(file);
		if (mangaMalId === null) return;
		openAnimeSearch(this.app, client, (result) => {
			void this.anime.addAdaptation(client, result, file, mangaMalId);
		});
	}

	startImportFromLetterboxd(): void {
		if (this.importRunning()) return;
		const client = this.tmdb();
		if (client === null) return;
		new CsvFileModal(this.app, (file) => void this.beginLetterboxdImport(client, file)).open();
	}

	/** Only one import runs at a time, of either kind; a second is turned away. */
	private importRunning(): boolean {
		if (!this.importer.running && !this.malImporter.running) return false;
		new Notice("An import is already running.");
		return true;
	}

	/** "Import from MyAnimeList": a note for everything on a public MAL list (see `MalListImporter`). */
	startImportFromMal(): void {
		if (this.importRunning()) return;
		const client = this.mal();
		if (client === null) return;
		new MalImportModal(this.app, (userName, selection) => {
			// Asked again: another import may have started while this dialog was open.
			if (this.importRunning()) return;
			const progress = new ImportProgressModal(this.app, "Importing from MyAnimeList…");
			progress.open();
			void this.malImporter.run(client, userName, selection, progress);
		}).open();
	}

	private async beginLetterboxdImport(client: TmdbClient, file: TFile): Promise<void> {
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

		new ImportConfirmModal(this.app, rows.length, isWatchedExport(file.basename), (markAsWatched) => {
			// Asked again: another import may have started while this dialog was open.
			if (this.importRunning()) return;
			const progress = new ImportProgressModal(this.app, "Importing from Letterboxd…");
			progress.open();
			void this.importer.run(client, rows, markAsWatched, progress);
		}).open();
	}
}
