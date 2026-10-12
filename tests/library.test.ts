import { describe, expect, it } from "vitest";
import { DiaryView } from "../src/diary-view";
import { byAdded, libraryItemsOf, matchesSearch, progressLabel, searchKey, sortItems, statusLabel, type LibraryItem } from "../src/library";
import { LibraryView } from "../src/library-view";

const items = (kind: Parameters<typeof libraryItemsOf>[2], frontmatter: Record<string, unknown>, added = 0) =>
	libraryItemsOf("Works/Note.md", "Note", kind, frontmatter, added);

describe("what a note puts on the library's shelf", () => {
	it("puts a film there, watched or still to watch", () => {
		const [film] = items({ kind: "film", tmdbId: 1 }, { title: "Arrival", year: 2016, poster: "[[arrival.jpg]]", watched: false, watch_date: null });
		expect(film).toEqual({
			path: "Works/Note.md",
			kind: "film",
			title: "Arrival",
			names: ["Arrival"],
			poster: "[[arrival.jpg]]",
			status: "planned",
			progress: null,
			year: 2016,
			finished: null,
			added: 0,
		});
		const [seen] = items({ kind: "film", tmdbId: 1 }, { title: "Arrival", watched: true, watch_date: "2026-03-14" });
		expect(seen.status).toBe("finished");
		expect(seen.finished).toBe("2026-03-14");
	});

	it("counts a series begun by its episodes, across its seasons", () => {
		const seasons = [
			{ season: 1, episodes: 10, watched: 10 },
			{ season: 2, episodes: 8, watched: 3 },
		];
		const [show] = items({ kind: "tv", tmdbTvId: 7, mangaMalId: null }, { title: "Severance", seasons, watched: false });
		expect(show.status).toBe("progress");
		expect(show.progress).toEqual({ done: 13, total: 18, unit: "ep" });

		const [fresh] = items({ kind: "tv", tmdbTvId: 7, mangaMalId: null }, { title: "Severance", seasons: [{ season: 1, episodes: 10, watched: 0 }] });
		expect(fresh.status).toBe("planned");
		expect(fresh.progress).toBeNull();

		const [done] = items({ kind: "tv", tmdbTvId: 7, mangaMalId: null }, { title: "Severance", seasons, watched: true });
		expect(done.status).toBe("finished");
		expect(done.progress).toBeNull();
	});

	it("puts an anime and its manga there as two, each with its own cover, year and place", () => {
		const frontmatter = {
			title: "Mushishi",
			year: 2005,
			poster: "[[anime.jpg]]",
			episodes: 26,
			episodes_watched: 4,
			watched: false,
			manga: { title: "Mushishi (manga)", year: 1999, poster: "[[manga.jpg]]", chapters: null, chapters_read: 0, read: true, read_date: "2025-11-02" },
		};
		const [anime, manga] = items({ kind: "series", animeMalId: 1, mangaMalId: 2 }, frontmatter);
		expect(anime).toMatchObject({ kind: "anime", title: "Mushishi", year: 2005, poster: "[[anime.jpg]]", status: "progress", progress: { done: 4, total: 26, unit: "ep" } });
		expect(manga).toMatchObject({ kind: "manga", title: "Mushishi (manga)", year: 1999, poster: "[[manga.jpg]]", status: "finished", finished: "2025-11-02", progress: null });
	});

	it("gives a manga begun with no known end its chapters alone", () => {
		const [manga] = items({ kind: "series", animeMalId: null, mangaMalId: 2 }, { title: "One Piece", manga: { chapters: null, chapters_read: 1100 } });
		expect(manga.status).toBe("progress");
		expect(manga.progress).toEqual({ done: 1100, total: null, unit: "ch" });
		expect(progressLabel(manga.progress!)).toBe("1100 ch");
	});

	it("puts a series' manga there beside it, from a TV note too", () => {
		const shelf = items({ kind: "tv", tmdbTvId: 7, mangaMalId: 3 }, { title: "Frieren", manga: { title: "Sousou no Frieren", chapters_read: 0 } });
		expect(shelf.map((item) => [item.kind, item.title])).toEqual([
			["tv", "Frieren"],
			["manga", "Sousou no Frieren"],
		]);
	});

	it("reads a book's and a game's status as the four shared ones", () => {
		const book = (read_status: unknown) => items({ kind: "book", openLibraryId: "OL1W" }, { title: "Dune", read_status })[0].status;
		expect([book("to read"), book("reading"), book("read"), book("dropped"), book(null), book("whatever")]).toEqual(["planned", "progress", "finished", "dropped", "planned", "planned"]);
		const game = (play_status: unknown) => items({ kind: "game", igdbId: 1 }, { title: "Hades", play_status })[0].status;
		expect([game("backlog"), game("playing"), game("completed"), game("abandoned"), game(undefined)]).toEqual(["planned", "progress", "finished", "dropped", "planned"]);
		expect(items({ kind: "game", igdbId: 1 }, { title: "Hades", play_status: "completed", completed: "2026-01-05" })[0].finished).toBe("2026-01-05");
		expect(items({ kind: "book", openLibraryId: "OL1W" }, { title: "Dune", read_status: "read", finished: "2024-08-01" })[0].finished).toBe("2024-08-01");
	});

	it("puts an album there, listened or not", () => {
		const [album] = items({ kind: "album", mbAlbumId: "a" }, { title: "Interstellar", year: "2014-11-17", listened: true, listen_date: "2026-02-01" });
		expect(album).toMatchObject({ kind: "album", status: "finished", year: 2014, finished: "2026-02-01" });
		expect(items({ kind: "album", mbAlbumId: "a" }, { title: "Interstellar" })[0].status).toBe("planned");
	});

	it("leaves people and songs off the shelf", () => {
		expect(items({ kind: "director", tmdbId: 1 }, { name: "Denis Villeneuve" })).toEqual([]);
		expect(items({ kind: "mangaka", malId: 1 }, { name: "Yuki Urushibara" })).toEqual([]);
		expect(items({ kind: "artist", mbArtistId: "a" }, { name: "Hans Zimmer" })).toEqual([]);
		expect(items({ kind: "author", openLibraryId: "OL1A" }, { name: "Frank Herbert" })).toEqual([]);
		expect(items({ kind: "song", mbRecordingId: "s" }, { title: "Cornfield Chase" })).toEqual([]);
	});

	it("falls back on the note's name for a work with no title", () => {
		expect(items({ kind: "film", tmdbId: 1 }, {})[0].title).toBe("Note");
	});
});

describe("how the shelf reads", () => {
	it("says where the user is in each kind's own words", () => {
		expect(statusLabel("film", "planned")).toBe("To watch");
		expect(statusLabel("tv", "progress")).toBe("Watching");
		expect(statusLabel("manga", "progress")).toBe("Reading");
		expect(statusLabel("book", "dropped")).toBe("Dropped");
		expect(statusLabel("game", "planned")).toBe("Backlog");
		expect(statusLabel("game", "dropped")).toBe("Abandoned");
		expect(statusLabel("album", "finished")).toBe("Listened");
	});

	it("says how far through with its length, where that is known", () => {
		expect(progressLabel({ done: 12, total: 24, unit: "ep" })).toBe("12/24 ep");
	});

	it("puts the newest note first, and works added together by title", () => {
		const item = (title: string, added: number) => ({ title, added, kind: "film" }) as LibraryItem;
		const sorted = [item("B", 1), item("A", 1), item("C", 5)].sort(byAdded);
		expect(sorted.map((one) => one.title)).toEqual(["C", "A", "B"]);
	});
});

describe("finding a work on the shelf", () => {
	const anime = items(
		{ kind: "series", animeMalId: 1, mangaMalId: 2 },
		{
			title: "Shingeki no Kyojin",
			english_title: "Attack on Titan",
			japanese_title: "進撃の巨人",
			aliases: ["AoT"],
			manga: { title: "Shingeki no Kyojin (Manga)" },
		},
	);

	it("knows a work by every name its note gives it, the title first", () => {
		expect(anime[0].names).toEqual(["Shingeki no Kyojin", "Attack on Titan", "進撃の巨人", "AoT"]);
		// The manga is found by the series' names as well as its own.
		expect(anime[1].names).toEqual(["Shingeki no Kyojin (Manga)", "Shingeki no Kyojin", "Attack on Titan", "進撃の巨人", "AoT"]);
		const book = items({ kind: "book", openLibraryId: "OL1W" }, { title: "Crime and Punishment", original_title: "Преступление и наказание", aliases: "Suç ve Ceza" })[0];
		expect(book.names).toEqual(["Crime and Punishment", "Преступление и наказание", "Suç ve Ceza"]);
	});

	it("finds it by any of them, every word in any order, whatever the case and the accents", () => {
		expect(matchesSearch(anime[0], "attack")).toBe(true);
		expect(matchesSearch(anime[0], "titan ON")).toBe(true);
		expect(matchesSearch(anime[0], "巨人")).toBe(true);
		expect(matchesSearch(anime[0], "titan kyojin")).toBe(false);
		expect(matchesSearch(anime[0], "   ")).toBe(true);
		const book = items({ kind: "book", openLibraryId: "OL1W" }, { title: "Kürk Mantolu Madonna", aliases: ["Madonna in a Fur Coat"] })[0];
		expect(matchesSearch(book, "kurk")).toBe(true);
		expect(matchesSearch(book, "KÜRK mantolu")).toBe(true);
		expect(searchKey("SUÇ ve CEZA")).toBe("suc ve ceza");
		expect(searchKey("Iİıi")).toBe("iiii");
	});
});

describe("putting the shelf in order", () => {
	const work = (title: string, added: number, year: number | null, finished: string | null) => ({ title, added, year, finished, kind: "film" }) as LibraryItem;
	const shelf = [work("b", 3, 2001, null), work("A", 1, null, "2026-01-02"), work("c", 2, 2010, "2025-05-05"), work("Item 10", 0, 2001, null), work("Item 9", 0, null, null)];
	const titles = (sort: Parameters<typeof sortItems>[1]) => sortItems(shelf, sort).map((one) => one.title);

	it("puts the newest note first", () => {
		expect(titles("added")).toEqual(["b", "c", "A", "Item 10", "Item 9"]);
	});

	it("puts the titles from A, whatever their case, and numbers by their value", () => {
		expect(titles("title")).toEqual(["A", "b", "c", "Item 9", "Item 10"]);
	});

	it("puts the latest year first, those with none last, the same year by title", () => {
		expect(titles("year")).toEqual(["c", "b", "Item 10", "A", "Item 9"]);
	});

	it("puts the latest finished first, those not finished last", () => {
		expect(titles("finished")).toEqual(["A", "c", "b", "Item 9", "Item 10"]);
	});

	it("leaves the shelf it was given as it was", () => {
		sortItems(shelf, "title");
		expect(shelf[0].title).toBe("b");
	});
});

describe("the plugin's own views", () => {
	// Obsidian opens a view by its own open(), which puts it on the page and calls onOpen(): a view with an open() of its own stays blank.
	it("leave the methods Obsidian opens and closes a view by to Obsidian", () => {
		for (const View of [LibraryView, DiaryView]) {
			for (const name of ["open", "close", "load", "unload"]) {
				expect(Object.getOwnPropertyNames(View.prototype), `${View.name}.${name}`).not.toContain(name);
			}
		}
	});
});
