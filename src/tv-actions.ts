import { Notice, type App, type TFile } from "obsidian";
import type { AlreadyTrackedChoice, TrackedSide } from "./already-tracked-modal";
import { animeNoteTitles, looksLikeSameWork, showTitles } from "./anime-match";
import { buildFileName, today, type LinkOptions } from "./note";
import type { FilmTrackerSettings } from "./settings";
import type { TmdbClient } from "./tmdb";
import { detailsLookLikeAnime, type TvMetadata, type TvSearchResult } from "./tmdb-tv";
import {
	buildTvNoteContent,
	markTvWatched,
	nextSeason,
	refreshTvFrontmatter,
	seasonsReadable,
	setSeasonWatched,
	tvProgressOf,
	watchOneMoreOfSeason,
} from "./tv-note";
import { noteName, reportFailures, type VaultNotes } from "./vault-notes";

/** What a TV command needs to ask the user. */
export interface TvUi {
	/**
	 * "Already in your vault as an anime" — see `AlreadyTrackedModal`. `side`
	 * says what the notes already there are; `null` when the dialog is dismissed.
	 */
	alsoTracked(title: string, noteNames: string[], side: TrackedSide): Promise<AlreadyTrackedChoice | null>;
}

/** Everything the plugin does with TMDB's TV catalogue. */
export class TvActions {
	private readonly app: App;
	private readonly notes: VaultNotes;
	private readonly settings: () => FilmTrackerSettings;
	private readonly ui: TvUi;

	constructor(app: App, notes: VaultNotes, settings: () => FilmTrackerSettings, ui: TvUi) {
		this.app = app;
		this.notes = notes;
		this.settings = settings;
		this.ui = ui;
	}

	/**
	 * A series has its own settings, apart from a film's: someone linking
	 * every film's cast may well not want a cast list on every series, where
	 * it runs to a whole ensemble over several years. `directors` carries the
	 * creators, which are written in that slot (see `tv-note.ts`).
	 */
	private linkOptions(sourcePath: string): LinkOptions {
		const settings = this.settings();
		return {
			directors: settings.linkCreators,
			genres: settings.linkTvGenres,
			cast: settings.linkTvCast,
			composers: false,
			addCast: settings.addTvCast,
			addComposers: false,
			castCount: settings.tvCastCount,
			isResolved: this.notes.isResolved(sourcePath),
		};
	}

	async addTv(client: TmdbClient, result: TvSearchResult): Promise<void> {
		await reportFailures("add the TV series", async () => {
			const { show, details } = await client.getTv(result.id, today());

			const existing = this.notes.findNote({ kind: "tv", tmdbTvId: show.tmdbTvId });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.notes.openNote(existing);
				return;
			}

			if (detailsLookLikeAnime(details)) {
				const animeNotes = this.animeNotesFor(show);
				if (animeNotes.length > 0) {
					const choice = await this.ui.alsoTracked(
						show.title,
						animeNotes.map((note) => note.basename),
						"anime",
					);
					if (choice === null) return;
					if (choice === "open") {
						await this.notes.openNote(animeNotes[0]);
						return;
					}
				}
			}

			await this.createTvNote(client, show);
		});
	}

	/**
	 * The anime notes that look like this show. TMDB and MyAnimeList share no
	 * id, so this goes by the titles alone and only ever leads to a question
	 * (see `anime-match.ts`).
	 */
	private animeNotesFor(show: TvMetadata): TFile[] {
		const titles = showTitles(show);
		return this.app.vault.getMarkdownFiles().filter((file) => {
			const note = this.notes.kindOf(file);
			if (note?.kind !== "series" || note.animeMalId === null) return false;
			return looksLikeSameWork(titles, animeNoteTitles(this.notes.frontmatterOf(file)));
		});
	}

	private async createTvNote(client: TmdbClient, show: TvMetadata): Promise<void> {
		const target = await this.notes.newNotePath(this.settings().tvFolder, [
			buildFileName(show.title, show.year),
		]);
		if (target === null) return;
		if ("conflict" in target) {
			await this.notes.openConflict(target.conflict);
			return;
		}
		const notePath = target.path;

		const poster = await this.savePoster(client, show, noteName(notePath), notePath);
		const posterLink = poster ? this.notes.imageLink(poster, notePath) : null;

		const content = buildTvNoteContent(show, posterLink, this.linkOptions(notePath));
		const note = await this.app.vault.create(notePath, content);
		await this.notes.openNote(note);

		if (poster) {
			new Notice(`Added ${show.title}`);
		} else if (show.posterPath) {
			new Notice(`Added ${show.title}, but the poster could not be downloaded.`);
		} else {
			new Notice(`Added ${show.title}. TMDB has no poster for this show.`);
		}
	}

	private async savePoster(
		client: TmdbClient,
		show: TvMetadata,
		baseName: string,
		notePath: string,
	): Promise<TFile | null> {
		const posterPath = show.posterPath;
		if (!posterPath) return null;
		return this.notes.saveImage(
			() => client.downloadImage(posterPath),
			`${baseName}.jpg`,
			notePath,
			this.settings().tvPosterFolder,
			"the poster",
		);
	}

	/** "Refresh metadata from TMDB" on a TV note: new seasons, new lengths, nothing of the user's. */
	async refresh(client: TmdbClient, file: TFile, tmdbTvId: number): Promise<void> {
		await reportFailures("refresh the TV series", async () => {
			const { show } = await client.getTv(tmdbTvId, today());
			const posterLink = await this.posterLinkIfMissing(client, show, file);
			const previous = this.notes.frontmatterOf(file) ?? {};

			let seasonsOk = true;
			const readable = await this.notes.rewriteFrontmatter(file, (content) => {
				seasonsOk = seasonsReadable(content);
				return refreshTvFrontmatter(content, show, this.linkOptions(file.path), posterLink, previous);
			});
			if (!readable) return;
			// `refreshTvFrontmatter` leaves a note whose seasons it can't read
			// exactly as it is; saying it was refreshed would be a lie. A note
			// that is simply up to date was refreshed, with nothing to change.
			if (seasonsOk) new Notice(`Refreshed ${show.title}`);
			else this.seasonsUnreadable(file);
		});
	}

	/** Only fills in a poster that is missing; an existing one is never replaced. */
	private async posterLinkIfMissing(
		client: TmdbClient,
		show: TvMetadata,
		file: TFile,
	): Promise<string | null> {
		const current: unknown = this.notes.frontmatterOf(file)?.poster;
		if (typeof current === "string" && current.trim() !== "") return null;

		const poster = await this.savePoster(client, show, buildFileName(show.title, show.year), file.path);
		return poster === null ? null : this.notes.imageLink(poster, file.path);
	}

	/**
	 * "Mark as watched today": every episode that has aired, and the tick,
	 * whether or not the show has ended (see `markTvWatched`).
	 */
	async markWatchedToday(file: TFile): Promise<void> {
		const progress = tvProgressOf(this.notes.frontmatterOf(file));
		const date = today();
		if (!(await this.writeSeasons(file, (content) => markTvWatched(content, date)))) return;

		new Notice(
			progress.done ? `${file.basename} was already watched.` : `Marked ${file.basename} as watched today.`,
		);
	}

	/** "Watch one more episode" on the show: the earliest season with something left. */
	async watchOneMoreEpisode(file: TFile): Promise<void> {
		const progress = tvProgressOf(this.notes.frontmatterOf(file));
		const season = nextSeason(progress.seasons);
		if (season === null) {
			new Notice(`${file.basename} is watched up to its latest episode.`);
			return;
		}
		await this.watchOneMoreOfSeason(file, season.season);
	}

	/** "+1" on one season, on the SEASONS panel. */
	async watchOneMoreOfSeason(file: TFile, season: number): Promise<void> {
		// Counted from what the note holds now, so the notice says what was
		// written even before Obsidian has read the file back.
		const entry = tvProgressOf(this.notes.frontmatterOf(file)).seasons.find((item) => item.season === season);
		if (entry === undefined) return;
		if (entry.watched >= entry.episodes) {
			new Notice(`Season ${season} of ${file.basename} is already fully watched.`);
			return;
		}

		const date = today();
		if (!(await this.writeSeasons(file, (content) => watchOneMoreOfSeason(content, season, date)))) return;
		new Notice(`Season ${season}: episode ${entry.watched + 1} of ${entry.episodes} watched.`);
	}

	/** The SEASONS panel's own checkbox: a season watched in full, or back to nothing. */
	async setSeasonWatched(file: TFile, season: number, watched: boolean): Promise<void> {
		const date = watched ? today() : null;
		await this.writeSeasons(file, (content) => setSeasonWatched(content, season, watched, date));
	}

	/**
	 * A seasons edit, and whether it could be made: a note whose seasons
	 * can't be read is left as it is and said so, so no notice after it
	 * claims a change that was never written.
	 */
	private async writeSeasons(file: TFile, rewrite: (content: string) => string): Promise<boolean> {
		let seasonsOk = true;
		const readable = await this.notes.rewriteFrontmatter(file, (content) => {
			seasonsOk = seasonsReadable(content);
			return seasonsOk ? rewrite(content) : content;
		});
		if (readable && !seasonsOk) this.seasonsUnreadable(file);
		return readable && seasonsOk;
	}

	private seasonsUnreadable(file: TFile): void {
		new Notice(`Could not read the seasons of ${file.basename}, so it was left unchanged.`);
	}
}
