/*
 * MusicBrainz's answers, and what an artist or album note is made of. Pure
 * functions only: the requests themselves are in musicbrainz.ts, so that
 * everything here can be checked against the saved answers in
 * tests/fixtures/musicbrainz.
 *
 * An album is a MusicBrainz "release group" — OK Computer as a work — rather
 * than one of its releases, of which OK Computer has 39: every pressing,
 * reissue and box set. The track list is read from the release that came out
 * first (see `pickEdition`).
 */

export interface MbAlias {
	name?: string;
	locale?: string | null;
	primary?: boolean | null;
}

export interface MbArtistRef {
	id: string;
	name?: string;
	"sort-name"?: string;
	aliases?: MbAlias[];
	country?: string | null;
	disambiguation?: string;
	type?: string | null;
}

export interface MbArtistCredit {
	name?: string;
	joinphrase?: string;
	artist?: MbArtistRef;
}

export interface MbGenre {
	name?: string;
	count?: number;
}

export interface MbRelation {
	type?: string;
	url?: { resource?: string };
}

export interface MbLifeSpan {
	begin?: string | null;
	end?: string | null;
}

export interface MbArtist extends MbArtistRef {
	"life-span"?: MbLifeSpan;
	genres?: MbGenre[];
	relations?: MbRelation[];
	score?: number;
}

export interface MbReleaseGroup {
	id: string;
	title?: string;
	"first-release-date"?: string;
	"primary-type"?: string | null;
	"secondary-types"?: string[];
	"artist-credit"?: MbArtistCredit[];
	genres?: MbGenre[];
	relations?: MbRelation[];
	score?: number;
}

export interface MbTrack {
	position?: number;
	title?: string;
	length?: number | null;
	/** Only when asked for (`inc=artist-credits`): who the track itself is by. */
	"artist-credit"?: MbArtistCredit[];
	recording?: { id?: string; title?: string; length?: number | null };
}

/** A song as MusicBrainz keeps it, whatever album it is on. */
export interface MbRecording {
	id: string;
	title?: string;
	length?: number | null;
	"artist-credit"?: MbArtistCredit[];
}

export interface MbMedium {
	position?: number;
	format?: string | null;
	"track-count"?: number;
	tracks?: MbTrack[];
}

export interface MbRelease {
	id: string;
	title?: string;
	/** The release's language and script: "jpn" in "Latn" is romaji, "eng" in "Latn" an English title. */
	"text-representation"?: { language?: string | null; script?: string | null };
	date?: string;
	country?: string | null;
	status?: string | null;
	media?: MbMedium[];
	relations?: MbRelation[];
}

export interface ArtistSearchResult {
	id: string;
	/** In Latin letters where MusicBrainz has them, the way the note would be named. */
	name: string;
	/** The name in its own script, when that is not the one above: シートベルツ. */
	originalName: string | null;
	/** What tells two artists of the same name apart: "Group · JP · Yoko Kanno's band". */
	details: (string | null)[];
}

export interface ArtistMetadata {
	name: string;
	/** The name in its own script, when the note is named by another: 久石譲 for Joe Hisaishi. */
	originalName: string | null;
	aliases: string[];
	type: string | null;
	country: string | null;
	begin: string | null;
	end: string | null;
	genres: string[];
	mbArtistId: string;
	/** Where a photo can be looked up: the artist's Wikidata item, "Q76364". */
	wikidataId: string | null;
	/** The artist's own page on Deezer, "2993" — where a press photo comes from. */
	deezerId: string | null;
}

export interface AlbumSearchResult {
	id: string;
	title: string;
	albumType: string;
	year: number | null;
	artists: string;
}

export interface AlbumTrack {
	/** Only on an album of more than one disc. */
	disc: number | null;
	n: number;
	title: string;
	length: string | null;
}

/** What MusicBrainz says of a song, for its note. */
export interface SongMetadata {
	title: string;
	/** Named the way each artist's own note is (see `artistNoteName`). */
	artists: string[];
	length: string | null;
	mbRecordingId: string;
}

/** A song where it sits on its album: the disc (on an album of more than one) and the track number. */
export interface AlbumSong extends SongMetadata {
	disc: number | null;
	n: number;
}

/** A track of a release before its artists are named: `credits` is who MusicBrainz credits for it. */
export interface SongTrack {
	disc: number | null;
	n: number;
	title: string;
	length: string | null;
	mbRecordingId: string;
	credits: MbArtistCredit[];
}

export interface AlbumMetadata {
	title: string;
	/** Named the way each artist's own note is (see `artistNoteName`). */
	artists: string[];
	year: number | null;
	albumType: string;
	genres: string[];
	/** Minutes, from the track lengths; `null` when MusicBrainz lacks any of them. */
	runtime: number | null;
	tracks: AlbumTrack[];
	mbAlbumId: string;
	/**
	 * The album's pages on Deezer, from the links MusicBrainz keeps on its
	 * releases — where the cover comes from. Never written to the note.
	 */
	deezerAlbumIds: string[];
	/** The title and tracks in Latin letters, for an album whose title isn't — only when asked for. */
	latin?: LatinNames;
}

/**
 * An album's title in Latin letters: romaji first, then English, each once
 * (see `latinReleasesOf`); and its tracks' titles from the same release, in
 * the order of `tracks` — `null` for one it has no title for.
 */
export interface LatinNames {
	titles: string[];
	tracks: (string | null)[];
}

const LATIN = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u;

/** Whether a name is written in Latin letters (digits, punctuation and spaces count as either). */
export function isLatin(text: string): boolean {
	return LATIN.test(text);
}

/**
 * The name an artist's note goes by. MusicBrainz names an artist in their own
 * script — 久石譲, 宇多田ヒカル — and gives the English name as an alias; the
 * note takes the English one, so that a film's `composers: [[Joe Hisaishi]]`
 * finds it. A name already in Latin letters is kept as it is.
 */
export function artistNoteName(artist: MbArtistRef): string {
	const name = artist.name?.trim() ?? "";
	if (isLatin(name)) return name;

	const aliases = artist.aliases ?? [];
	const english =
		aliases.find((alias) => alias.locale === "en" && alias.primary === true) ??
		aliases.find((alias) => alias.locale === "en");
	if (english?.name?.trim()) return english.name.trim();

	// "Hisaishi, Joe" read the other way round, when that is in Latin letters.
	const sortName = artist["sort-name"]?.trim() ?? "";
	if (sortName !== "" && isLatin(sortName)) {
		const [last, first] = sortName.split(", ");
		return first === undefined ? sortName : `${first} ${last}`;
	}
	return name;
}

/** Whether a note name for this artist needs their aliases looked up first — see `artistNoteName`. */
export function needsAliases(artist: MbArtistRef): boolean {
	return !isLatin(artist.name ?? "") && artist.aliases === undefined;
}

export function yearOf(date: string | undefined | null): number | null {
	if (!date) return null;
	const year = Number(date.slice(0, 4));
	return Number.isInteger(year) && year > 0 ? year : null;
}

/** The most-voted genres first, as many as `max`. */
export function genresOf(genres: MbGenre[] | undefined, max = 5): string[] {
	return [...(genres ?? [])]
		.filter((genre) => typeof genre.name === "string" && genre.name.trim() !== "")
		.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
		.slice(0, max)
		.map((genre) => genre.name!.trim());
}

function wikidataIdOf(relations: MbRelation[] | undefined): string | null {
	const url = relations?.find((relation) => relation.type === "wikidata")?.url?.resource;
	const id = url?.split("/").pop();
	return id !== undefined && /^Q\d+$/.test(id) ? id : null;
}

/**
 * The artist's Deezer id, from the link MusicBrainz keeps to their Deezer
 * page — the same artist for certain, rather than whoever Deezer finds by
 * that name.
 */
function deezerIdOf(relations: MbRelation[] | undefined): string | null {
	for (const relation of relations ?? []) {
		const match = /deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/.exec(relation.url?.resource ?? "");
		if (match !== null) return match[1];
	}
	return null;
}

export function toArtistSearchResult(artist: MbArtist): ArtistSearchResult {
	const begin = yearOf(artist["life-span"]?.begin);
	const own = artist.name?.trim() ?? "";
	const name = artistNoteName(artist);
	return {
		id: artist.id,
		name,
		originalName: own !== name ? own : null,
		details: [
			artist.type ?? null,
			artist.country ?? null,
			begin === null ? null : String(begin),
			artist.disambiguation?.trim() || null,
		],
	};
}

export function toArtistMetadata(artist: MbArtist): ArtistMetadata {
	const own = artist.name?.trim() ?? "";
	const name = artistNoteName(artist);
	const originalName = own !== "" && own !== name ? own : null;
	return {
		name,
		originalName,
		aliases: originalName === null ? [name] : [name, originalName],
		type: artist.type ?? null,
		country: artist.country ?? null,
		begin: artist["life-span"]?.begin ?? null,
		end: artist["life-span"]?.end ?? null,
		genres: genresOf(artist.genres),
		mbArtistId: artist.id,
		wikidataId: wikidataIdOf(artist.relations),
		deezerId: deezerIdOf(artist.relations),
	};
}

/**
 * What kind of release a group is, in one word: a soundtrack album is filed
 * as a soundtrack rather than an album, a live one as live, and so on.
 */
export function albumTypeOf(primary: string | null | undefined, secondary: string[] | undefined): string {
	for (const kind of ["Soundtrack", "Live", "Compilation", "Remix"]) {
		if (secondary?.includes(kind)) return kind;
	}
	return primary ?? "Other";
}

/** The credit as MusicBrainz prints it: "Barış Manço & Kurtalan Ekspres". */
export function creditText(credits: MbArtistCredit[] | undefined): string {
	return (credits ?? []).map((credit) => `${credit.name ?? credit.artist?.name ?? ""}${credit.joinphrase ?? ""}`).join("").trim();
}

export function toAlbumSearchResult(group: MbReleaseGroup): AlbumSearchResult {
	return {
		id: group.id,
		title: group.title?.trim() ?? "",
		albumType: albumTypeOf(group["primary-type"], group["secondary-types"]),
		year: yearOf(group["first-release-date"]),
		artists: creditText(group["artist-credit"]),
	};
}

/** Kinds of release someone adding an album almost never means: they go to the bottom of a search. */
const UNLIKELY = ["Mixtape/Street", "DJ-mix", "Interview", "Audiobook", "Audio drama", "Spokenword", "Demo", "Field recording"];

function unlikely(group: MbReleaseGroup): boolean {
	const primary = group["primary-type"];
	if (primary === undefined || primary === null || primary === "Other" || primary === "Broadcast") return true;
	return (group["secondary-types"] ?? []).some((kind) => UNLIKELY.includes(kind));
}

/** MusicBrainz's own order, with the unlikely kinds moved after the rest. */
export function rankAlbums(groups: MbReleaseGroup[]): MbReleaseGroup[] {
	return [...groups.filter((group) => !unlikely(group)), ...groups.filter(unlikely)];
}

/** An artist's albums in the order they came out, the undated last. */
export function sortByDate(groups: MbReleaseGroup[]): MbReleaseGroup[] {
	return [...groups].sort((a, b) =>
		(a["first-release-date"] || "9999").localeCompare(b["first-release-date"] || "9999"),
	);
}

/** Between two first pressings of the same length: worldwide first, then the big markets. */
const COUNTRY_ORDER = ["XW", "XE", "GB", "US"];

function trackCount(release: MbRelease): number {
	return (release.media ?? []).reduce((total, medium) => total + (medium["track-count"] ?? 0), 0);
}

/**
 * The release to read the track list from: one that came out on the album's
 * own first date, else the earliest there is. Of several on that day, the
 * shortest is the standard edition — Interstellar came out the same day as a
 * 16-track CD and a 30-track digital deluxe — and a tie goes by country.
 * Official releases are preferred throughout; an album with none (a
 * compilation MusicBrainz only knows from bootlegs) falls back to the rest.
 */
export function pickEdition(releases: MbRelease[], firstDate: string | undefined): MbRelease | null {
	const official = releases.filter((release) => release.status === "Official");
	const pool = official.length > 0 ? official : releases;
	if (pool.length === 0) return null;

	const onFirstDate = firstDate ? pool.filter((release) => release.date === firstDate) : [];
	const candidates =
		onFirstDate.length > 0
			? onFirstDate
			: [...pool].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")).slice(0, 1);

	const country = (release: MbRelease) => {
		const at = COUNTRY_ORDER.indexOf(release.country ?? "");
		return at === -1 ? COUNTRY_ORDER.length : at;
	};
	// A release whose track count MusicBrainz doesn't have sorts last.
	const length = (release: MbRelease) => trackCount(release) || Infinity;
	return [...candidates].sort((a, b) => length(a) - length(b) || country(a) - country(b))[0];
}

/** How much a release is to be trusted for a title: a transliteration or translation is usually filed as a pseudo-release. */
const LATIN_STATUS_ORDER = ["Pseudo-Release", "Official"];

function latinRelease(releases: MbRelease[], language: string): MbRelease | null {
	const rank = (release: MbRelease) => {
		const at = LATIN_STATUS_ORDER.indexOf(release.status ?? "");
		return at === -1 ? LATIN_STATUS_ORDER.length : at;
	};
	const found = releases.filter(
		(release) =>
			release["text-representation"]?.script === "Latn" &&
			release["text-representation"]?.language === language &&
			(release.title ?? "").trim() !== "" &&
			isLatin(release.title ?? ""),
	);
	return found.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * The releases of an album with a title in another script that carry it in
 * Latin letters: romaji — Japanese written in Latin letters, "Sen to Chihiro
 * no Kamikakushi" — then English, "Spirited Away Soundtrack". None for an
 * album whose own title is in Latin letters already.
 */
export function latinReleasesOf(title: string, releases: MbRelease[]): MbRelease[] {
	if (isLatin(title)) return [];
	const found: MbRelease[] = [];
	for (const language of ["jpn", "eng"]) {
		const release = latinRelease(releases, language);
		if (release !== null && !found.some((known) => known.title?.trim() === release.title?.trim())) found.push(release);
	}
	return found;
}

/** Whether two releases have the same discs of the same lengths — so that their tracks line up one to one. */
export function sameTracklist(a: MbRelease, b: MbRelease): boolean {
	const counts = (release: MbRelease) => (release.media ?? []).map((medium) => medium["track-count"] ?? -1).join(",");
	return counts(a) !== "" && !counts(a).includes("-1") && counts(a) === counts(b);
}

/** A Latin release's tracks as titles for `tracks`, one to one; `null` where it has none, or differs from nothing. */
export function latinTracksOf(release: MbRelease | null, tracks: AlbumTrack[]): (string | null)[] {
	const latin = release === null ? [] : tracksOf(release);
	if (latin.length !== tracks.length) return tracks.map(() => null);
	return latin.map((track, index) => {
		const title = track.title.trim();
		return title === "" || title === tracks[index].title ? null : title;
	});
}

/** "4:44", or "1:02:03" for a track over an hour. */
export function formatLength(ms: number | null | undefined): string | null {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
	const total = Math.round(ms / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

function trackLength(track: MbTrack): number | null {
	const length = track.length ?? track.recording?.length ?? null;
	return typeof length === "number" && length > 0 ? length : null;
}

export function tracksOf(release: MbRelease): AlbumTrack[] {
	const media = release.media ?? [];
	const discs = media.length > 1;
	return media.flatMap((medium, index) =>
		(medium.tracks ?? []).map((track, at) => ({
			disc: discs ? (medium.position ?? index + 1) : null,
			n: track.position ?? at + 1,
			title: (track.title ?? track.recording?.title ?? "").trim(),
			length: formatLength(trackLength(track)),
		})),
	);
}

/**
 * A release's tracks as songs, numbered the way `tracksOf` numbers an
 * album note's: the same disc and track for the same line. A track
 * MusicBrainz has no recording for is left out — there is nothing to name.
 */
export function songTracksOf(release: MbRelease): SongTrack[] {
	const media = release.media ?? [];
	const discs = media.length > 1;
	return media.flatMap((medium, index) =>
		(medium.tracks ?? []).flatMap((track, at) => {
			const id = track.recording?.id;
			if (id === undefined || id === "") return [];
			return [
				{
					disc: discs ? (medium.position ?? index + 1) : null,
					n: track.position ?? at + 1,
					title: (track.title ?? track.recording?.title ?? "").trim(),
					length: formatLength(trackLength(track)),
					mbRecordingId: id,
					credits: track["artist-credit"] ?? [],
				},
			];
		}),
	);
}

/**
 * The song an album note's track line is: the one at the same disc and
 * number with the same title, else the one with that title. A title that is
 * nowhere on the album — MusicBrainz has changed it since the note was
 * written — finds nothing, rather than whatever sits at that number now.
 */
export function findSong<T extends { disc: number | null; n: number; title: string }>(
	songs: T[],
	track: { disc: number | null; n: number; title: string },
): T | null {
	const title = matchKey(track.title);
	const same = songs.filter((song) => matchKey(song.title) === title);
	return same.find((song) => (song.disc ?? 1) === (track.disc ?? 1) && song.n === track.n) ?? same[0] ?? null;
}

/** A song note's name: "Here Comes the Sun (The Beatles)" — its first artist tells two "Intro"s apart. */
export function songNoteName(title: string, artists: string[]): string {
	const artist = artists[0];
	return artist === undefined || artist === "" ? title : `${title} (${artist})`;
}

/** The whole album's length in minutes — unknown if any track's is. */
export function runtimeOf(release: MbRelease): number | null {
	const tracks = (release.media ?? []).flatMap((medium) => medium.tracks ?? []);
	if (tracks.length === 0) return null;
	let total = 0;
	for (const track of tracks) {
		const length = trackLength(track);
		if (length === null) return null;
		total += length;
	}
	return Math.round(total / 60000);
}

/** How many Deezer pages of one album are looked at for its cover. */
const DEEZER_EDITIONS_MAX = 3;

/** The Deezer album ids MusicBrainz links any of an album's releases to, in the order they come. */
export function deezerAlbumIdsOf(releases: MbRelease[]): string[] {
	const ids: string[] = [];
	for (const release of releases) {
		for (const relation of release.relations ?? []) {
			const match = /deezer\.com\/(?:[a-z]{2}\/)?album\/(\d+)/.exec(relation.url?.resource ?? "");
			if (match !== null && !ids.includes(match[1])) ids.push(match[1]);
		}
	}
	return ids.slice(0, DEEZER_EDITIONS_MAX);
}

/** One of an album's pages on Deezer, as far as choosing its cover goes. */
export interface DeezerEdition {
	tracks: number;
	recordType: string | null;
	coverUrl: string;
}

/**
 * The Deezer page whose cover is the album's: the one with exactly the
 * album's number of tracks — the standard edition, not a 40-track deluxe —
 * or else the closest in length. A single is never taken for an album of
 * more than one track: MusicBrainz sometimes links a soundtrack's single.
 */
export function pickDeezerEdition(editions: DeezerEdition[], trackCount: number): DeezerEdition | null {
	const usable = editions.filter((edition) => trackCount <= 1 || edition.recordType !== "single");
	if (usable.length === 0) return null;
	return [...usable].sort((a, b) => Math.abs(a.tracks - trackCount) - Math.abs(b.tracks - trackCount))[0];
}

export function toAlbumMetadata(
	group: MbReleaseGroup,
	release: MbRelease | null,
	artists: string[],
	deezerAlbumIds: string[] = [],
): AlbumMetadata {
	return {
		title: group.title?.trim() ?? "",
		artists,
		year: yearOf(group["first-release-date"]),
		albumType: albumTypeOf(group["primary-type"], group["secondary-types"]),
		genres: genresOf(group.genres),
		runtime: release === null ? null : runtimeOf(release),
		tracks: release === null ? [] : tracksOf(release),
		mbAlbumId: group.id,
		deezerAlbumIds,
	};
}

/** Lowercase letters and digits only, accents dropped: how two titles are compared for a match. */
export function matchKey(text: string): string {
	return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const CREDIT_MAX = 40;

/**
 * The `photo_credit` line for a Wikimedia Commons photo: who took it and
 * under which licence, "citykane · CC BY 2.0" — what the licence asks for,
 * short enough for a property. Commons gives the author as HTML, sometimes
 * with a note of the uploader's; that is cleaned up and cut to fit.
 */
export function photoCredit(authorHtml: string | null | undefined, license: string | null | undefined): string {
	const author = (authorHtml ?? "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
	const licence = (license ?? "").trim() || "Wikimedia Commons";
	if (author === "") return licence;
	const room = CREDIT_MAX - licence.length - 3;
	const short = author.length <= room ? author : `${author.slice(0, Math.max(room - 1, 1)).trimEnd()}…`;
	return `${short} · ${licence}`;
}
