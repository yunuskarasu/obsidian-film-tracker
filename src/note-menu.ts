import type { Menu, TFile } from "obsidian";
import type { GameCommands } from "./commands/games";
import type { MusicCommands } from "./commands/music";
import { isFolderNote } from "./note";
import { canListen, canWatch, hasAnime, hasEpisodes, hasManga, isBook, isGame } from "./note-kind";
import type { Services } from "./services";
import { soundtrackWorkOf } from "./soundtrack";

/** The commands a note's menu opens dialogs of. */
export interface NoteMenuCommands {
	music: MusicCommands;
	games: GameCommands;
}

/**
 * The same commands on a note's own menus — right-click in the editor, the
 * tab's ⋮ menu, or the file explorer — so watching an episode doesn't have to
 * go through the command palette. Only what the note actually has is offered.
 */
export function addNoteMenuItems(menu: Menu, file: TFile | null, services: Services, commands: NoteMenuCommands): void {
	const kind = file === null ? null : services.notes.kindOf(file);
	if (file === null || kind === null) return;
	const { music, games } = commands;

	const entries: { title: string; icon: string; run: () => void }[] = [];
	if (canListen(kind)) {
		entries.push({
			title: "Mark as listened today",
			icon: "headphones",
			run: () => void services.music.markListenedToday(file),
		});
	}
	if (kind.kind === "album") {
		entries.push({ title: "Add song", icon: "music", run: () => music.startAddSong(file) });
		entries.push({ title: "Link to a film, series or game", icon: "clapperboard", run: () => void music.startLinkToWork(file) });
		if (!isFolderNote(file.path)) {
			entries.push({ title: "Move album into its folder", icon: "folder-input", run: () => void services.music.moveAlbumIntoFolder(file) });
		}
	}
	if (kind.kind === "artist") {
		entries.push({
			title: "Change photo",
			icon: "image",
			run: () => void services.music.changePhoto(services.musicbrainz(), file),
		});
	}
	if (isGame(kind)) {
		entries.push({ title: "Start playing", icon: "play", run: () => void services.games.startPlaying(file) });
		entries.push({ title: "Mark as completed today", icon: "check", run: () => void services.games.markCompletedToday(file) });
		entries.push({ title: "Add DLC", icon: "package-plus", run: () => void games.startAddDlc(file) });
	}
	if (isBook(kind)) {
		entries.push({ title: "Start reading", icon: "book-open", run: () => void services.books.startReading(file) });
		entries.push({ title: "Mark book as finished today", icon: "check", run: () => void services.books.markFinishedToday(file) });
		entries.push({ title: "Choose edition", icon: "library", run: () => void services.books.chooseEdition(services.openLibrary(), file) });
	}
	if (canWatch(kind)) {
		entries.push({ title: "Mark as watched today", icon: "check", run: () => void services.watchedToday(file) });
	}
	if (soundtrackWorkOf(kind) !== null) {
		entries.push({ title: "Find soundtrack", icon: "disc", run: () => void music.startFindSoundtrack(file) });
	}
	if (hasEpisodes(kind)) {
		entries.push({
			title: "Watch one more episode",
			icon: "play",
			run: () => void services.watchOneMoreEpisode(file),
		});
	}
	if (hasAnime(kind)) {
		entries.push({
			title: "Remove anime",
			icon: "trash-2",
			run: () => void services.anime.removeAnime(file),
		});
	}
	if (hasManga(kind)) {
		entries.push({
			title: "Mark manga as read today",
			icon: "check",
			run: () => void services.anime.markReadToday(file),
		});
		entries.push({
			title: "Read one more chapter",
			icon: "book-open",
			run: () => void services.anime.readOneMoreChapter(file),
		});
	}

	for (const entry of entries) {
		menu.addItem((item) => item.setTitle(entry.title).setIcon(entry.icon).onClick(entry.run));
	}
}
