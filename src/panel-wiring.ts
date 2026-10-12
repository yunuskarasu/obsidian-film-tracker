import { debounce, TFile, type Plugin } from "obsidian";
import type { AnimeCommands } from "./commands/anime";
import type { BookCommands } from "./commands/books";
import type { GameCommands } from "./commands/games";
import type { MusicCommands } from "./commands/music";
import { FilmNoteLayout } from "./film-note-layout";
import { lyricsQueryOf } from "./lyrics-service";
import { addNoteMenuItems } from "./note-menu";
import type { Services } from "./services";

/** The commands the buttons on the panels and under the posters open dialogs of. */
export interface PanelCommands {
	anime: AnimeCommands;
	music: MusicCommands;
	games: GameCommands;
	books: BookCommands;
}

/**
 * The poster beside a note's properties and the panels under them, with
 * what each of their buttons does, and the note menus; then the events that
 * draw them again when a note opens, a tab changes or a note's properties do.
 */
export function setUpLayout(plugin: Plugin, services: Services, commands: PanelCommands): FilmNoteLayout {
	const { app, anime, tv, music, games, books, lyrics } = services;
	const { anime: animeCommands, music: musicCommands, games: gameCommands, books: bookCommands } = commands;
	const layout = new FilmNoteLayout(app, () => services.settings, {
		change: (file) => animeCommands.startChangeManga(file),
		remove: (file) => void anime.removeManga(file),
		addAdaptation: (file) => animeCommands.startAddAdaptation(file),
		setRead: (file, read) => void anime.syncMangaRead(file, read),
		readChapter: (file) => void anime.readOneMoreChapter(file),
		watchEpisode: (file) => void services.watchOneMoreEpisode(file),
		watchSeason: (file, season) => void tv.watchOneMoreOfSeason(file, season),
		setSeasonWatched: (file, season, watched) => void tv.setSeasonWatched(file, season, watched),
		watchedToday: (file) => void services.watchedToday(file),
		addAlbumByArtist: (file) => musicCommands.startAddAlbumOf(file),
		addSong: (file, track) => void music.addSong(services.musicbrainz(), file, track, false),
		lyricsState: (file) => {
			const song = musicCommands.songId(file);
			return song === null ? null : lyrics.state(song, () => lyricsQueryOf(app, file));
		},
		copyLyrics: (file) => {
			const song = musicCommands.songId(file);
			const state = song === null ? null : lyrics.state(song, () => lyricsQueryOf(app, file));
			if (state?.status === "text") void music.copyLyrics(file, state.text);
		},
		fetchLyricsAgain: (file) => {
			const song = musicCommands.songId(file);
			if (song !== null) void lyrics.fetchAgain(song, () => lyricsQueryOf(app, file));
		},
		markLyricsWrong: (file) => {
			const song = musicCommands.songId(file);
			if (song !== null) void lyrics.markWrong(song);
		},
		changePhoto: (file) => void music.changePhoto(services.musicbrainz(), file),
		findSoundtrack: (file) => void musicCommands.startFindSoundtrack(file),
		startPlaying: (file) => void games.startPlaying(file),
		addDlc: (file) => void gameCommands.startAddDlc(file),
		setDlcDone: (file, igdbId, done) => void games.setDlcDone(file, igdbId, done),
		startReading: (file) => void books.startReading(file),
		chooseEdition: (file) => void books.chooseEdition(services.openLibrary(), file),
		addBookByAuthor: (file) => bookCommands.startAddBookOf(file),
	});
	const refresh = () => layout.refresh();

	plugin.registerEvent(
		app.workspace.on("file-menu", (menu, file) => {
			addNoteMenuItems(menu, file instanceof TFile ? file : null, services, commands);
		}),
	);
	plugin.registerEvent(
		app.workspace.on("editor-menu", (menu, _editor, info) => {
			addNoteMenuItems(menu, info.file ?? null, services, commands);
		}),
	);

	/**
	 * Opening a note, switching tabs or switching modes: redraw at once,
	 * so the poster never appears a beat after the note itself — and then
	 * twice more, shortly after. Switching to reading view (Ctrl+E) builds
	 * a container of its own, and the event arrives before it exists: the
	 * first redraw finds nothing to draw into, and without these the
	 * poster and the panels stayed away until something else — a metadata
	 * change — happened to redraw them.
	 */
	const refreshQuick = debounce(refresh, 50, false);
	const refreshLater = debounce(refresh, 400, false);
	plugin.register(() => {
		refreshQuick.cancel();
		refreshLater.cancel();
	});
	const redraw = () => {
		refresh();
		refreshQuick();
		refreshLater();
	};
	/**
	 * Reading view discards parts of a long note as it scrolls away, and
	 * takes the poster and the panels with it (see `redrawIfMissing`).
	 * The check runs at most once per frame rather than on a timer: a
	 * delayed one drew them back visibly late, a blink on the way up.
	 * Finding everything in place costs two DOM queries, so the frames
	 * where nothing was lost — almost all of them — do no work.
	 */
	let queuedFrame: number | null = null;
	const checkAfterScroll = () => {
		if (queuedFrame !== null) return;
		queuedFrame = window.requestAnimationFrame(() => {
			queuedFrame = null;
			layout.redrawIfMissing();
		});
	};
	plugin.register(() => {
		if (queuedFrame !== null) window.cancelAnimationFrame(queuedFrame);
	});
	plugin.registerDomEvent(document, "scroll", checkAfterScroll, true);

	plugin.registerEvent(app.workspace.on("layout-change", redraw));
	plugin.registerEvent(app.workspace.on("active-leaf-change", redraw));
	plugin.registerEvent(app.workspace.on("file-open", redraw));

	/**
	 * Metadata changes arrive in bursts — every save of any note fires
	 * `changed`, and `resolved` follows it each time — so those wait for a
	 * quiet moment and redraw once. Connections compare the open note
	 * against every other film in the vault, which is why they listen at
	 * all: on a cold start the cache fills in after the workspace is
	 * restored, and the delayed retries below catch that up too.
	 */
	const refreshSoon = debounce(refresh, 250, true);
	plugin.register(() => refreshSoon.cancel());
	plugin.registerEvent(app.metadataCache.on("changed", () => refreshSoon()));
	plugin.registerEvent(app.metadataCache.on("resolved", () => refreshSoon()));
	app.workspace.onLayoutReady(() => {
		refresh();
		for (const delayMs of [1000, 3000, 6000, 12000]) {
			const timer = window.setTimeout(refresh, delayMs);
			plugin.register(() => window.clearTimeout(timer));
		}
	});
	return layout;
}
