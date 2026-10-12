import { Notice, type Plugin, type TFile } from "obsidian";
import type { AlbumSearchResult } from "../music";
import type { MusicActions } from "../music-actions";
import { albumTracksOf } from "../music-note";
import { isFolderNote } from "../note";
import { canListen } from "../note-kind";
import { trackTitleShown } from "../panels/tracklist-panel";
import { songNoteFor, VaultScan } from "../panels/vault-scan";
import { AlbumTracksModal, openAlbumSearch, openArtistAlbums, openArtistSearch, SoundtrackModal, WorkPickerModal } from "../search-modal";
import type { Services } from "../services";
import { soundtrackWorkOf } from "../soundtrack";
import { reportFailures } from "../vault-notes";

/** Albums, artists, songs and soundtracks, from MusicBrainz. */
export class MusicCommands {
	constructor(private readonly services: Services) {}

	register(plugin: Plugin): void {
		const { services } = this;

		plugin.addCommand({
			id: "add-artist",
			name: "Add artist",
			callback: () => this.startAddArtist(),
		});

		plugin.addCommand({
			id: "add-album",
			name: "Add album",
			callback: () => this.startAddAlbum(),
		});

		plugin.addCommand({
			id: "move-album-into-folder",
			name: "Move album into its folder",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || note.kind.kind !== "album" || isFolderNote(note.file.path)) return false;
				if (!checking) void services.music.moveAlbumIntoFolder(note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "add-song",
			name: "Add song from this album",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || note.kind.kind !== "album") return false;
				if (!checking) this.startAddSong(note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "find-soundtrack",
			name: "Find soundtrack",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || soundtrackWorkOf(note.kind) === null) return false;
				if (!checking) void this.startFindSoundtrack(note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "link-soundtrack-to-work",
			name: "Link album to a film, series or game",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || note.kind.kind !== "album") return false;
				if (!checking) void this.startLinkToWork(note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "refresh-music-metadata",
			name: "Refresh music metadata from MusicBrainz",
			checkCallback: (checking) => {
				const note = services.activeNote();
				const music = ["artist", "album", "song"];
				if (note === null || !music.includes(note.kind.kind)) return false;
				if (!checking) void services.music.refresh(services.musicbrainz(), note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "change-artist-photo",
			name: "Change artist photo",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || note.kind.kind !== "artist") return false;
				if (!checking) void services.music.changePhoto(services.musicbrainz(), note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "listened-today",
			name: "Mark as listened today",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !canListen(note.kind)) return false;
				if (!checking) void services.music.markListenedToday(note.file);
				return true;
			},
		});
	}

	startAddArtist(): void {
		const client = this.services.musicbrainz();
		openArtistSearch(this.services.app, client, (result) => void this.services.music.addArtist(client, result));
	}

	/**
	 * "Add album": the search, and from its first row an artist's own list of
	 * albums — found through the artist, whose note is never created for it.
	 */
	startAddAlbum(): void {
		const { app, music } = this.services;
		const client = this.services.musicbrainz();
		const add = (album: AlbumSearchResult) => void music.addAlbum(client, album);
		openAlbumSearch(app, client, add, () => {
			openArtistSearch(app, client, (artist) => void openArtistAlbums(app, client, artist, add));
		});
	}

	/** The MusicBrainz recording a song note is, which its lyrics are kept by. */
	songId(file: TFile): string | null {
		const kind = this.services.notes.kindOf(file);
		return kind?.kind === "song" ? kind.mbRecordingId : null;
	}

	/** "Add song": one of the album's tracks that has no note yet, then that one song's note. */
	startAddSong(file: TFile): void {
		const { app, notes, music, settings } = this.services;
		const songs = new VaultScan(app).songs();
		const tracks = albumTracksOf(notes.frontmatterOf(file)).filter((track) => songNoteFor(songs, file.path, track) === null);
		if (tracks.length === 0) {
			new Notice(`Every song on ${file.basename} already has a note.`);
			return;
		}
		const client = this.services.musicbrainz();
		const title = settings.showLatinTitles ? trackTitleShown : undefined;
		new AlbumTracksModal(app, file.basename, tracks, (track) => void music.addSong(client, file, track, true), title).open();
	}

	/**
	 * "Find soundtrack": the albums Wikidata and MusicBrainz have for a film,
	 * TV series or anime, one to pick — or, from the last row, any album at
	 * all. The pick is linked to the work from the album's side.
	 */
	async startFindSoundtrack(file: TFile): Promise<void> {
		const { app, music } = this.services;
		const client = this.services.musicbrainz();
		new Notice(`Looking for the soundtrack of ${file.basename}…`);
		let choices: Awaited<ReturnType<MusicActions["soundtrackChoicesFor"]>> = null;
		await reportFailures("look for soundtracks", async () => {
			choices = await music.soundtrackChoicesFor(client, this.services.wikidata(), file);
		});
		if (choices === null) return;
		const link = (album: AlbumSearchResult) => void music.linkSoundtrack(client, file, album);
		new SoundtrackModal(
			app,
			file.basename,
			choices,
			(albumId) => music.albumNoteOf(albumId) !== null,
			(choice) => link(choice.album),
			() =>
				openAlbumSearch(app, client, link, () => {
					openArtistSearch(app, client, (artist) => void openArtistAlbums(app, client, artist, link));
				}),
		).open();
	}

	/** "Link to a film, series or game": one of the vault's films, TV series, anime and games, for this album to be the soundtrack of. */
	async startLinkToWork(file: TFile): Promise<void> {
		const { app, music } = this.services;
		const works = await music.worksToLink(this.services.wikidata(), file);
		if (works.length === 0) {
			new Notice(`There is no film, TV series, anime or game in your vault that ${file.basename} isn't linked to already.`);
			return;
		}
		new WorkPickerModal(app, file.basename, works, (work) => void music.linkAlbumToWork(file, work.file)).open();
	}

	/** DISCOGRAPHY's "Add album…": the albums of the artist whose note it is. */
	startAddAlbumOf(file: TFile): void {
		const { app, notes, music } = this.services;
		const id = music.artistIdOf(file);
		if (id === null) return;
		const client = this.services.musicbrainz();
		const name: unknown = notes.frontmatterOf(file)?.name;
		const artist = { id, name: typeof name === "string" && name.trim() !== "" ? name.trim() : file.basename };
		void openArtistAlbums(app, client, artist, (album) => void music.addAlbum(client, album));
	}
}
