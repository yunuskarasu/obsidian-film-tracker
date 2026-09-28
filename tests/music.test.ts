import { describe, expect, it } from "vitest";
import {
	albumTypeOf,
	deezerAlbumIdsOf,
	findSong,
	pickDeezerEdition,
	artistNoteName,
	formatLength,
	isLatin,
	matchKey,
	photoCredit,
	pickEdition,
	rankAlbums,
	songNoteName,
	songTracksOf,
	toArtistMetadata,
	toArtistSearchResult,
	tracksOf,
	type MbArtist,
	type MbRelease,
	type MbReleaseGroup,
} from "../src/music";
import { fixture } from "./music-fixtures";

/*
 * What an artist or album note is made of, checked against MusicBrainz's own
 * answers (tests/fixtures/musicbrainz, recorded 2026-09-24).
 */

describe("artistNoteName", () => {
	it("keeps a name already in Latin letters", () => {
		expect(artistNoteName(fixture<MbArtist>("artist-radiohead"))).toBe("Radiohead");
		expect(artistNoteName(fixture<MbArtist>("artist-sezen-aksu"))).toBe("Sezen Aksu");
	});

	it("takes the English name of an artist MusicBrainz names in their own script", () => {
		expect(artistNoteName(fixture<MbArtist>("artist-joe-hisaishi"))).toBe("Joe Hisaishi");
		expect(artistNoteName(fixture<MbArtist>("artist-utada"))).toBe("Hikaru Utada");
		expect(artistNoteName(fixture<MbArtist>("artist-seatbelts"))).toBe("The Seatbelts");
	});

	it("reads the sort name the other way round when there are no aliases to go by", () => {
		expect(artistNoteName({ id: "x", name: "久石譲", "sort-name": "Hisaishi, Joe" })).toBe("Joe Hisaishi");
		expect(artistNoteName({ id: "x", name: "久石譲" })).toBe("久石譲");
	});

	it("tells Latin letters from the rest, accents and punctuation included", () => {
		expect(isLatin("Barış Manço & Kurtalan Ekspres!")).toBe(true);
		expect(isLatin("シートベルツ")).toBe(false);
		expect(isLatin("방탄소년단")).toBe(false);
	});
});

describe("toArtistMetadata", () => {
	it("names the note in English and keeps both names as aliases", () => {
		expect(toArtistMetadata(fixture<MbArtist>("artist-joe-hisaishi"))).toMatchObject({
			name: "Joe Hisaishi",
			originalName: "久石譲",
			aliases: ["Joe Hisaishi", "久石譲"],
			type: "Person",
			country: "JP",
			begin: "1950-12-06",
			end: null,
			wikidataId: "Q275900",
			deezerId: "66582",
		});
	});

	it("gives a Latin-named artist one alias and no original name", () => {
		const radiohead = toArtistMetadata(fixture<MbArtist>("artist-radiohead"));
		expect(radiohead).toMatchObject({ name: "Radiohead", originalName: null, aliases: ["Radiohead"], type: "Group", begin: "1991" });
		expect(radiohead.genres.length).toBeLessThanOrEqual(5);
		expect(radiohead.genres[0]).toBe("alternative rock");
	});
});

describe("toArtistSearchResult", () => {
	it("says enough to tell four artists called Seatbelts apart", () => {
		const results = fixture<{ artists: MbArtist[] }>("search-artist-seatbelts").artists.map(toArtistSearchResult);
		const band = results.find((artist) => artist.originalName === "シートベルツ");
		expect(band?.name).toBe("The Seatbelts");
		expect(band?.details).toContain("JP");
		expect(band?.details).toContain("Japanese space jazz band");
		expect(results[0]).toMatchObject({ name: "Seatbelts", originalName: null });
		expect(results[0].details).toContain("rock band from Liverpool, UK");
	});
});

describe("albumTypeOf", () => {
	it("files a soundtrack, a live album or a compilation as that rather than an album", () => {
		expect(albumTypeOf("Album", ["Soundtrack"])).toBe("Soundtrack");
		expect(albumTypeOf("Album", ["Compilation", "Soundtrack"])).toBe("Soundtrack");
		expect(albumTypeOf("Album", ["Live"])).toBe("Live");
		expect(albumTypeOf("EP", [])).toBe("EP");
		expect(albumTypeOf(null, undefined)).toBe("Other");
	});
});

describe("rankAlbums", () => {
	it("keeps MusicBrainz's order and moves mixtapes, interviews and the like to the end", () => {
		const groups: MbReleaseGroup[] = [
			{ id: "a", "primary-type": "Single", "secondary-types": ["Mixtape/Street"] },
			{ id: "b", "primary-type": "Album" },
			{ id: "c", "primary-type": "Other", "secondary-types": ["Interview"] },
			{ id: "d", "primary-type": "EP" },
		];
		expect(rankAlbums(groups).map((group) => group.id)).toEqual(["b", "d", "a", "c"]);
	});
});

describe("pickEdition", () => {
	const releases = (name: string) => fixture<{ releases: MbRelease[] }>(`releases-${name}`).releases;
	const firstDate = (name: string) => fixture<MbReleaseGroup>(`album-${name}`)["first-release-date"];
	const tracks = (release: MbRelease | null) => release?.media?.reduce((n, m) => n + (m["track-count"] ?? 0), 0);

	it("takes the standard edition out of those released the same day, not the deluxe one", () => {
		// Interstellar: a 16-track CD in the US and Europe, a 30-track digital deluxe worldwide.
		expect(tracks(pickEdition(releases("interstellar"), firstDate("interstellar")))).toBe(16);
	});

	it("reads each album from a release of its own first day", () => {
		for (const [name, count] of [["ok-computer", 12], ["abbey-road", 17], ["white-album", 30], ["my-iron-lung", 8], ["spirited-away", 21]] as const) {
			const edition = pickEdition(releases(name), firstDate(name));
			expect(edition?.date, name).toBe(firstDate(name));
			expect(tracks(edition), name).toBe(count);
		}
	});

	it("falls back to the earliest release, and to unofficial ones when there are no others", () => {
		const bootlegs: MbRelease[] = [
			{ id: "late", date: "2001", status: "Bootleg" },
			{ id: "early", date: "1999", status: "Bootleg" },
		];
		expect(pickEdition(bootlegs, "1998")?.id).toBe("early");
		expect(pickEdition([], "1998")).toBeNull();
	});
});

describe("deezerAlbumIdsOf", () => {
	it("collects the Deezer pages MusicBrainz links an album's releases to, each once", () => {
		expect(deezerAlbumIdsOf(fixture<{ releases: MbRelease[] }>("releases-ok-computer").releases)).toEqual(["14879699", "43197211"]);
		expect(deezerAlbumIdsOf(fixture<{ releases: MbRelease[] }>("releases-first-love").releases)).toEqual([]);
	});
});

describe("pickDeezerEdition", () => {
	const edition = (tracks: number, recordType = "album") => ({ tracks, recordType, coverUrl: `cover-${tracks}-${recordType}` });

	it("takes the edition with the album's own number of tracks over a deluxe one", () => {
		expect(pickDeezerEdition([edition(40), edition(17)], 17)?.tracks).toBe(17);
		expect(pickDeezerEdition([edition(23), edition(12)], 12)?.tracks).toBe(12);
	});

	it("takes the closest in length when none has exactly as many", () => {
		expect(pickDeezerEdition([edition(7, "ep")], 8)?.tracks).toBe(7);
	});

	it("never takes a single for an album — MusicBrainz links Interstellar's to its soundtrack", () => {
		expect(pickDeezerEdition([edition(30), edition(1, "single")], 16)).toMatchObject({ tracks: 30 });
		expect(pickDeezerEdition([edition(1, "single")], 16)).toBeNull();
		expect(pickDeezerEdition([edition(1, "single")], 1)).toMatchObject({ tracks: 1 });
		expect(pickDeezerEdition([], 12)).toBeNull();
	});
});

describe("tracksOf", () => {
	it("numbers a two-disc album disc by disc", () => {
		const white = tracksOf(fixture<MbRelease>("release-white-album"));
		expect(white).toHaveLength(30);
		expect(white[0]).toEqual({ disc: 1, n: 1, title: "Back in the U.S.S.R.", length: "2:43" });
		expect(white.filter((track) => track.disc === 2)[0]).toMatchObject({ disc: 2, n: 1 });
	});

	it("leaves the disc out on a single-disc album", () => {
		expect(tracksOf(fixture<MbRelease>("release-ok-computer"))[0]).toEqual({ disc: null, n: 1, title: "Airbag", length: "4:44" });
	});
});

describe("songTracksOf", () => {
	it("numbers a release's songs the way tracksOf numbers the album note's lines", () => {
		const release = fixture<MbRelease>("songs-white-album");
		const songs = songTracksOf(release);
		expect(songs.map(({ disc, n, title }) => ({ disc, n, title }))).toEqual(
			tracksOf(release).map(({ disc, n, title }) => ({ disc, n, title })),
		);
		expect(songs.find((song) => song.disc === 2 && song.n === 1)?.title).toBe("Birthday");
	});

	it("keeps each song's recording and who the track itself is credited to", () => {
		const [airbag] = songTracksOf(fixture<MbRelease>("songs-ok-computer"));
		expect(airbag).toMatchObject({ disc: null, n: 1, title: "Airbag", length: "4:44", mbRecordingId: "4a7fea2e-545b-4c63-bc9a-9943cc3a29d7" });
		expect(airbag.credits.map((credit) => credit.name)).toEqual(["Radiohead"]);
	});

	it("leaves out a track MusicBrainz has no recording for", () => {
		const release: MbRelease = { id: "r", media: [{ tracks: [{ position: 1, title: "Kept", recording: { id: "a" } }, { position: 2, title: "Gone" }] }] };
		expect(songTracksOf(release).map((song) => song.title)).toEqual(["Kept"]);
	});
});

describe("findSong", () => {
	const songs = [
		{ disc: 1, n: 1, title: "Back in the U.S.S.R." },
		{ disc: 1, n: 2, title: "Dear Prudence" },
		{ disc: 2, n: 1, title: "Birthday" },
		{ disc: 2, n: 2, title: "Yer Blues" },
	];

	it("finds the song at the same disc and number, by the same title", () => {
		expect(findSong(songs, { disc: 2, n: 1, title: "Birthday" })).toBe(songs[2]);
	});

	it("goes by the title when the numbers have moved", () => {
		expect(findSong(songs, { disc: 1, n: 5, title: "Yer blues" })).toBe(songs[3]);
	});

	it("finds nothing rather than whatever sits at that number now", () => {
		expect(findSong(songs, { disc: 1, n: 2, title: "Something" })).toBeNull();
	});

	it("reads a missing disc as the first", () => {
		const single = [{ disc: null, n: 1, title: "Airbag" }];
		expect(findSong(single, { disc: null, n: 1, title: "Airbag" })).toBe(single[0]);
	});
});

describe("songNoteName", () => {
	it("names a song after its first artist", () => {
		expect(songNoteName("Here Comes the Sun", ["The Beatles"])).toBe("Here Comes the Sun (The Beatles)");
		expect(songNoteName("Tank!", ["The Seatbelts", "Yoko Kanno"])).toBe("Tank! (The Seatbelts)");
	});

	it("uses the title alone when no artist is credited", () => {
		expect(songNoteName("Intro", [])).toBe("Intro");
	});
});

describe("formatLength", () => {
	it("writes minutes and seconds, and hours when there are any", () => {
		expect(formatLength(284400)).toBe("4:44");
		expect(formatLength(59_600)).toBe("1:00");
		expect(formatLength(3_723_000)).toBe("1:02:03");
		expect(formatLength(null)).toBeNull();
		expect(formatLength(0)).toBeNull();
	});
});

describe("photoCredit", () => {
	it("writes who took the photo and its licence, in one short line", () => {
		expect(photoCredit('<a href="//commons.wikimedia.org/wiki/User:Citykane">citykane</a>', "CC BY 2.0")).toBe("citykane · CC BY 2.0");
		expect(photoCredit("", "Public domain")).toBe("Public domain");
	});

	it("cuts a long author down so the line stays under 40 characters", () => {
		const credit = photoCredit("Unknown photographer (likely dead before 1948)", "Public domain");
		expect(credit.length).toBeLessThanOrEqual(40);
		expect(credit.endsWith("… · Public domain")).toBe(true);
	});
});

describe("matchKey", () => {
	it("compares titles without case, accents or punctuation", () => {
		expect(matchKey("OK Computer")).toBe(matchKey("ok computer!"));
		expect(matchKey("Gülümse")).toBe(matchKey("Gulumse"));
		expect(matchKey("Map of the Soul: 7")).not.toBe(matchKey("Map of the Soul 7 Piano Collection"));
	});
});
