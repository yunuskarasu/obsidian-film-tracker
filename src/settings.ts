import { App, PluginSettingTab, Setting } from "obsidian";
import type FilmTrackerPlugin from "./main";

export interface FilmTrackerSettings {
	apiKey: string;
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
	animeFolder: string;
	animePosterFolder: string;
	mangakaFolder: string;
	mangakaPhotoFolder: string;
}

export const DEFAULT_SETTINGS: FilmTrackerSettings = {
	apiKey: "",
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
	animeFolder: "Anime",
	animePosterFolder: "",
	mangakaFolder: "Mangaka",
	mangakaPhotoFolder: "",
};

export const TMDB_ATTRIBUTION =
	"This product uses the TMDB API but is not endorsed or certified by TMDB.";

export class FilmTrackerSettingTab extends PluginSettingTab {
	private readonly plugin: FilmTrackerPlugin;

	constructor(app: App, plugin: FilmTrackerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("🔑 API & Integrations").setHeading();

		new Setting(containerEl)
			.setName("TMDB API key")
			.setDesc(this.apiKeyDescription())
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("Paste your key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("MyAnimeList client ID")
			.setDesc(this.malClientIdDescription())
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("Paste your client ID")
					.setValue(this.plugin.settings.malClientId)
					.onChange(async (value) => {
						this.plugin.settings.malClientId = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName("🎬 Cinema").setHeading();
		new Setting(containerEl).setName("Folders").setHeading();

		new Setting(containerEl)
			.setName("Film folder")
			.setDesc("Where new film notes are created. Leave empty for the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Films")
					.setValue(this.plugin.settings.filmFolder)
					.onChange(async (value) => {
						this.plugin.settings.filmFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Poster folder")
			.setDesc("Where posters are saved. Leave empty to follow your attachment folder setting.")
			.addText((text) =>
				text
					.setPlaceholder("Follow attachment settings")
					.setValue(this.plugin.settings.posterFolder)
					.onChange(async (value) => {
						this.plugin.settings.posterFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Director folder")
			.setDesc("Where new director notes are created. Leave empty for the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Directors")
					.setValue(this.plugin.settings.directorFolder)
					.onChange(async (value) => {
						this.plugin.settings.directorFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Director photo folder")
			.setDesc("Where director photos are saved. Leave empty to follow your attachment folder setting.")
			.addText((text) =>
				text
					.setPlaceholder("Follow attachment settings")
					.setValue(this.plugin.settings.directorPhotoFolder)
					.onChange(async (value) => {
						this.plugin.settings.directorPhotoFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Film metadata").setHeading();

		new Setting(containerEl)
			.setName("Link directors")
			.setDesc(
				"Write directors as [[wikilinks]] when a note with that name already exists, so the film shows up in the director's backlinks.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.linkDirectors).onChange(async (value) => {
					this.plugin.settings.linkDirectors = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Link genres")
			.setDesc("The same for genres. Off by default: genre notes become very busy hubs.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.linkGenres).onChange(async (value) => {
					this.plugin.settings.linkGenres = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Add cast")
			.setDesc("Write a cast property with the film's top-billed actors.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.addCast).onChange(async (value) => {
					this.plugin.settings.addCast = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Cast count")
			.setDesc("How many top-billed actors to include. Only used when Add cast is on.")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.castCount))
					.setValue(String(this.plugin.settings.castCount))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (!Number.isFinite(parsed) || parsed <= 0) return;
						this.plugin.settings.castCount = parsed;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Link cast")
			.setDesc(
				"Write cast as [[wikilinks]] when a note with that name already exists, so the film shows up in the actor's backlinks.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.linkCast).onChange(async (value) => {
					this.plugin.settings.linkCast = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Add composers")
			.setDesc("Write a composers property with the film's original score composer.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.addComposers).onChange(async (value) => {
					this.plugin.settings.addComposers = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Link composers")
			.setDesc(
				"Write composers as [[wikilinks]] when a note with that name already exists.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.linkComposers).onChange(async (value) => {
					this.plugin.settings.linkComposers = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Panels").setHeading();

		new Setting(containerEl)
			.setName("Show connections")
			.setDesc(
				"Below a film's properties, list other films in your vault that share a director, composer or cast member.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showConnections).onChange(async (value) => {
					this.plugin.settings.showConnections = value;
					await this.plugin.saveSettings();
					this.plugin.setShowConnections(value);
				}),
			);

		new Setting(containerEl)
			.setName("Show filmography")
			.setDesc(
				"Below a director's properties, list their films in your vault, linked directly.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showFilmography).onChange(async (value) => {
					this.plugin.settings.showFilmography = value;
					await this.plugin.saveSettings();
					this.plugin.setShowFilmography(value);
				}),
			);

		new Setting(containerEl).setName("Letterboxd").setHeading();

		new Setting(containerEl)
			.setName("Import from Letterboxd")
			.setDesc(
				"Export your data from Letterboxd, unzip it, and drag diary.csv (or watched.csv) " +
					"into your vault. This creates a note for each film not already in your vault, " +
					"with watch_date filled in from diary.csv.",
			)
			.addButton((button) =>
				button
					.setButtonText("Import…")
					.onClick(() => this.plugin.startImportFromLetterboxd()),
			);

		new Setting(containerEl).setName("🌸 Anime & Manga").setHeading();
		new Setting(containerEl).setName("Folders").setHeading();

		new Setting(containerEl)
			.setName("Anime/manga folder")
			.setDesc(
				"Where new anime and manga notes are created (the same folder for both, since a Series note can hold either or both). Leave empty for the vault root.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Anime")
					.setValue(this.plugin.settings.animeFolder)
					.onChange(async (value) => {
						this.plugin.settings.animeFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Anime/manga poster folder")
			.setDesc(
				"Where anime and manga posters are saved — kept as two separate files (a Series note can show both). Leave empty to follow your attachment folder setting.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Follow attachment settings")
					.setValue(this.plugin.settings.animePosterFolder)
					.onChange(async (value) => {
						this.plugin.settings.animePosterFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Mangaka folder")
			.setDesc(
				"Where new mangaka notes are created. Kept separate from the anime/manga folder, the same way directors have their own folder apart from films. Leave empty for the vault root.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Mangaka")
					.setValue(this.plugin.settings.mangakaFolder)
					.onChange(async (value) => {
						this.plugin.settings.mangakaFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Mangaka photo folder")
			.setDesc("Where mangaka photos are saved. Leave empty to follow your attachment folder setting.")
			.addText((text) =>
				text
					.setPlaceholder("Follow attachment settings")
					.setValue(this.plugin.settings.mangakaPhotoFolder)
					.onChange(async (value) => {
						this.plugin.settings.mangakaPhotoFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("p", {
			text: TMDB_ATTRIBUTION,
			cls: "film-tracker-attribution",
		});
	}

	private apiKeyDescription(): DocumentFragment {
		const fragment = new DocumentFragment();
		fragment.append("Create a free key in your ");
		fragment.createEl("a", {
			text: "TMDB account settings",
			href: "https://www.themoviedb.org/settings/api",
		});
		fragment.append(", then copy the ");
		fragment.createEl("strong", { text: "API Key (v3 auth)" });
		fragment.append(" value.");
		return fragment;
	}

	private malClientIdDescription(): DocumentFragment {
		const fragment = new DocumentFragment();
		fragment.append("Register a free app in your ");
		fragment.createEl("a", {
			text: "MyAnimeList API config",
			href: "https://myanimelist.net/apiconfig",
		});
		fragment.append(", then copy its ");
		fragment.createEl("strong", { text: "Client ID" });
		fragment.append(".");
		return fragment;
	}
}
