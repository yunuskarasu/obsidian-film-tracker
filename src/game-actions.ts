import { Notice, type App, type TFile } from "obsidian";
import { parsePlatformList, type GameDlc, type GameSearchResult } from "./game";
import { addGameDlc, buildGameNoteContent, gameDlcsOf, markGameCompleted, setGameDlcDone, playProgressOf, refreshGameFrontmatter, setPlayStatus, type GameLinks } from "./game-note";
import type { IgdbClient } from "./igdb";
import { buildFileName, today } from "./note";
import type { FilmTrackerSettings } from "./settings";
import { noteName, reportFailures, type VaultNotes } from "./vault-notes";

/** What the game commands need from IGDB: tests hand in saved answers instead. */
export type GameSource = Pick<IgdbClient, "getGame" | "downloadCover" | "dlcs">;

/**
 * Everything the plugin does with games. Each command writes the one note it
 * was asked for and nothing else.
 */
export class GameActions {
	private readonly app: App;
	private readonly notes: VaultNotes;
	private readonly settings: () => FilmTrackerSettings;

	constructor(app: App, notes: VaultNotes, settings: () => FilmTrackerSettings) {
		this.app = app;
		this.notes = notes;
		this.settings = settings;
	}

	private links(sourcePath: string): GameLinks {
		const settings = this.settings();
		return {
			companies: settings.linkDevelopers,
			isResolved: this.notes.isResolved(sourcePath),
			platforms: {
				short: settings.shortPlatformNames,
				mine: settings.onlyMyPlatforms ? parsePlatformList(settings.myPlatforms) : null,
				count: settings.platformCount,
			},
		};
	}

	async addGame(client: GameSource, result: GameSearchResult): Promise<void> {
		await reportFailures("add the game", async () => {
			const existing = this.notes.findNote({ kind: "game", igdbId: result.id });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.notes.openNote(existing);
				return;
			}

			const game = await client.getGame(result.id);
			const target = await this.notes.newNotePath(this.settings().gameFolder, [buildFileName(game.title, game.year)]);
			if (target === null) return;
			if ("conflict" in target) {
				await this.notes.openConflict(target.conflict);
				return;
			}
			const notePath = target.path;

			const cover = await this.saveCover(client, game.coverId, noteName(notePath), notePath);
			const coverLink = cover === null ? null : this.notes.imageLink(cover, notePath);
			const note = await this.app.vault.create(notePath, buildGameNoteContent(game, coverLink, this.links(notePath)));
			await this.notes.openNote(note);
			new Notice(cover === null ? `Added ${game.title}. No cover was found.` : `Added ${game.title}`);
		});
	}

	/** "Refresh metadata from IGDB": the same note written from fresh data, nothing of the user's touched. */
	async refresh(client: GameSource, file: TFile): Promise<void> {
		const note = this.notes.kindOf(file);
		if (note?.kind !== "game") return;

		await reportFailures("refresh the game", async () => {
			const game = await client.getGame(note.igdbId);
			const previous = this.notes.frontmatterOf(file) ?? {};
			let coverLink: string | null = null;
			// A cover is only looked for when the note has none, or its file is gone: the one there stays.
			if (isBlank(previous.poster) || this.notes.posterMissing(file)) {
				const cover = await this.saveCover(client, game.coverId, file.basename, file.path);
				coverLink = cover === null ? null : this.notes.imageLink(cover, file.path);
			}
			// Asked again after the download: a cover the user set meanwhile stays.
			const missing = this.notes.posterMissing(file);
			if (
				!(await this.notes.rewriteFrontmatter(file, (content) =>
					refreshGameFrontmatter(content, game, this.links(file.path), coverLink, previous, missing),
				))
			) {
				return;
			}
			new Notice(`Refreshed ${game.title}`);
		});
	}

	/** "Start playing": the game is being played now — again, if it was finished before. */
	async startPlaying(file: TFile): Promise<void> {
		if (!(await this.notes.rewriteFrontmatter(file, (content) => setPlayStatus(content, "playing")))) return;
		new Notice(`Playing ${file.basename}.`);
	}

	/** "Mark as completed today": finished, dated the first time, and counted once more. */
	async markCompletedToday(file: TFile): Promise<void> {
		const { completedCount } = playProgressOf(this.notes.frontmatterOf(file));
		const date = today();
		if (!(await this.notes.rewriteFrontmatter(file, (content) => markGameCompleted(content, date, completedCount)))) return;
		const times = completedCount + 1;
		new Notice(`Completed ${file.basename} today — ${times === 1 ? "the first time" : `${times} times so far`}.`);
	}

	/**
	 * What "Add DLC…" offers: the game's DLCs and expansions on IGDB that its
	 * note doesn't have yet. `null` for a note that isn't a game's.
	 */
	async dlcChoices(client: GameSource, file: TFile): Promise<GameDlc[] | null> {
		const note = this.notes.kindOf(file);
		if (note?.kind !== "game") return null;
		const added = new Set((gameDlcsOf(this.notes.frontmatterOf(file)) ?? []).map((dlc) => dlc.igdbId));
		return (await client.dlcs(note.igdbId)).filter((dlc) => !added.has(dlc.id));
	}

	/** A DLC picked in "Add DLC…" joins the game's note — it is never added on its own. */
	async addDlc(file: TFile, dlc: GameDlc): Promise<void> {
		if (!(await this.rewriteDlcs(file, (content) => addGameDlc(content, dlc)))) return;
		new Notice(`Added ${dlc.title} to ${file.basename}.`);
	}

	/** The DLC panel's checkbox. */
	async setDlcDone(file: TFile, igdbId: number, done: boolean): Promise<void> {
		await this.rewriteDlcs(file, (content) => setGameDlcDone(content, igdbId, done, today()));
	}

	/** Rewrites the note's DLC list, unless it can't be read — then says so and leaves the note alone. */
	private async rewriteDlcs(file: TFile, rewrite: (content: string) => string | null): Promise<boolean> {
		let readable = true;
		await this.app.vault.process(file, (content) => {
			const next = rewrite(content);
			if (next === null) {
				readable = false;
				return content;
			}
			return next;
		});
		if (!readable) new Notice(`Could not read the DLC list of ${file.basename}, so it was left unchanged.`);
		return readable;
	}

	private async saveCover(client: GameSource, coverId: string | null, baseName: string, notePath: string): Promise<TFile | null> {
		if (coverId === null) return null;
		return this.notes.saveImage(() => client.downloadCover(coverId), `${baseName}.jpg`, notePath, this.settings().gameCoverFolder, "the cover");
	}
}

function isBlank(value: unknown): boolean {
	return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}
