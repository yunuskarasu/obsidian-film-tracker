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
import { keychainOf } from "./secrets";

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
	malClientId: string;
	malClientIdSecretName: string;
	animeFolder: string;
	animePosterFolder: string;
	mangakaFolder: string;
	mangakaPhotoFolder: string;
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
	malClientId: "",
	malClientIdSecretName: "",
	animeFolder: "Anime",
	animePosterFolder: "",
	mangakaFolder: "Mangaka",
	mangakaPhotoFolder: "",
};

/** Added to a key's description once it lives in Obsidian's keychain. */
const KEYCHAIN_NOTE = " It's kept in Obsidian's keychain on this device only: not in the vault, so it doesn't sync.";

export const TMDB_ATTRIBUTION =
	"This product uses the TMDB API but is not endorsed or certified by TMDB.";

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
	 * Every setting, described rather than drawn. Obsidian 1.13 renders these
	 * itself, which is what puts them in its settings search and gives the
	 * folder fields their vault folder suggestions; `display` draws the same
	 * list on earlier versions.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const inKeychain = keychainOf(this.app) !== null;
		return [
			{
				type: "group",
				heading: "🔑 API & integrations",
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
				],
			},
			{
				type: "group",
				heading: "🎬 Cinema: folders",
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
				heading: "🎬 Cinema: film metadata",
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
				heading: "🎬 Cinema: panels",
				items: [
					{
						name: "Show connections",
						desc: "Below a film's properties, list other films in your vault that share a director, composer or cast member.",
						control: { type: "toggle", key: "showConnections" },
					},
					{
						name: "Show filmography",
						desc: "Below a director's properties, list their films in your vault, linked directly.",
						control: { type: "toggle", key: "showFilmography" },
					},
				],
			},
			{
				type: "group",
				heading: "🎬 Cinema: Letterboxd",
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
			{
				type: "group",
				heading: "🌸 Anime & manga: MyAnimeList",
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
			{
				type: "group",
				heading: "🌸 Anime & manga: folders",
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
				name: "Attribution",
				desc: TMDB_ATTRIBUTION,
				searchable: false,
				render: (setting) => {
					setting.settingEl.empty();
					setting.settingEl.createEl("p", { text: TMDB_ATTRIBUTION, cls: "film-tracker-attribution" });
				},
			},
		];
	}

	/** Reads a setting by the key its definition names. */
	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof FilmTrackerSettings];
	}

	/** Saves a setting the user changed, and redraws the panels when one of theirs is turned off. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		settings[key] = typeof value === "string" ? value.trim() : value;
		await this.plugin.saveSettings();
		if (key === "showConnections") this.plugin.setShowConnections(value === true);
		if (key === "showFilmography") this.plugin.setShowFilmography(value === true);
	}

	/**
	 * Obsidian 1.13 renders `getSettingDefinitions` itself and never calls
	 * this; earlier versions draw the same definitions here.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const item of this.getSettingDefinitions()) {
			if (!("type" in item)) {
				this.draw(containerEl, item);
				continue;
			}
			const heading = "heading" in item ? item.heading : undefined;
			if (heading !== undefined) new Setting(containerEl).setName(heading).setHeading();
			for (const child of ("items" in item ? item.items : undefined) ?? []) this.draw(containerEl, child);
		}
	}

	private draw(containerEl: HTMLElement, item: SettingDefinitionItem): void {
		if ("type" in item) return;

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
					if (Number.isFinite(parsed) && parsed > 0) save(parsed);
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
	private renderKey(setting: Setting, key: "tmdb" | "mal"): void {
		const secretName = key === "tmdb" ? "apiKeySecretName" : "malClientIdSecretName";
		const plain = key === "tmdb" ? "apiKey" : "malClientId";
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
				.setPlaceholder(key === "tmdb" ? "Paste your key" : "Paste your client ID")
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
