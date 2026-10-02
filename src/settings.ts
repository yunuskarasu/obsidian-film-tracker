import {
	AbstractInputSuggest,
	App,
	PluginSettingTab,
	SecretComponent,
	Setting,
	TFolder,
	requireApiVersion,
	type SettingControl,
	type SettingDefinitionItem,
	type SettingGroup,
} from "obsidian";
import type FilmTrackerPlugin from "./main";
import { KEY_FIELDS, keychainOf, readKey, type ApiKey } from "./secrets";

export interface FilmTrackerSettings {
	/** The TMDB key as typed in — before Obsidian 1.11.4, which brought the keychain (see secrets.ts). */
	apiKey: string;
	/** The keychain secret holding the TMDB key, from 1.11.4 on. */
	apiKeySecretName: string;
	filmFolder: string;
	posterFolder: string;
	directorFolder: string;
	directorPhotoFolder: string;
	linkDirectors: boolean;
	linkGenres: boolean;
	addCast: boolean;
	castCount: number;
	linkCast: boolean;
	addComposers: boolean;
	linkComposers: boolean;
	showConnections: boolean;
	showFilmography: boolean;
	showSeasons: boolean;
	showTvSeries: boolean;
	tvFolder: string;
	tvPosterFolder: string;
	/** A show's own metadata settings, kept apart from a film's: the two are watched differently. */
	linkCreators: boolean;
	linkTvGenres: boolean;
	addTvCast: boolean;
	tvCastCount: number;
	linkTvCast: boolean;
	malClientId: string;
	malClientIdSecretName: string;
	/** IGDB's two values — a Twitch app's client ID and secret — typed in, or (from 1.11.4) the names of their keychain secrets. */
	igdbClientId: string;
	igdbClientIdSecretName: string;
	igdbClientSecret: string;
	igdbClientSecretSecretName: string;
	gameFolder: string;
	gameCoverFolder: string;
	/** A game's developers and publishers as links, where their notes exist. */
	linkDevelopers: boolean;
	/** IGDB's short platform names, "PS4". */
	shortPlatformNames: boolean;
	/** Only the platforms in `myPlatforms`. */
	onlyMyPlatforms: boolean;
	/** "PC, PS5, Switch". */
	myPlatforms: string;
	/** How many platforms a game note lists; 0 leaves the property out. */
	platformCount: number;
	/** The DLC panel under a game. */
	showDlcs: boolean;
	animeFolder: string;
	animePosterFolder: string;
	mangakaFolder: string;
	mangakaPhotoFolder: string;
	/** Music has settings of its own, apart from films' and series': it links different people. */
	artistFolder: string;
	albumFolder: string;
	/** Each album in a folder of its own, its note inside under the same name, with the songs added from it. */
	albumFolderNotes: boolean;
	songFolder: string;
	albumCoverFolder: string;
	artistPhotoFolder: string;
	linkArtists: boolean;
	linkMusicGenres: boolean;
	showTracklist: boolean;
	showDiscography: boolean;
	/** The LYRICS panel under a song, and with it every request to LRCLIB. */
	showLyrics: boolean;
	/** The SOUNDTRACK panel under a film, a TV series or an anime. */
	showSoundtracks: boolean;
	/** The SCORES panel under an artist: what they scored in the vault. */
	showScores: boolean;
	/** Album and track titles in another script shown in Latin letters, where the album note has them. */
	showLatinTitles: boolean;
	/** New album and song notes named in Latin letters, their own title kept in `original_title`. */
	latinNoteNames: boolean;
}

export const DEFAULT_SETTINGS: FilmTrackerSettings = {
	apiKey: "",
	apiKeySecretName: "",
	filmFolder: "Films",
	posterFolder: "",
	directorFolder: "Directors",
	directorPhotoFolder: "",
	linkDirectors: true,
	linkGenres: false,
	addCast: false,
	castCount: 5,
	linkCast: false,
	addComposers: false,
	linkComposers: false,
	showConnections: true,
	showFilmography: true,
	showSeasons: true,
	showTvSeries: true,
	tvFolder: "TV",
	tvPosterFolder: "",
	linkCreators: true,
	linkTvGenres: false,
	addTvCast: false,
	tvCastCount: 5,
	linkTvCast: false,
	malClientId: "",
	malClientIdSecretName: "",
	igdbClientId: "",
	igdbClientIdSecretName: "",
	igdbClientSecret: "",
	igdbClientSecretSecretName: "",
	gameFolder: "Games",
	gameCoverFolder: "",
	linkDevelopers: false,
	shortPlatformNames: true,
	onlyMyPlatforms: false,
	myPlatforms: "",
	platformCount: 10,
	showDlcs: true,
	animeFolder: "Anime",
	animePosterFolder: "",
	mangakaFolder: "Mangaka",
	mangakaPhotoFolder: "",
	artistFolder: "Music/Artists",
	albumFolder: "Music/Albums",
	albumFolderNotes: true,
	songFolder: "Music/Songs",
	albumCoverFolder: "Music/Pics/Covers",
	artistPhotoFolder: "Music/Pics/Artists",
	linkArtists: true,
	linkMusicGenres: false,
	showTracklist: true,
	showDiscography: true,
	showLyrics: true,
	showSoundtracks: true,
	showScores: true,
	showLatinTitles: false,
	latinNoteNames: false,
};

/** Added to a key's description once it lives in Obsidian's keychain. */
const KEYCHAIN_NOTE = " It's kept in Obsidian's keychain on this device only: not in the vault, so it doesn't sync.";

export const TMDB_ATTRIBUTION =
	"This product uses the TMDB API but is not endorsed or certified by TMDB.";

export const IGDB_ATTRIBUTION = "Game data from IGDB.com.";

const FOLLOW_ATTACHMENTS = "Follow attachment settings";

/**
 * Folder suggestions for a plain text field — what Obsidian's own `folder`
 * control does from 1.13 on, for the versions before it.
 */
class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private readonly input: HTMLInputElement;

	constructor(app: App, input: HTMLInputElement) {
		super(app, input);
		this.input = input;
	}

	protected getSuggestions(query: string): TFolder[] {
		const wanted = query.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder && file.path !== "/")
			.filter((folder) => folder.path.toLowerCase().includes(wanted))
			.slice(0, 20);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.input.trigger("input");
		this.close();
	}
}

export class FilmTrackerSettingTab extends PluginSettingTab {
	private readonly plugin: FilmTrackerPlugin;

	constructor(app: App, plugin: FilmTrackerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Every setting, described rather than drawn, on a page of its own for
	 * each kind of note. Obsidian 1.13 renders these itself: each page is an
	 * entry that opens it, and its settings search — the box above every tab —
	 * finds a setting on any of them. It also gives the folder fields their
	 * vault folder suggestions. `display` draws the same pages one after
	 * another on earlier versions. The pages only arrange the settings: each
	 * is saved under the same name as ever.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const inKeychain = keychainOf(this.app) !== null;
		return [
			{
				type: "page",
				name: "🔑 API keys",
				desc: "The TMDB key for films and TV series, the MyAnimeList client ID for anime and manga, and IGDB's client ID and secret for games. Music needs none.",
				displayValue: () => this.keysSummary(),
				items: [
					{
						type: "group",
						heading: "Keys",
						items: [
							{
								name: "TMDB API key",
								desc: this.apiKeyDescription(inKeychain),
								aliases: ["themoviedb", "film metadata"],
								render: (setting) => this.renderKey(setting, "tmdb"),
							},
							{
								name: "MyAnimeList client ID",
								desc: this.malClientIdDescription(inKeychain),
								aliases: ["MAL", "anime metadata", "manga metadata"],
								render: (setting) => this.renderKey(setting, "mal"),
							},
							{
								name: "IGDB client ID",
								desc: this.igdbDescription(inKeychain, "Client ID"),
								aliases: ["IGDB", "Twitch", "game metadata"],
								render: (setting) => this.renderKey(setting, "igdbId"),
							},
							{
								name: "IGDB client secret",
								desc: this.igdbDescription(inKeychain, "Client Secret"),
								aliases: ["IGDB", "Twitch", "game metadata"],
								render: (setting) => this.renderKey(setting, "igdbSecret"),
							},
						],
					},
				],
			},
			{
				type: "page",
				name: "🎬 Films",
				desc: "Folders, metadata, panels, and importing from Letterboxd.",
				items: [
					{
						type: "group",
						heading: "Folders",
						items: [
							{
								name: "Film folder",
								desc: "Where new film notes are created. Leave empty for the vault root.",
								control: { type: "folder", key: "filmFolder", placeholder: "Films" },
							},
							{
								name: "Poster folder",
								desc: "Where posters are saved. Leave empty to follow your attachment folder setting.",
								control: { type: "folder", key: "posterFolder", placeholder: FOLLOW_ATTACHMENTS },
							},
							{
								name: "Director folder",
								desc: "Where new director notes are created. Leave empty for the vault root.",
								control: { type: "folder", key: "directorFolder", placeholder: "Directors" },
							},
							{
								name: "Director photo folder",
								desc: "Where director photos are saved. Leave empty to follow your attachment folder setting.",
								control: { type: "folder", key: "directorPhotoFolder", placeholder: FOLLOW_ATTACHMENTS },
							},
						],
					},
					{
						type: "group",
						heading: "Metadata",
						items: [
							{
								name: "Link directors",
								desc: "Write directors as [[wikilinks]] when a note with that name already exists, so the film shows up in the director's backlinks.",
								control: { type: "toggle", key: "linkDirectors" },
							},
							{
								name: "Link genres",
								desc: "The same for genres. Off by default: genre notes become very busy hubs.",
								control: { type: "toggle", key: "linkGenres" },
							},
							{
								name: "Add cast",
								desc: "Write a cast property with the film's top-billed actors.",
								control: { type: "toggle", key: "addCast" },
							},
							{
								name: "Cast count",
								desc: "How many top-billed actors to include. Only used when add cast is on.",
								control: {
									type: "number",
									key: "castCount",
									min: 1,
									defaultValue: DEFAULT_SETTINGS.castCount,
									placeholder: String(DEFAULT_SETTINGS.castCount),
								},
							},
							{
								name: "Link cast",
								desc: "Write cast as [[wikilinks]] when a note with that name already exists, so the film shows up in the actor's backlinks.",
								control: { type: "toggle", key: "linkCast" },
							},
							{
								name: "Add composers",
								desc: "Write a composers property with the film's original score composer.",
								control: { type: "toggle", key: "addComposers" },
							},
							{
								name: "Link composers",
								desc: "Write composers as [[wikilinks]] when a note with that name already exists.",
								control: { type: "toggle", key: "linkComposers" },
							},
						],
					},
					{
						type: "group",
						heading: "Panels",
						items: [
							{
								name: "Show connections",
								desc: "Below a film's or TV series' properties, list other films and series in your vault that share a director, creator, composer or cast member.",
								control: { type: "toggle", key: "showConnections" },
							},
							{
								name: "Show filmography",
								desc: "Below a person's properties, list their films in your vault, linked directly.",
								control: { type: "toggle", key: "showFilmography" },
							},
						],
					},
					{
						type: "group",
						heading: "Import",
						items: [
							{
								name: "Import from Letterboxd",
								desc:
									"Export your data from Letterboxd, unzip it, and drag diary.csv (or watched.csv) " +
									"into your vault. This creates a note for each film not already in your vault, " +
									"with watch_date filled in from diary.csv, and can mark the films as watched.",
								render: (setting) => {
									setting.addButton((button) =>
										button.setButtonText("Import…").onClick(() => this.plugin.startImportFromLetterboxd()),
									);
								},
							},
						],
					},
				],
			},
			{
				type: "page",
				name: "📺 TV series",
				desc: "Folders, metadata and panels.",
				items: [
					{
						type: "group",
						heading: "Folders",
						items: [
							{
								name: "TV series folder",
								desc: "Where new TV series notes are created. Leave empty for the vault root.",
								control: { type: "folder", key: "tvFolder", placeholder: "TV" },
							},
							{
								name: "TV series poster folder",
								desc: "Where TV series posters are saved. Leave empty to follow your attachment folder setting.",
								control: { type: "folder", key: "tvPosterFolder", placeholder: FOLLOW_ATTACHMENTS },
							},
						],
					},
					{
						type: "group",
						heading: "Metadata",
						items: [
							{
								name: "Link creators",
								desc: "Write a series' creators as [[wikilinks]] when a note with that name already exists, so the series shows up in their backlinks. A creator is to a series what a director is to a film, and they share the same notes.",
								control: { type: "toggle", key: "linkCreators" },
							},
							{
								name: "Link genres",
								desc: "The same for a series' genres. Off by default: genre notes become very busy hubs.",
								aliases: ["TV genres"],
								control: { type: "toggle", key: "linkTvGenres" },
							},
							{
								name: "Add cast",
								desc: "Write a cast property with the series' top-billed actors, counted across every season.",
								aliases: ["TV cast"],
								control: { type: "toggle", key: "addTvCast" },
							},
							{
								name: "Cast count",
								desc: "How many top-billed actors to include on a series. Only used when add cast is on.",
								aliases: ["TV cast count"],
								control: {
									type: "number",
									key: "tvCastCount",
									min: 1,
									defaultValue: DEFAULT_SETTINGS.tvCastCount,
									placeholder: String(DEFAULT_SETTINGS.tvCastCount),
								},
							},
							{
								name: "Link cast",
								desc: "Write a series' cast as [[wikilinks]] when a note with that name already exists.",
								aliases: ["TV cast links"],
								control: { type: "toggle", key: "linkTvCast" },
							},
						],
					},
					{
						type: "group",
						heading: "Panels",
						items: [
							{
								name: "Show seasons",
								desc: "Below a TV series' properties, list its seasons with a checkbox and a bar for each — where watching a series is recorded.",
								control: { type: "toggle", key: "showSeasons" },
							},
							{
								name: "Show TV series",
								desc: "Below a person's properties, list the TV series they created that are in your vault, in their own group under the filmography.",
								control: { type: "toggle", key: "showTvSeries" },
							},
						],
					},
				],
			},
			{
				type: "page",
				name: "🌸 Anime & manga",
				desc: "Folders, and importing from MyAnimeList.",
				items: [
					{
						type: "group",
						heading: "Folders",
						items: [
							{
								name: "Anime/manga folder",
								desc: "Where new anime and manga notes are created (the same folder for both, since a series note can hold either or both). Leave empty for the vault root.",
								control: { type: "folder", key: "animeFolder", placeholder: "Anime" },
							},
							{
								name: "Anime/manga poster folder",
								desc: "Where anime and manga posters are saved — kept as two separate files (a series note can show both). Leave empty to follow your attachment folder setting.",
								control: { type: "folder", key: "animePosterFolder", placeholder: FOLLOW_ATTACHMENTS },
							},
							{
								name: "Mangaka folder",
								desc: "Where new mangaka notes are created. Kept separate from the anime/manga folder, the same way directors have their own folder apart from films. Leave empty for the vault root.",
								control: { type: "folder", key: "mangakaFolder", placeholder: "Mangaka" },
							},
							{
								name: "Mangaka photo folder",
								desc: "Where mangaka photos are saved. Leave empty to follow your attachment folder setting.",
								control: { type: "folder", key: "mangakaPhotoFolder", placeholder: FOLLOW_ATTACHMENTS },
							},
						],
					},
					{
						type: "group",
						heading: "Import",
						items: [
							{
								name: "Import from MyAnimeList",
								desc:
									"Reads a public MyAnimeList list and creates a note for each anime and manga on it, " +
									"with what you have completed marked watched or read. Anything already in your " +
									"vault is left where it is.",
								render: (setting) => {
									setting.addButton((button) =>
										button.setButtonText("Import…").onClick(() => this.plugin.startImportFromMal()),
									);
								},
							},
						],
					},
				],
			},
			{
				type: "page",
				name: "🎵 Music",
				desc: "Folders, metadata and panels.",
				items: [
					{
						type: "group",
						heading: "Folders",
						items: [
							{
								name: "Artist folder",
								desc: "Where new artist notes are created. Leave empty for the vault root.",
								control: { type: "folder", key: "artistFolder", placeholder: DEFAULT_SETTINGS.artistFolder },
							},
							{
								name: "Album folder",
								desc: "Where new album notes are created. Leave empty for the vault root.",
								control: { type: "folder", key: "albumFolder", placeholder: DEFAULT_SETTINGS.albumFolder },
							},
							{
								name: "Album notes as folder notes",
								desc: "Give each new album a folder of its own, with the album's note inside under the same name, and put the songs you add from it in that folder. Works on its own. With the Folder Notes plugin, clicking an album's folder opens its note. Turn off to keep albums side by side in the album folder and songs in the song folder.",
								control: { type: "toggle", key: "albumFolderNotes" },
							},
							{
								name: "Song folder",
								desc: "Where new song notes are created when album notes aren't folder notes. Leave empty for the vault root.",
								control: { type: "folder", key: "songFolder", placeholder: DEFAULT_SETTINGS.songFolder },
							},
							{
								name: "Album cover folder",
								desc: "Where album covers are saved. Leave empty to follow your attachment folder setting.",
								control: { type: "folder", key: "albumCoverFolder", placeholder: FOLLOW_ATTACHMENTS },
							},
							{
								name: "Artist photo folder",
								desc: "Where artist photos are saved. Leave empty to follow your attachment folder setting.",
								control: { type: "folder", key: "artistPhotoFolder", placeholder: FOLLOW_ATTACHMENTS },
							},
						],
					},
					{
						type: "group",
						heading: "Metadata",
						items: [
							{
								name: "Link artists",
								desc: "Write an album's artists as [[wikilinks]] when a note with that name already exists. An album never creates its artist's note: add the artist yourself, and the next albums link to it.",
								control: { type: "toggle", key: "linkArtists" },
							},
							{
								name: "Link genres",
								desc: "The same for an album's genres. Off by default: genre notes become very busy hubs.",
								aliases: ["Music genres"],
								control: { type: "toggle", key: "linkMusicGenres" },
							},
						],
					},
					{
						type: "group",
						heading: "Titles in other scripts",
						items: [
							{
								name: "Show titles in Latin letters",
								desc: "Show an album's and its tracks' titles in Latin letters on the panels — romaji where MusicBrainz has it, English otherwise — for albums added from now on with a title in another script, such as Japanese. The notes themselves stay as they are.",
								aliases: ["romaji", "Japanese titles", "transliteration"],
								control: { type: "toggle", key: "showLatinTitles" },
							},
							{
								name: "Name new notes in Latin letters",
								desc: "Give new album and song notes with a title in another script their title in Latin letters, as their name and title. Their own title is kept in original_title and aliases, so a search in either finds them. Notes already in your vault are never renamed.",
								aliases: ["romaji", "Japanese titles", "transliteration"],
								control: { type: "toggle", key: "latinNoteNames" },
							},
						],
					},
					{
						type: "group",
						heading: "Panels",
						items: [
							{
								name: "Show tracklist",
								desc: "Below an album's properties, list its tracks.",
								control: { type: "toggle", key: "showTracklist" },
							},
							{
								name: "Show discography",
								desc: "Below an artist's properties, list their albums that are in your vault, with a button to add another.",
								control: { type: "toggle", key: "showDiscography" },
							},
							{
								name: "Show lyrics",
								desc: "Below a song's properties, show its lyrics from LRCLIB, with a button to copy them into the note. Off, nothing is ever sent to LRCLIB.",
								control: { type: "toggle", key: "showLyrics" },
							},
							{
								name: "Show soundtracks",
								desc: "Below a film's, a TV series', an anime's or a game's properties, list the albums linked as its soundtrack, with a button to find another.",
								control: { type: "toggle", key: "showSoundtracks" },
							},
							{
								name: "Show scores",
								desc: "Below an artist's discography, list the films, TV series, anime and games in your vault they scored: named among a film's composers, or linked from one of their albums as its soundtrack.",
								control: { type: "toggle", key: "showScores" },
							},
						],
					},
				],
			},
			{
				type: "page",
				name: "🎮 Games",
				desc: "Folders, metadata, platforms and the DLC panel.",
				items: [
					{
						type: "group",
						heading: "Folders",
						items: [
							{
								name: "Game folder",
								desc: "Where new game notes are created. Leave empty for the vault root.",
								control: { type: "folder", key: "gameFolder", placeholder: DEFAULT_SETTINGS.gameFolder },
							},
							{
								name: "Game cover folder",
								desc: "Where game covers are saved. Leave empty to follow your attachment folder setting.",
								control: { type: "folder", key: "gameCoverFolder", placeholder: FOLLOW_ATTACHMENTS },
							},
						],
					},
					{
						type: "group",
						heading: "Metadata",
						items: [
							{
								name: "Link developers",
								desc: "Write a game's developers and publishers as [[wikilinks]] when a note with that name already exists, so the game shows up in the studio's backlinks.",
								aliases: ["Link publishers", "studios"],
								control: { type: "toggle", key: "linkDevelopers" },
							},
						],
					},
					{
						type: "group",
						heading: "Platforms",
						items: [
							{
								name: "Platforms to list",
								desc: "How many of a game's platforms its note lists. 0 leaves the platforms property out altogether.",
								aliases: ["platform count"],
								control: {
									type: "number",
									key: "platformCount",
									min: 0,
									defaultValue: DEFAULT_SETTINGS.platformCount,
									placeholder: String(DEFAULT_SETTINGS.platformCount),
								},
							},
							{
								name: "Short platform names",
								desc: "PS4 and Switch rather than PlayStation 4 and Nintendo Switch.",
								control: { type: "toggle", key: "shortPlatformNames" },
							},
							{
								name: "Only my platforms",
								desc: "List only the platforms you play on, in your order, rather than every one a game came out on.",
								control: { type: "toggle", key: "onlyMyPlatforms" },
							},
							{
								name: "My platforms",
								desc: "The platforms you play on, separated by commas. Short or full names both work: PC, PS5, Nintendo Switch.",
								visible: () => this.plugin.settings.onlyMyPlatforms,
								control: { type: "text", key: "myPlatforms", placeholder: "PC, PS5, Switch" },
							},
						],
					},
					{
						type: "group",
						heading: "Panels",
						items: [
							{
								name: "Show DLCs",
								desc: "Below a game's properties, list the DLCs and expansions added to it, each with a checkbox, and a button to add another.",
								aliases: ["DLC", "expansions"],
								control: { type: "toggle", key: "showDlcs" },
							},
						],
					},
				],
			},
			{
				name: "Attribution",
				desc: `${TMDB_ATTRIBUTION} ${IGDB_ATTRIBUTION}`,
				searchable: false,
				render: (setting) => {
					setting.settingEl.empty();
					setting.settingEl.createEl("p", { text: TMDB_ATTRIBUTION, cls: "film-tracker-attribution" });
					setting.settingEl.createEl("p", { text: IGDB_ATTRIBUTION, cls: "film-tracker-attribution" });
				},
			},
		];
	}

	/** What the API keys entry says without being opened: which keys are set — IGDB's only with both of its values. */
	private keysSummary(): string {
		const keychain = keychainOf(this.app);
		const has = (key: ApiKey) => readKey(keychain, this.plugin.settings, key) !== "";
		const state = (set: boolean) => (set ? "set" : "not set");
		return `TMDB: ${state(has("tmdb"))} · MyAnimeList: ${state(has("mal"))} · IGDB: ${state(has("igdbId") && has("igdbSecret"))}`;
	}

	/** Reads a setting by the key its definition names. */
	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof FilmTrackerSettings];
	}

	/** Saves a setting the user changed, and redraws the panels when one of theirs was the setting. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		settings[key] = typeof value === "string" ? value.trim() : value;
		await this.plugin.saveSettings();
		if (key.startsWith("show")) this.plugin.refreshPanels();
		// The API keys entry says which keys are set, and My platforms only shows with
		// Only my platforms on: from 1.13 `update` redraws the page at once. Before
		// 1.13 the tab shows the change the next time it is opened.
		const tab = this as { update?: () => void };
		if ((key.endsWith("SecretName") || key === "onlyMyPlatforms") && typeof tab.update === "function") tab.update();
	}

	/**
	 * Obsidian 1.13 renders `getSettingDefinitions` itself and never calls
	 * this; earlier versions draw the same definitions here.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.drawAll(containerEl, this.getSettingDefinitions(), "");
	}

	/** Pages and groups become headings — "🎬 Films: Folders" — with their settings under them. */
	private drawAll(containerEl: HTMLElement, items: SettingDefinitionItem[], page: string): void {
		for (const item of items) {
			if (!("type" in item)) {
				this.draw(containerEl, item);
			} else if (item.type === "page") {
				this.drawAll(containerEl, item.items ?? [], item.name);
			} else {
				const heading = item.heading === undefined ? page : page === "" ? item.heading : `${page}: ${item.heading}`;
				if (heading !== "") new Setting(containerEl).setName(heading).setHeading();
				this.drawAll(containerEl, item.items ?? [], page);
			}
		}
	}

	private draw(containerEl: HTMLElement, item: SettingDefinitionItem): void {
		if ("type" in item) return;
		const visible = "visible" in item ? item.visible : undefined;
		if (visible === false || (typeof visible === "function" && !visible())) return;

		const setting = new Setting(containerEl).setName(item.name);
		if (item.desc !== undefined) setting.setDesc(item.desc);

		if ("render" in item && item.render !== undefined) {
			// Only this file writes these callbacks, and none of them reads the
			// group Obsidian's own renderer would pass in.
			item.render(setting, undefined as unknown as SettingGroup);
		} else if ("control" in item && item.control !== undefined) {
			this.drawControl(setting, item.control);
		}
	}

	private drawControl(setting: Setting, control: SettingControl): void {
		const save = (value: unknown) => void this.setControlValue(control.key, value);
		const current = this.getControlValue(control.key);

		if (control.type === "toggle") {
			setting.addToggle((toggle) => toggle.setValue(current === true).onChange(save));
			return;
		}

		const placeholder = "placeholder" in control ? (control.placeholder ?? "") : "";
		const value = typeof current === "string" || typeof current === "number" ? String(current) : "";
		setting.addText((text) => {
			text.setPlaceholder(placeholder).setValue(value);
			if (control.type === "number") {
				text.onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					const min = "min" in control && typeof control.min === "number" ? control.min : 1;
					if (Number.isFinite(parsed) && parsed >= min) save(parsed);
				});
			} else {
				text.onChange(save);
			}
			if (control.type === "folder") new FolderSuggest(this.app, text.inputEl);
		});
	}

	/**
	 * A key's row: Obsidian's own picker from 1.11.4 on, where the setting
	 * holds the name of the keychain secret rather than the key. Before that —
	 * or wherever the keychain and its picker aren't really there, whatever
	 * the version says — the key is typed in and saved with the settings.
	 */
	private renderKey(setting: Setting, key: ApiKey): void {
		const secretName = KEY_FIELDS[key].secretName;
		const plain = KEY_FIELDS[key].plain;
		const keychain = keychainOf(this.app);

		if (requireApiVersion("1.11.4") && keychain !== null && typeof SecretComponent === "function") {
			setting.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings[secretName])
					.onChange((value) => void this.setControlValue(secretName, value)),
			);
			return;
		}

		setting.addText((text) => {
			text.inputEl.type = "password";
			text
				.setPlaceholder(key === "tmdb" ? "Paste your key" : key === "igdbSecret" ? "Paste your client secret" : "Paste your client ID")
				.setValue(this.plugin.settings[plain])
				.onChange((value) => void this.setControlValue(plain, value));
		});
	}

	private apiKeyDescription(inKeychain: boolean): DocumentFragment {
		const fragment = new DocumentFragment();
		fragment.append("Create a free key in your ");
		fragment.createEl("a", {
			text: "TMDB account settings",
			href: "https://www.themoviedb.org/settings/api",
		});
		fragment.append(", then copy the ");
		fragment.createEl("strong", { text: "API key (v3 auth)" });
		fragment.append(" value.");
		if (inKeychain) fragment.append(KEYCHAIN_NOTE);
		return fragment;
	}

	/** IGDB is run by Twitch: its key is a Twitch app's client ID and secret, both from the same page. */
	private igdbDescription(inKeychain: boolean, value: "Client ID" | "Client Secret"): DocumentFragment {
		const fragment = new DocumentFragment();
		fragment.append("Register a free app in the ");
		fragment.createEl("a", { text: "Twitch developer console", href: "https://dev.twitch.tv/console/apps" });
		fragment.append(" (OAuth redirect URL: http://localhost, client type: Confidential), then copy its ");
		fragment.createEl("strong", { text: value });
		fragment.append(value === "Client Secret" ? " — the New Secret button shows it once." : ".");
		if (inKeychain) fragment.append(KEYCHAIN_NOTE);
		return fragment;
	}

	private malClientIdDescription(inKeychain: boolean): DocumentFragment {
		const fragment = new DocumentFragment();
		fragment.append("Register a free app in your ");
		fragment.createEl("a", {
			text: "MyAnimeList API config",
			href: "https://myanimelist.net/apiconfig",
		});
		fragment.append(", then copy its ");
		fragment.createEl("strong", { text: "Client ID" });
		fragment.append(".");
		if (inKeychain) fragment.append(KEYCHAIN_NOTE);
		return fragment;
	}
}
