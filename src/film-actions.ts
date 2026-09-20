import { Notice, type App, type TFile } from "obsidian";
import {
	buildDirectorFileName,
	buildDirectorNoteContent,
	refreshDirectorFrontmatter,
} from "./director-note";
import {
	buildFileName,
	buildNoteContent,
	markWatched,
	refreshFrontmatter,
	relinkFrontmatter,
	setWatchDate,
	today,
	type FilmMetadata,
	type LinkOptions,
} from "./note";
import type { FilmTrackerSettings } from "./settings";
import type { DirectorMetadata, FilmSearchResult, PersonSearchResult, TmdbClient } from "./tmdb";
import { noteName, reportFailures, type VaultNotes } from "./vault-notes";

function names(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

/** How `createFilmNote` ended: `conflict` is a note of the user's own under the film's name. */
export type FilmNoteResult = "created" | "conflict" | "no-folder";

/** Everything the plugin does with TMDB: film and director notes. */
export class FilmActions {
	private readonly app: App;
	private readonly notes: VaultNotes;
	private readonly settings: () => FilmTrackerSettings;

	constructor(app: App, notes: VaultNotes, settings: () => FilmTrackerSettings) {
		this.app = app;
		this.notes = notes;
		this.settings = settings;
	}

	/**
	 * Links are only written where a note by that name already exists, so a
	 * film never leaves an unresolved link behind. The relink command is what
	 * catches films added before their director note existed.
	 */
	private linkOptions(sourcePath: string): LinkOptions {
		const settings = this.settings();
		return {
			directors: settings.linkDirectors,
			genres: settings.linkGenres,
			cast: settings.linkCast,
			composers: settings.linkComposers,
			addCast: settings.addCast,
			addComposers: settings.addComposers,
			castCount: settings.castCount,
			isResolved: this.notes.isResolved(sourcePath),
		};
	}

	/** "Refresh metadata from TMDB" on a film or a director note. */
	async refresh(client: TmdbClient, file: TFile): Promise<void> {
		const note = this.notes.kindOf(file);
		if (note?.kind === "film") await this.refreshFilm(client, file, note.tmdbId);
		else if (note?.kind === "director") await this.refreshDirector(client, file, note.tmdbId);
	}

	private async refreshFilm(client: TmdbClient, file: TFile, tmdbId: number): Promise<void> {
		await reportFailures("refresh the film", async () => {
			const film = await client.getFilm(tmdbId);
			const posterLink = await this.posterLinkIfMissing(client, film, file);
			// The note's current values, so the refresh can tell the aliases it
			// wrote apart from the ones the user added (see `refreshFrontmatter`).
			const previous = this.notes.frontmatterOf(file) ?? {};

			const refreshed = await this.notes.rewriteFrontmatter(file, (content) =>
				refreshFrontmatter(content, film, this.linkOptions(file.path), posterLink, previous),
			);
			if (refreshed) new Notice(`Refreshed ${film.title}`);
		});
	}

	/** Only fills in a poster that is missing; an existing one is never replaced. */
	private async posterLinkIfMissing(
		client: TmdbClient,
		film: FilmMetadata,
		file: TFile,
	): Promise<string | null> {
		const current: unknown = this.notes.frontmatterOf(file)?.poster;
		if (typeof current === "string" && current.trim() !== "") return null;

		const poster = await this.savePoster(client, film, buildFileName(film.title, film.year), file.path);
		return poster === null ? null : this.notes.imageLink(poster, file.path);
	}

	private async savePoster(
		client: TmdbClient,
		film: FilmMetadata,
		baseName: string,
		notePath: string,
	): Promise<TFile | null> {
		const posterPath = film.posterPath;
		if (!posterPath) return null;
		return this.notes.saveImage(
			() => client.downloadImage(posterPath),
			`${baseName}.jpg`,
			notePath,
			this.settings().posterFolder,
			"the poster",
		);
	}

	private async refreshDirector(client: TmdbClient, file: TFile, tmdbId: number): Promise<void> {
		await reportFailures("refresh the director", async () => {
			const director = await client.getPerson(tmdbId);
			const photoLink = await this.directorPhotoLinkIfMissing(client, director, file);
			const previous = this.notes.frontmatterOf(file) ?? {};

			const refreshed = await this.notes.rewriteFrontmatter(file, (content) =>
				refreshDirectorFrontmatter(content, director, photoLink, previous),
			);
			if (refreshed) new Notice(`Refreshed ${director.name}`);
		});
	}

	/** Only fills in a photo that is missing; an existing one is never replaced. */
	private async directorPhotoLinkIfMissing(
		client: TmdbClient,
		director: DirectorMetadata,
		file: TFile,
	): Promise<string | null> {
		const current: unknown = this.notes.frontmatterOf(file)?.poster;
		if (typeof current === "string" && current.trim() !== "") return null;

		const photo = await this.saveDirectorPhoto(client, director, buildDirectorFileName(director.name), file.path);
		return photo === null ? null : this.notes.imageLink(photo, file.path);
	}

	private async saveDirectorPhoto(
		client: TmdbClient,
		director: DirectorMetadata,
		baseName: string,
		notePath: string,
	): Promise<TFile | null> {
		const photoPath = director.photoPath;
		if (!photoPath) return null;
		return this.notes.saveImage(
			() => client.downloadImage(photoPath),
			`${baseName}.jpg`,
			notePath,
			this.settings().directorPhotoFolder,
			"the director photo",
		);
	}

	async addFilm(client: TmdbClient, result: FilmSearchResult): Promise<void> {
		await reportFailures("add the film", async () => {
			const film = await client.getFilm(result.id);
			const existing = this.notes.findNote({ kind: "film", tmdbId: film.tmdbId });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.notes.openNote(existing);
				return;
			}
			await this.createFilmNote(client, film);
		});
	}

	/**
	 * `open: false` is what the Letterboxd import uses: hundreds of films
	 * should not each open a tab or pop a Notice. `watched` is the import's
	 * "Mark as watched" choice; a film added by hand always starts unwatched.
	 */
	async createFilmNote(
		client: TmdbClient,
		film: FilmMetadata,
		options: { watchDate?: string | null; watched?: boolean; open?: boolean } = {},
	): Promise<FilmNoteResult> {
		const open = options.open !== false;

		const target = await this.notes.newNotePath(this.settings().filmFolder, [
			buildFileName(film.title, film.year),
		]);
		if (target === null) return "no-folder";
		if ("conflict" in target) {
			if (open) await this.notes.openConflict(target.conflict);
			return "conflict";
		}
		const notePath = target.path;

		const poster = await this.savePoster(client, film, noteName(notePath), notePath);
		const posterLink = poster ? this.notes.imageLink(poster, notePath) : null;

		let content = buildNoteContent(film, posterLink, this.linkOptions(notePath));
		if (options.watchDate) content = setWatchDate(content, options.watchDate);
		if (options.watched) content = markWatched(content);

		const note = await this.app.vault.create(notePath, content);
		if (!open) return "created";

		await this.notes.openNote(note);
		if (poster) {
			new Notice(`Added ${film.title}`);
		} else if (film.posterPath) {
			new Notice(`Added ${film.title}, but the poster could not be downloaded.`);
		} else {
			new Notice(`Added ${film.title}. TMDB has no poster for this film.`);
		}
		return "created";
	}

	async addDirector(client: TmdbClient, result: PersonSearchResult): Promise<void> {
		await reportFailures("add the director", async () => {
			const director = await client.getPerson(result.id);
			const existing = this.notes.findNote({ kind: "director", tmdbId: director.tmdbId });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.notes.openNote(existing);
				return;
			}
			await this.createDirectorNote(client, director);
		});
	}

	private async createDirectorNote(client: TmdbClient, director: DirectorMetadata): Promise<void> {
		const target = await this.notes.newNotePath(this.settings().directorFolder, [
			buildDirectorFileName(director.name),
		]);
		if (target === null) return;
		if ("conflict" in target) {
			await this.notes.openConflict(target.conflict);
			return;
		}
		const notePath = target.path;

		const photo = await this.saveDirectorPhoto(client, director, noteName(notePath), notePath);
		const photoLink = photo ? this.notes.imageLink(photo, notePath) : null;

		const content = buildDirectorNoteContent(director, photoLink);
		const note = await this.app.vault.create(notePath, content);
		await this.notes.openNote(note);

		if (photo) {
			new Notice(`Added ${director.name}`);
		} else if (director.photoPath) {
			new Notice(`Added ${director.name}, but the photo could not be downloaded.`);
		} else {
			new Notice(`Added ${director.name}. TMDB has no photo for this person.`);
		}
	}

	/**
	 * "Mark as watched today" on a film note: `watched`, and `watch_date`
	 * unless the note already has one — the day it was first seen is the
	 * user's, so a rewatch doesn't write over it.
	 */
	async markWatchedToday(file: TFile): Promise<void> {
		const frontmatter = this.notes.frontmatterOf(file);
		const alreadyWatched = frontmatter?.watched === true;
		const date = today();
		const readable = await this.notes.rewriteFrontmatter(file, (content) =>
			setWatchDate(markWatched(content), date),
		);
		if (!readable) return;

		new Notice(
			alreadyWatched ? `${file.basename} was already watched.` : `Marked ${file.basename} as watched today.`,
		);
	}

	/** "Relink directors and genres": no network, just names turned into links where notes now exist. */
	async relinkAll(): Promise<void> {
		const settings = this.settings();
		let changed = 0;

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.notes.kindOf(file)?.kind !== "film") continue;
			const frontmatter = this.notes.frontmatterOf(file);
			if (frontmatter === undefined) continue;

			const values = {
				directors: settings.linkDirectors ? names(frontmatter.directors) : undefined,
				genres: settings.linkGenres ? names(frontmatter.genres) : undefined,
				cast: settings.linkCast ? names(frontmatter.cast) : undefined,
				composers: settings.linkComposers ? names(frontmatter.composers) : undefined,
			};
			const isResolved = this.notes.isResolved(file.path);

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
}
