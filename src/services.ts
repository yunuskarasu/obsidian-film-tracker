import { moment, normalizePath, Notice, type App, type PluginManifest, type TFile } from "obsidian";
import { AlreadyTrackedModal, type AlreadyTrackedChoice, type TrackedSide } from "./already-tracked-modal";
import { AnimeActions } from "./anime-actions";
import { BookActions } from "./book-actions";
import { ConfirmModal } from "./confirm-modal";
import { FilmActions } from "./film-actions";
import { GameActions } from "./game-actions";
import { IgdbClient } from "./igdb";
import { LinkConfirmModal } from "./link-confirm-modal";
import { LrclibClient } from "./lrclib";
import { LyricsCache } from "./lyrics-cache";
import { LyricsService } from "./lyrics-service";
import { MalClient } from "./mal";
import { MangakaPickerModal } from "./mangaka-picker-modal";
import { MusicActions } from "./music-actions";
import { MusicBrainzClient } from "./musicbrainz";
import { canListen, hasAnime, isBook, isGame, type NoteKind } from "./note-kind";
import { OpenLibraryClient } from "./openlibrary";
import { ImageUrlModal, PhotoPickerModal, VaultImageModal } from "./photo-picker-modal";
import { EditionPickerModal, IsbnModal } from "./search-modal";
import { isMissingHere, keychainOf, readKey, type ApiKey } from "./secrets";
import type { FilmTrackerSettings } from "./settings";
import { TmdbClient } from "./tmdb";
import { TvActions } from "./tv-actions";
import { VaultNotes } from "./vault-notes";
import { WikidataClient } from "./wikidata";

/** What the services need of the plugin: its app and manifest, its settings, and a way to redraw the panels. */
export interface PluginHost {
	readonly app: App;
	readonly manifest: PluginManifest;
	settings: FilmTrackerSettings;
	refreshPanels(): void;
}

/**
 * Everything the commands, the menus and the panels share: the vault's
 * notes, what each kind of note can have done to it (`FilmActions` for TMDB,
 * `AnimeActions` for MyAnimeList, and so on), and a client for each service,
 * with the key it needs. What the plugin does lives in those classes; the
 * commands only open the search boxes and dialogs and hand them the user's
 * choices.
 */
export class Services {
	readonly app: App;
	readonly notes: VaultNotes;
	readonly films: FilmActions;
	readonly anime: AnimeActions;
	readonly tv: TvActions;
	/** Song lyrics, kept beside the plugin's own files rather than in data.json with the keys — see lyrics-cache.ts. */
	readonly lyrics: LyricsService;
	readonly music: MusicActions;
	readonly games: GameActions;
	readonly books: BookActions;

	constructor(private readonly host: PluginHost) {
		const app = host.app;
		const settings = () => host.settings;
		this.app = app;
		this.notes = new VaultNotes(app);
		this.films = new FilmActions(app, this.notes, settings);
		this.anime = new AnimeActions(app, this.notes, settings, {
			confirmLink: (workTitle, side, noteName, alsoIn) =>
				new Promise((resolve) => {
					new LinkConfirmModal(app, workTitle, side, noteName, alsoIn, resolve).open();
				}),
			pickMangaka: (candidates, onPick) => new MangakaPickerModal(app, candidates, onPick).open(),
			confirm: (request) =>
				new Promise((resolve) => {
					new ConfirmModal(app, request, resolve).open();
				}),
			alsoTracked: (title, noteNames, side) => this.askAlsoTracked(title, noteNames, side),
		});
		this.tv = new TvActions(app, this.notes, settings, {
			alsoTracked: (title, noteNames, side) => this.askAlsoTracked(title, noteNames, side),
		});
		const manifest = host.manifest;
		this.lyrics = new LyricsService(
			() => new LrclibClient(manifest.version),
			new LyricsCache(app.vault.adapter, normalizePath(`${manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`}/lyrics.json`)),
			() => host.refreshPanels(),
		);
		this.music = new MusicActions(app, this.notes, settings, {
			pickPhoto: (artistName, candidates) =>
				new Promise((resolve) => {
					new PhotoPickerModal(app, artistName, candidates, resolve).open();
				}),
			pickVaultImage: () =>
				new Promise((resolve) => {
					new VaultImageModal(app, resolve).open();
				}),
			askImageUrl: () =>
				new Promise((resolve) => {
					new ImageUrlModal(app, resolve).open();
				}),
			confirm: (request) =>
				new Promise((resolve) => {
					new ConfirmModal(app, request, resolve).open();
				}),
		});
		this.games = new GameActions(app, this.notes, settings);
		this.books = new BookActions(app, this.notes, settings, {
			// Obsidian sets moment's locale to its own language, on every version the plugin supports.
			language: () => moment.locale(),
			pickEdition: (bookTitle, editions) =>
				new Promise((resolve) => {
					new EditionPickerModal(app, bookTitle, editions, resolve).open();
				}),
			askIsbn: () =>
				new Promise((resolve) => {
					new IsbnModal(app, resolve).open();
				}),
			confirm: (request) =>
				new Promise((resolve) => {
					new ConfirmModal(app, request, resolve).open();
				}),
		});
	}

	get settings(): FilmTrackerSettings {
		return this.host.settings;
	}

	/** The note in the editor and what it is, for the commands that only apply to one kind of note. */
	activeNote(): { file: TFile; kind: NoteKind } | null {
		const file = this.app.workspace.getActiveFile();
		const kind = file === null ? null : this.notes.kindOf(file);
		return file === null || kind === null ? null : { file, kind };
	}

	/**
	 * The button under a poster: a film or TV note goes to TMDB's side of the
	 * plugin, an anime note to MAL's, and an album is listened to rather than
	 * watched (see `MusicActions.markListenedToday`).
	 */
	async watchedToday(file: TFile): Promise<void> {
		const kind = this.notes.kindOf(file);
		if (isGame(kind)) await this.games.markCompletedToday(file);
		else if (isBook(kind)) await this.books.markFinishedToday(file);
		else if (canListen(kind)) await this.music.markListenedToday(file);
		else if (kind?.kind === "film") await this.films.markWatchedToday(file);
		else if (kind?.kind === "tv") await this.tv.markWatchedToday(file);
		else if (hasAnime(kind)) await this.anime.markWatchedToday(file);
	}

	/** "+1 episode": on a TV note it counts into the earliest season with something left. */
	async watchOneMoreEpisode(file: TFile): Promise<void> {
		const kind = this.notes.kindOf(file);
		if (kind?.kind === "tv") await this.tv.watchOneMoreEpisode(file);
		else if (hasAnime(kind)) await this.anime.watchOneMoreEpisode(file);
	}

	/** "Already in your vault as an anime / a TV series": the same question, whichever side is being added. */
	private askAlsoTracked(title: string, noteNames: string[], side: TrackedSide): Promise<AlreadyTrackedChoice | null> {
		return new Promise((resolve) => {
			new AlreadyTrackedModal(this.app, title, noteNames, side, resolve).open();
		});
	}

	/** A TMDB client, or `null` once the user has been pointed at the missing key. */
	tmdb(): TmdbClient | null {
		const key = this.key("tmdb", "TMDB API key");
		return key === null ? null : new TmdbClient(key);
	}

	/** MusicBrainz needs no key, only the plugin's name and version in every request. */
	musicbrainz(): MusicBrainzClient {
		return new MusicBrainzClient(this.host.manifest.version);
	}

	/** Open Library needs no key either, only the plugin's name and version in every request. */
	openLibrary(): OpenLibraryClient {
		return new OpenLibraryClient(this.host.manifest.version);
	}

	wikidata(): WikidataClient {
		return new WikidataClient(this.host.manifest.version);
	}

	/** An IGDB client, or `null` once the user has been pointed at whichever of its two values is missing. */
	igdb(): IgdbClient | null {
		const clientId = this.key("igdbId", "IGDB client ID");
		if (clientId === null) return null;
		const secret = this.key("igdbSecret", "IGDB client secret");
		return secret === null ? null : new IgdbClient(clientId, secret);
	}

	/** A MyAnimeList client, or `null` once the user has been pointed at the missing client ID. */
	mal(): MalClient | null {
		const clientId = this.key("mal", "MyAnimeList client ID");
		return clientId === null ? null : new MalClient(clientId);
	}

	/** One of the keys (see secrets.ts), or `null` after a Notice saying where to set it. */
	private key(key: ApiKey, name: string): string | null {
		const keychain = keychainOf(this.app);
		const value = readKey(keychain, this.host.settings, key);
		if (value !== "") return value;
		new Notice(
			isMissingHere(keychain, this.host.settings, key)
				? `Your ${name} isn't in this device's keychain yet. Add it in Film + Anime-Manga Tracker settings.`
				: `Set your ${name} in Film + Anime-Manga Tracker settings.`,
		);
		return null;
	}
}
