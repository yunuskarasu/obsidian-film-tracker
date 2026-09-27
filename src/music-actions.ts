import { Notice, type App, type TFile } from "obsidian";
import type { AlbumSearchResult, ArtistSearchResult } from "./music";
import type { ConfirmAnswer, ConfirmRequest } from "./confirm-modal";
import type { MusicBrainzClient, PhotoCandidate, Picture } from "./musicbrainz";
import type { PhotoChoice } from "./photo-picker-modal";
import {
	buildAlbumNoteContent,
	buildArtistNoteContent,
	listenProgressOf,
	markAlbumListened,
	refreshAlbumFrontmatter,
	refreshArtistFrontmatter,
	setArtistPhoto,
	tracksReadable,
	type MusicLinks,
} from "./music-note";
import { buildFileName, sanitizeFileName, today } from "./note";
import type { FilmTrackerSettings } from "./settings";
import { noteName, reportFailures, type VaultNotes } from "./vault-notes";

/** What the music commands need from MusicBrainz: tests hand in saved answers instead. */
export type MusicSource = Pick<
	MusicBrainzClient,
	"getArtist" | "getAlbum" | "albumCover" | "artistPhoto" | "photoCandidates" | "download" | "downloadUrl"
>;

/** What a music command needs to ask the user. */
export interface MusicUi {
	/** "Choose a photo of …" — see `PhotoPickerModal`; `null` when closed without a pick. */
	pickPhoto(artistName: string, candidates: PhotoCandidate[]): Promise<PhotoChoice | null>;
	/** A picture already in the vault — see `VaultImageModal`; `null` when closed without one. */
	pickVaultImage(): Promise<TFile | null>;
	/** The address of a picture on the web — see `ImageUrlModal`; `null` when cancelled. */
	askImageUrl(): Promise<string | null>;
	/** Asks before something is deleted — see `ConfirmModal`. */
	confirm(request: ConfirmRequest): Promise<ConfirmAnswer>;
}

/**
 * Everything the plugin does with music. Each command writes the one note it
 * was asked for and nothing else: an album never creates its artist's note,
 * and an artist never creates their albums'.
 */
export class MusicActions {
	private readonly app: App;
	private readonly notes: VaultNotes;
	private readonly settings: () => FilmTrackerSettings;
	private readonly ui: MusicUi;

	constructor(app: App, notes: VaultNotes, settings: () => FilmTrackerSettings, ui: MusicUi) {
		this.app = app;
		this.notes = notes;
		this.settings = settings;
		this.ui = ui;
	}

	private links(sourcePath: string): MusicLinks {
		const settings = this.settings();
		return {
			artists: settings.linkArtists,
			genres: settings.linkMusicGenres,
			isResolved: this.notes.isResolved(sourcePath),
		};
	}

	/** The MusicBrainz id of an artist note — what DISCOGRAPHY's "Add album…" lists the albums of. */
	artistIdOf(file: TFile): string | null {
		const note = this.notes.kindOf(file);
		return note?.kind === "artist" ? note.mbArtistId : null;
	}

	async addArtist(client: MusicSource, result: ArtistSearchResult): Promise<void> {
		await reportFailures("add the artist", async () => {
			const existing = this.notes.findNote({ kind: "artist", mbArtistId: result.id });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.notes.openNote(existing);
				return;
			}

			const artist = await client.getArtist(result.id);
			const target = await this.notes.newNotePath(this.settings().artistFolder, [sanitizeFileName(artist.name)]);
			if (target === null) return;
			if ("conflict" in target) {
				await this.notes.openConflict(target.conflict);
				return;
			}
			const notePath = target.path;

			const picture = await client.artistPhoto(artist);
			const photo = await this.saveImage(picture, noteName(notePath), notePath, this.settings().artistPhotoFolder, "the photo");
			const photoLink = photo === null ? null : this.notes.imageLink(photo, notePath);

			const note = await this.app.vault.create(notePath, buildArtistNoteContent(artist, photoLink, picture?.credit ?? null));
			await this.notes.openNote(note);
			new Notice(photo === null ? `Added ${artist.name}. No photo was found.` : `Added ${artist.name}`);
		});
	}

	async addAlbum(client: MusicSource, result: AlbumSearchResult): Promise<void> {
		await reportFailures("add the album", async () => {
			const existing = this.notes.findNote({ kind: "album", mbAlbumId: result.id });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.notes.openNote(existing);
				return;
			}

			// Several requests at MusicBrainz's pace of one a second: say so.
			new Notice(`Adding ${result.title}…`);
			const album = await client.getAlbum(result.id);
			const target = await this.notes.newNotePath(this.settings().albumFolder, [buildFileName(album.title, album.year)]);
			if (target === null) return;
			if ("conflict" in target) {
				await this.notes.openConflict(target.conflict);
				return;
			}
			const notePath = target.path;

			const cover = await this.saveImage(
				await client.albumCover(album),
				noteName(notePath),
				notePath,
				this.settings().albumCoverFolder,
				"the cover",
			);
			const coverLink = cover === null ? null : this.notes.imageLink(cover, notePath);

			const note = await this.app.vault.create(notePath, buildAlbumNoteContent(album, coverLink, this.links(notePath)));
			await this.notes.openNote(note);
			new Notice(cover === null ? `Added ${album.title}. No cover was found.` : `Added ${album.title}`);
		});
	}

	/** "Refresh metadata from MusicBrainz": the same note written from fresh data, nothing of the user's touched. */
	async refresh(client: MusicSource, file: TFile): Promise<void> {
		const note = this.notes.kindOf(file);
		if (note?.kind === "artist") await this.refreshArtist(client, file, note.mbArtistId);
		else if (note?.kind === "album") await this.refreshAlbum(client, file, note.mbAlbumId);
	}

	private async refreshArtist(client: MusicSource, file: TFile, id: string): Promise<void> {
		await reportFailures("refresh the artist", async () => {
			const artist = await client.getArtist(id);
			const previous = this.notes.frontmatterOf(file) ?? {};
			// A photo is only looked for when the note has none, or its file is gone: the one there stays.
			const needsPhoto = isBlank(previous.poster) || this.notes.posterMissing(file);
			const photo = needsPhoto ? await this.newPhoto(client, artist, file) : null;
			// Asked again after the download: a photo the user set meanwhile stays.
			const missing = this.notes.posterMissing(file);
			if (
				!(await this.notes.rewriteFrontmatter(file, (content) =>
					refreshArtistFrontmatter(content, artist, photo, previous, missing),
				))
			) {
				return;
			}
			new Notice(`Refreshed ${artist.name}`);
		});
	}

	private async newPhoto(
		client: MusicSource,
		artist: Awaited<ReturnType<MusicSource["getArtist"]>>,
		file: TFile,
	): Promise<{ link: string; credit: string | null } | null> {
		const picture = await client.artistPhoto(artist);
		const image = await this.saveImage(picture, file.basename, file.path, this.settings().artistPhotoFolder, "the photo");
		return image === null ? null : { link: this.notes.imageLink(image, file.path), credit: picture?.credit ?? null };
	}

	private async refreshAlbum(client: MusicSource, file: TFile, id: string): Promise<void> {
		await reportFailures("refresh the album", async () => {
			const album = await client.getAlbum(id);
			const previous = this.notes.frontmatterOf(file) ?? {};
			let coverLink: string | null = null;
			// A cover is only looked for when the note has none, or its file is gone: the one there stays.
			if (isBlank(previous.poster) || this.notes.posterMissing(file)) {
				const cover = await this.saveImage(
					await client.albumCover(album),
					file.basename,
					file.path,
					this.settings().albumCoverFolder,
					"the cover",
				);
				coverLink = cover === null ? null : this.notes.imageLink(cover, file.path);
			}

			// Asked again after the download: a cover the user set meanwhile stays.
			const missing = this.notes.posterMissing(file);
			let tracksOk = true;
			const readable = await this.notes.rewriteFrontmatter(file, (content) => {
				tracksOk = tracksReadable(content);
				return refreshAlbumFrontmatter(content, album, this.links(file.path), coverLink, previous, missing);
			});
			if (!readable) return;
			new Notice(
				tracksOk ? `Refreshed ${album.title}` : `Could not read the tracks of ${file.basename}, so it was left unchanged.`,
			);
		});
	}

	/**
	 * "Change photo" on an artist note: every photo on offer, side by side —
	 * Deezer's and Wikimedia Commons' — or a picture from the vault or from a
	 * web address. The one picked becomes the note's, saved beside the old one
	 * and never over it; a picture from the vault is linked as it is, not
	 * copied. The old one is only deleted when the user says so, and only
	 * offered when nothing else uses it.
	 */
	async changePhoto(client: MusicSource, file: TFile): Promise<void> {
		const note = this.notes.kindOf(file);
		if (note?.kind !== "artist") return;

		await reportFailures("change the photo", async () => {
			const artist = await client.getArtist(note.mbArtistId);
			new Notice(`Looking for photos of ${artist.name}…`);
			const choice = await this.ui.pickPhoto(artist.name, await client.photoCandidates(artist));
			if (choice === null) return;

			const oldPhoto = this.notes.unusedTopLevelPoster(file);
			const picked = await this.pickedPhoto(client, choice, file);
			if (picked === null) return;
			const link = this.notes.imageLink(picked.image, file.path);
			if (!(await this.notes.rewriteFrontmatter(file, (content) => setArtistPhoto(content, link, picked.credit)))) return;
			new Notice(`Changed the photo of ${artist.name}`);

			if (oldPhoto === null || oldPhoto.path === picked.image.path) return;
			const answer = await this.ui.confirm({
				title: "Delete the old photo?",
				message: `No note uses ${oldPhoto.name} now that ${file.basename} has another. It's deleted the way Obsidian's "Deleted files" setting says.`,
				confirmLabel: "Delete",
				cancelLabel: "Keep",
			});
			if (answer !== null) await this.notes.deleteFile(oldPhoto);
		});
	}

	/**
	 * The picture a "Change photo" choice comes to, in the vault: downloaded
	 * and saved, or — from the vault — the file itself. `null` once the user
	 * has been told why there is none, or has changed their mind.
	 */
	private async pickedPhoto(
		client: MusicSource,
		choice: PhotoChoice,
		file: TFile,
	): Promise<{ image: TFile; credit: string | null } | null> {
		if (choice.kind === "vault") {
			const image = await this.ui.pickVaultImage();
			return image === null ? null : { image, credit: null };
		}

		let picture: Picture | null;
		if (choice.kind === "url") {
			const url = await this.ui.askImageUrl();
			if (url === null) return null;
			picture = await client.downloadUrl(url);
			if (picture === null) {
				new Notice("That address didn't lead to a picture. Copy the address of the image itself.");
				return null;
			}
		} else {
			picture = await client.download(choice.candidate);
		}

		const image = await this.saveImage(picture, file.basename, file.path, this.settings().artistPhotoFolder, "the photo");
		if (image === null) {
			new Notice("The photo could not be downloaded.");
			return null;
		}
		return { image, credit: picture?.credit ?? null };
	}

	/** "Mark as listened today": ticked, dated the first time, and counted once more. */
	async markListenedToday(file: TFile): Promise<void> {
		const { count } = listenProgressOf(this.notes.frontmatterOf(file));
		const date = today();
		if (!(await this.notes.rewriteFrontmatter(file, (content) => markAlbumListened(content, date, count)))) return;
		const times = count + 1;
		new Notice(`Listened to ${file.basename} today — ${times === 1 ? "the first time" : `${times} times so far`}.`);
	}

	private async saveImage(
		picture: Picture | null,
		baseName: string,
		notePath: string,
		folder: string,
		what: string,
	): Promise<TFile | null> {
		if (picture === null) return null;
		const name = `${baseName}.${picture.extension ?? "jpg"}`;
		return this.notes.saveImage(async () => picture.data, name, notePath, folder, what);
	}
}

function isBlank(value: unknown): boolean {
	return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}
