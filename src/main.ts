import { Plugin } from "obsidian";
import { AnimeCommands } from "./commands/anime";
import { BookCommands } from "./commands/books";
import { DiaryCommands } from "./commands/diary";
import { FilmCommands } from "./commands/films";
import { GameCommands } from "./commands/games";
import { ImportCommands } from "./commands/imports";
import { LibraryCommands } from "./commands/library";
import { MusicCommands } from "./commands/music";
import type { FilmNoteLayout } from "./film-note-layout";
import { setUpLayout } from "./panel-wiring";
import { addRibbonMenu } from "./ribbon-menu";
import { keychainOf, moveKeysToKeychain } from "./secrets";
import { Services } from "./services";
import { DEFAULT_SETTINGS, FilmTrackerSettingTab, type FilmTrackerSettings } from "./settings";

/**
 * The plugin itself: its settings, and the parts it is put together from.
 * `Services` holds what every part shares — the vault's notes, the actions
 * for each kind of note and a client for each service. Each kind's commands
 * are in `commands/`, the ribbon icon's menu in ribbon-menu.ts, a note's own
 * menu in note-menu.ts, and the poster and the panels in panel-wiring.ts.
 */
export default class FilmTrackerPlugin extends Plugin {
	settings: FilmTrackerSettings = DEFAULT_SETTINGS;
	private layout: FilmNoteLayout | null = null;
	private readonly services = new Services(this);
	private readonly diary = new DiaryCommands(this.services);
	private readonly library = new LibraryCommands(this.services, () => this.saveSettings());
	private readonly films = new FilmCommands(this.services);
	private readonly anime = new AnimeCommands(this.services);
	private readonly music = new MusicCommands(this.services);
	private readonly games = new GameCommands(this.services);
	private readonly books = new BookCommands(this.services);
	private readonly imports = new ImportCommands(this.services);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new FilmTrackerSettingTab(this.app, this));
		const { diary, library, films, anime, music, games, books } = this;
		this.layout = setUpLayout(this, this.services, { anime, music, games, books });
		diary.registerView(this);
		library.registerView(this);

		diary.register(this);
		library.register(this);
		films.register(this);
		anime.register(this);
		music.register(this);
		games.register(this);
		books.register(this);
		this.imports.register(this);
		addRibbonMenu(this, this.services, { diary, library, films, anime, music, games, books });
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

	/** Draws the note panels again, after a setting that decides which of them are shown. */
	refreshPanels(): void {
		this.layout?.refresh();
	}

	/** The settings tab's "Import…" buttons. */
	startImportFromLetterboxd(): void {
		this.imports.startImportFromLetterboxd();
	}

	startImportFromMal(): void {
		this.imports.startImportFromMal();
	}

	startImportFromGoodreads(): void {
		this.imports.startImportFromGoodreads();
	}
}
