import { Notice, type App, type TFile } from "obsidian";
import { findSong, songNoteName, type AlbumSearchResult, type AlbumSong, type ArtistSearchResult } from "./music";
import type { ConfirmAnswer, ConfirmRequest } from "./confirm-modal";
import type { MusicBrainzClient, PhotoCandidate, Picture } from "./musicbrainz";
import type { PhotoChoice } from "./photo-picker-modal";
import {
	buildAlbumNoteContent,
	buildArtistNoteContent,
	buildSongNoteContent,
	listenProgressOf,
	markAlbumListened,
	refreshAlbumFrontmatter,
	refreshArtistFrontmatter,
	refreshSongFrontmatter,
	setArtistPhoto,
	tracksReadable,
	type MusicLinks,
} from "./music-note";
import { buildFileName, folderNotePath, isFolderNote, joinPath, parseLinkTarget, sanitizeFileName, today } from "./note";
import { appendLyrics, hasLyricsSection } from "./lyrics";
import type { FilmTrackerSettings } from "./settings";
import { noteName, reportFailures, type VaultNotes } from "./vault-notes";

/** What the music commands need from MusicBrainz: tests hand in saved answers instead. */
export type MusicSource = Pick<
	MusicBrainzClient,
	"getArtist" | "getAlbum" | "albumSongs" | "getSong" | "albumCover" | "artistPhoto" | "photoCandidates" | "download" | "downloadUrl"
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

/** A track line of an album note, as far as finding its song goes. */
export interface TrackRef {
	disc: number | null;
	n: number;
	title: string;
}

/**
 * Everything the plugin does with music. Each command writes the one note it
 * was asked for and nothing else: an album never creates its artist's note
 * or its songs', and an artist never creates their albums'.
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
			const name = buildFileName(album.title, album.year);
			const target = this.settings().albumFolderNotes
				? await this.notes.newFolderNotePath(this.settings().albumFolder, name)
				: await this.notes.newNotePath(this.settings().albumFolder, [name]);
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

	/**
	 * "Add song": the note of one track of an album note, written from
	 * MusicBrainz — never the album's other songs, nor its artists' notes.
	 * The cover is the album's own file, linked rather than downloaded again.
	 * `open` says whether the new note is opened: from the command it is, from
	 * TRACKLIST's "+" the album stays on screen and the row becomes a link.
	 */
	async addSong(client: MusicSource, albumFile: TFile, track: TrackRef, open: boolean): Promise<void> {
		const album = this.notes.kindOf(albumFile);
		if (album?.kind !== "album") return;

		await reportFailures("add the song", async () => {
			new Notice(`Adding ${track.title}…`);
			const song = findSong(await client.albumSongs(album.mbAlbumId), track);
			if (song === null) {
				new Notice(`${track.title} is no longer on this album on MusicBrainz. Refresh the album, then try again.`);
				return;
			}
			const existing = this.notes.findNote({ kind: "song", mbRecordingId: song.mbRecordingId });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				if (open) await this.notes.openNote(existing);
				return;
			}

			const place = this.songPlace(albumFile, song);
			const target = await this.notes.newNotePath(place.folder, place.names);
			if (target === null) return;
			if ("conflict" in target) {
				await this.notes.openConflict(target.conflict);
				return;
			}
			const notePath = target.path;

			const year: unknown = this.notes.frontmatterOf(albumFile)?.year;
			const cover = this.notes.posterOf(albumFile);
			// A song named by its title alone is also found by "Title (Artist)".
			const fullName = songNoteName(song.title, song.artists);
			const content = buildSongNoteContent(
				song,
				{ link: this.notes.noteLink(albumFile, notePath), year: typeof year === "number" ? year : null },
				cover === null ? null : this.notes.imageLink(cover, notePath),
				this.links(notePath),
				noteName(notePath) === sanitizeFileName(fullName) ? null : fullName,
			);
			const note = await this.app.vault.create(notePath, content);
			if (open) await this.notes.openNote(note);
			new Notice(`Added ${song.title}`);
		});
	}

	/**
	 * Where a song's note goes, and the names to try. With album folder notes
	 * it goes in its album's folder — beside an album note that is still a
	 * single file, a folder of the album's name — named by its title alone,
	 * unless another note in the vault already goes by that title: then
	 * "Title (Artist)", so that a bare link never has two notes to choose
	 * from. Otherwise it goes in the song folder as "Title (Artist)".
	 */
	private songPlace(albumFile: TFile, song: AlbumSong): { folder: string; names: string[] } {
		const full = sanitizeFileName(songNoteName(song.title, song.artists));
		if (!this.settings().albumFolderNotes) return { folder: this.settings().songFolder, names: [full] };

		const parent = folderOf(albumFile.path);
		const folder = isFolderNote(albumFile.path) ? parent : joinPath(parent, albumFile.basename);
		const bare = sanitizeFileName(song.title);
		return { folder, names: this.notes.noteNameTaken(bare) ? [full] : [bare, full] };
	}

	/**
	 * "Move album into its folder": an album note from before folder notes —
	 * a single file — goes into a folder of its own name, beside the songs
	 * already added from it. Every link to it follows. Only ever on request.
	 */
	async moveAlbumIntoFolder(file: TFile): Promise<void> {
		if (this.notes.kindOf(file)?.kind !== "album" || isFolderNote(file.path)) return;
		const path = folderNotePath(folderOf(file.path), file.basename);
		if (await this.notes.moveNote(file, path)) new Notice(`Moved ${file.basename} into its own folder.`);
	}

	/** "Refresh metadata from MusicBrainz": the same note written from fresh data, nothing of the user's touched. */
	async refresh(client: MusicSource, file: TFile): Promise<void> {
		const note = this.notes.kindOf(file);
		if (note?.kind === "artist") await this.refreshArtist(client, file, note.mbArtistId);
		else if (note?.kind === "album") await this.refreshAlbum(client, file, note.mbAlbumId);
		else if (note?.kind === "song") await this.refreshSong(client, file, note.mbRecordingId);
	}

	/**
	 * A song's artists and length from MusicBrainz. A cover is only filled in
	 * when the note has none, or its file is gone, and then from the album the
	 * note links — never downloaded.
	 */
	private async refreshSong(client: MusicSource, file: TFile, id: string): Promise<void> {
		await reportFailures("refresh the song", async () => {
			const song = await client.getSong(id);
			const previous = this.notes.frontmatterOf(file) ?? {};
			let coverLink: string | null = null;
			if (isBlank(previous.poster) || this.notes.posterMissing(file)) {
				const albumPath = parseLinkTarget(previous.album);
				const album = albumPath === null ? null : this.app.metadataCache.getFirstLinkpathDest(albumPath, file.path);
				const cover = album === null ? null : this.notes.posterOf(album);
				coverLink = cover === null ? null : this.notes.imageLink(cover, file.path);
			}
			const missing = this.notes.posterMissing(file);
			if (
				!(await this.notes.rewriteFrontmatter(file, (content) =>
					refreshSongFrontmatter(content, song, this.links(file.path), coverLink, previous, missing),
				))
			) {
				return;
			}
			new Notice(`Refreshed ${file.basename}`);
		});
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

	/**
	 * "Copy lyrics into note": the lyrics go at the end of the note, under
	 * "## Lyrics", and are the note's own from then on — to edit, and to
	 * keep on every device. A note that already has such a section is left
	 * as it is.
	 */
	async copyLyrics(file: TFile, text: string): Promise<void> {
		let copied = false;
		await this.app.vault.process(file, (content) => {
			if (hasLyricsSection(content)) return content;
			copied = true;
			return appendLyrics(content, text);
		});
		new Notice(copied ? `Copied the lyrics into ${file.basename}.` : `${file.basename} already has its own lyrics.`);
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

/** The folder a file is in: "" at the vault root. */
function folderOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

function isBlank(value: unknown): boolean {
	return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}
