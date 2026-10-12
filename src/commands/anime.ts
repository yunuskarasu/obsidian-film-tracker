import type { Plugin, TFile } from "obsidian";
import { hasAnime, hasManga } from "../note-kind";
import { openAnimeSearch, openMangaSearch } from "../search-modal";
import type { Services } from "../services";

/** Anime, manga and their mangaka, from MyAnimeList. */
export class AnimeCommands {
	constructor(private readonly services: Services) {}

	register(plugin: Plugin): void {
		const { services } = this;

		plugin.addCommand({
			id: "add-anime",
			name: "Add anime",
			callback: () => this.startAddAnime(),
		});

		plugin.addCommand({
			id: "add-manga",
			name: "Add manga",
			callback: () => this.startAddManga(),
		});

		plugin.addCommand({
			id: "add-mangaka",
			name: "Add mangaka",
			checkCallback: (checking) => {
				const file = services.app.workspace.getActiveFile();
				const mangaMalId = file === null ? null : services.notes.mangaIdOf(file);
				if (file === null || mangaMalId === null) return false;
				if (!checking) this.startAddMangaka(file, mangaMalId);
				return true;
			},
		});

		plugin.addCommand({
			id: "refresh-anime-metadata",
			name: "Refresh anime/manga metadata from MAL",
			checkCallback: (checking) => {
				const file = services.app.workspace.getActiveFile();
				const note = file === null ? null : services.notes.kindOf(file);
				// A TV series note only belongs here once it has a manga side.
				const mal =
					note?.kind === "series" || note?.kind === "mangaka" || (note?.kind === "tv" && note.mangaMalId !== null);
				if (file === null || !mal) return false;
				if (!checking) {
					const client = services.mal();
					if (client !== null) void services.anime.refresh(client, file);
				}
				return true;
			},
		});

		plugin.addCommand({
			id: "read-today",
			name: "Mark manga as read today",
			checkCallback: (checking) => this.onMangaSide(checking, (file) => services.anime.markReadToday(file)),
		});

		plugin.addCommand({
			id: "read-chapter",
			name: "Read one more chapter",
			checkCallback: (checking) => this.onMangaSide(checking, (file) => services.anime.readOneMoreChapter(file)),
		});

		plugin.addCommand({
			id: "remove-anime",
			name: "Remove anime",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !hasAnime(note.kind)) return false;
				if (!checking) void services.anime.removeAnime(note.file);
				return true;
			},
		});
	}

	/** A command that needs the manga side of the note in the editor. */
	private onMangaSide(checking: boolean, run: (file: TFile) => Promise<void>): boolean {
		const note = this.services.activeNote();
		if (note === null || !hasManga(note.kind)) return false;
		if (!checking) void run(note.file);
		return true;
	}

	startAddAnime(): void {
		const client = this.services.mal();
		if (client === null) return;
		openAnimeSearch(this.services.app, client, (result) => void this.services.anime.addAnime(client, result));
	}

	startAddManga(): void {
		const client = this.services.mal();
		if (client === null) return;
		openMangaSearch(this.services.app, client, (result) => void this.services.anime.addManga(client, result));
	}

	startAddMangaka(file: TFile, mangaMalId: number): void {
		const client = this.services.mal();
		if (client === null) return;
		void this.services.anime.addMangaka(client, file, mangaMalId);
	}

	/** "Change manga" on the MANGA panel: the same search box Add manga uses, swapping in the pick. */
	startChangeManga(file: TFile): void {
		const client = this.services.mal();
		if (client === null) return;
		openMangaSearch(this.services.app, client, (result) => void this.services.anime.changeManga(client, result, file));
	}

	/** "Add adaptation" on the MANGA panel: an anime search whose pick is paired with this note's manga. */
	startAddAdaptation(file: TFile): void {
		const client = this.services.mal();
		if (client === null) return;
		const mangaMalId = this.services.notes.mangaIdOf(file);
		if (mangaMalId === null) return;
		openAnimeSearch(this.services.app, client, (result) => {
			void this.services.anime.addAdaptation(client, result, file, mangaMalId);
		});
	}
}
