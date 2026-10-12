import { Menu, type Plugin } from "obsidian";
import type { AnimeCommands } from "./commands/anime";
import type { BookCommands } from "./commands/books";
import type { DiaryCommands } from "./commands/diary";
import type { FilmCommands } from "./commands/films";
import type { LibraryCommands } from "./commands/library";
import type { GameCommands } from "./commands/games";
import type { MusicCommands } from "./commands/music";
import type { Services } from "./services";

/** What the ribbon icon's menu opens: the diary and the library, and an "Add …" for each kind of note. */
export interface RibbonCommands {
	diary: DiaryCommands;
	library: LibraryCommands;
	films: FilmCommands;
	anime: AnimeCommands;
	music: MusicCommands;
	games: GameCommands;
	books: BookCommands;
}

/** The plugin's one ribbon icon, and the menu it opens. */
export function addRibbonMenu(plugin: Plugin, services: Services, commands: RibbonCommands): void {
	const { diary, library, films, anime, music, games, books } = commands;
	plugin.addRibbonIcon("film", "Add film, TV series, anime, manga, music, game or book", (evt) => {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Open diary")
				.setIcon("book-open-text")
				.onClick(() => void diary.openDiary()),
		);
		menu.addItem((item) =>
			item
				.setTitle("Open the library")
				.setIcon("library")
				.onClick(() => void library.openLibrary()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Add film")
				.setIcon("film")
				.onClick(() => films.startAddFilm()),
		);
		menu.addItem((item) =>
			item
				.setTitle("Add TV series")
				.setIcon("monitor")
				.onClick(() => films.startAddTv()),
		);
		menu.addItem((item) =>
			item
				.setTitle("Add director")
				.setIcon("user")
				.onClick(() => films.startAddDirector()),
		);
		menu.addItem((item) =>
			item
				.setTitle("Add anime")
				.setIcon("tv")
				.onClick(() => anime.startAddAnime()),
		);
		menu.addItem((item) =>
			item
				.setTitle("Add manga")
				.setIcon("book")
				.onClick(() => anime.startAddManga()),
		);

		const activeFile = services.app.workspace.getActiveFile();
		const mangaMalId = activeFile === null ? null : services.notes.mangaIdOf(activeFile);
		menu.addItem((item) => {
			item.setTitle("Add mangaka").setIcon("user").setDisabled(mangaMalId === null);
			if (activeFile !== null && mangaMalId !== null) {
				item.onClick(() => anime.startAddMangaka(activeFile, mangaMalId));
			}
		});
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Add album")
				.setIcon("disc")
				.onClick(() => music.startAddAlbum()),
		);
		menu.addItem((item) =>
			item
				.setTitle("Add artist")
				.setIcon("mic")
				.onClick(() => music.startAddArtist()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Add game")
				.setIcon("gamepad-2")
				.onClick(() => games.startAddGame()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Add book")
				.setIcon("book-open")
				.onClick(() => books.startAddBook()),
		);
		menu.addItem((item) =>
			item
				.setTitle("Add author")
				.setIcon("pen-tool")
				.onClick(() => books.startAddAuthor()),
		);

		menu.showAtMouseEvent(evt);
	});
}
