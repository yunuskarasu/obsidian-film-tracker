import type { Plugin } from "obsidian";
import { canWatch, hasEpisodes } from "../note-kind";
import { openDirectorSearch, openFilmSearch, openTvSearch } from "../search-modal";
import type { Services } from "../services";

/** Films, TV series and directors, from TMDB. */
export class FilmCommands {
	constructor(private readonly services: Services) {}

	register(plugin: Plugin): void {
		const { services } = this;

		plugin.addCommand({
			id: "add-film",
			name: "Add film",
			callback: () => this.startAddFilm(),
		});

		plugin.addCommand({
			id: "add-tv",
			name: "Add TV series",
			callback: () => this.startAddTv(),
		});

		plugin.addCommand({
			id: "add-director",
			name: "Add director",
			callback: () => this.startAddDirector(),
		});

		plugin.addCommand({
			id: "refresh-film-metadata",
			name: "Refresh metadata from TMDB",
			checkCallback: (checking) => {
				const file = services.app.workspace.getActiveFile();
				const note = file === null ? null : services.notes.kindOf(file);
				const kind = note?.kind;
				if (file === null || (kind !== "film" && kind !== "director" && kind !== "tv")) return false;
				if (!checking) {
					const client = services.tmdb();
					if (client !== null && note?.kind === "tv") void services.tv.refresh(client, file, note.tmdbTvId);
					else if (client !== null) void services.films.refresh(client, file);
				}
				return true;
			},
		});

		plugin.addCommand({
			id: "watched-today",
			name: "Mark as watched today",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !canWatch(note.kind)) return false;
				if (!checking) void services.watchedToday(note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "watch-episode",
			name: "Watch one more episode",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !hasEpisodes(note.kind)) return false;
				if (!checking) void services.watchOneMoreEpisode(note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "relink-film-notes",
			name: "Relink directors and genres",
			callback: () => void services.films.relinkAll(),
		});
	}

	startAddFilm(): void {
		const client = this.services.tmdb();
		if (client === null) return;
		openFilmSearch(this.services.app, client, (result) => void this.services.films.addFilm(client, result));
	}

	startAddTv(): void {
		const client = this.services.tmdb();
		if (client === null) return;
		openTvSearch(this.services.app, client, (result) => void this.services.tv.addTv(client, result));
	}

	startAddDirector(): void {
		const client = this.services.tmdb();
		if (client === null) return;
		openDirectorSearch(this.services.app, client, (result) => void this.services.films.addDirector(client, result));
	}
}
