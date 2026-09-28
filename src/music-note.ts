import { parseYaml } from "obsidian";
import type { AlbumMetadata, AlbumSong, AlbumTrack, ArtistMetadata, SongMetadata } from "./music";
import {
	formatNames,
	isEmptyValue,
	keepLinks,
	listValues,
	mergeAliases,
	parseFrontmatterBlocks,
	posterLine,
	serializeFrontmatterBlocks,
	yamlList,
	yamlScalar,
	yamlString,
} from "./note";
import { Quoted, flowEntry } from "./yaml-flow";

/*
 * Artist, album and song notes. None ever writes another: an album names its
 * artists — as links when their notes exist — an artist note lists the
 * albums already in the vault, and a song links the album it was added
 * from, but adding one never creates any other.
 */

/** A note split into its frontmatter blocks, as `parseFrontmatterBlocks` hands it over. */
type Doc = NonNullable<ReturnType<typeof parseFrontmatterBlocks>>;

/** Which of an album's names are written as links, and how to tell whether a note exists. */
export interface MusicLinks {
	artists: boolean;
	genres: boolean;
	isResolved: (name: string) => boolean;
}

export const NO_MUSIC_LINKS: MusicLinks = { artists: false, genres: false, isResolved: () => false };

/**
 * Where a key the note doesn't have yet goes: right after the nearest field
 * before it in `fieldOrder` that the note has, or else right before the
 * nearest one after it — never at the end past the user's own properties.
 * A key the note already has stays exactly where it is.
 */
function setKey(doc: Doc, fieldOrder: readonly string[], key: string, lines: string[]): void {
	doc.blocks.set(key, lines);
	if (doc.order.includes(key)) return;

	const canonical = fieldOrder.indexOf(key);
	for (let before = canonical - 1; before >= 0; before -= 1) {
		const at = doc.order.indexOf(fieldOrder[before]);
		if (at !== -1) {
			doc.order.splice(at + 1, 0, key);
			return;
		}
	}
	for (let after = canonical + 1; after < fieldOrder.length; after += 1) {
		const at = doc.order.indexOf(fieldOrder[after]);
		if (at !== -1) {
			doc.order.splice(at, 0, key);
			return;
		}
	}
	doc.order.push(key);
}

// ——— Artists ———

const ARTIST_FIELD_ORDER = [
	"name",
	"original_name",
	"aliases",
	"type",
	"country",
	"born",
	"died",
	"formed",
	"disbanded",
	"genres",
	"poster",
	"photo_credit",
	"mb_artist_id",
];

/**
 * A person is born and dies; a group is formed and disbands. MusicBrainz
 * keeps both as the same "begin" and "end", and writing them as one pair of
 * words would say something untrue of one of them.
 */
function lifeKeys(type: string | null): [string, string] {
	return type === "Person" || type === "Character" ? ["born", "died"] : ["formed", "disbanded"];
}

/** A date as MusicBrainz gives it: "1950-12-06", or only "1991". */
function dateLine(key: string, value: string | null): string {
	if (value === null || value.trim() === "") return `${key}:`;
	return /^\d{4}$/.test(value) ? `${key}: ${value}` : `${key}: ${yamlString(value)}`;
}

function artistLines(artist: ArtistMetadata): [string, string[]][] {
	const [begin, end] = lifeKeys(artist.type);
	return [
		["name", [`name: ${yamlString(artist.name)}`]],
		["original_name", [yamlScalar("original_name", artist.originalName)]],
		["aliases", yamlList("aliases", artist.aliases)],
		["type", [yamlScalar("type", artist.type)]],
		["country", [yamlScalar("country", artist.country)]],
		[begin, [dateLine(begin, artist.begin)]],
		[end, [dateLine(end, artist.end)]],
		["genres", yamlList("genres", artist.genres)],
		["mb_artist_id", [`mb_artist_id: ${artist.mbArtistId}`]],
	];
}

export function buildArtistNoteContent(artist: ArtistMetadata, photoLink: string | null, credit: string | null): string {
	const owned = new Map(artistLines(artist));
	const lines = ["---"];
	for (const key of ARTIST_FIELD_ORDER) {
		if (key === "poster") lines.push(posterLine(photoLink === null ? null : photoLink.replace(/^!/, "")));
		else if (key === "photo_credit") lines.push(yamlScalar("photo_credit", photoLink === null ? null : credit));
		else lines.push(...(owned.get(key) ?? []));
	}
	lines.push("---", "");
	return lines.join("\n");
}

/**
 * Rewrites what MusicBrainz knows about the artist. The photo and its credit
 * are only ever filled in when the note has none — or `posterMissing`, one
 * whose file is gone from the vault — the aliases the user added
 * are kept, and so is every other property and the body.
 */
export function refreshArtistFrontmatter(
	content: string,
	artist: ArtistMetadata,
	photo: { link: string; credit: string | null } | null,
	previous: Record<string, unknown> = {},
	posterMissing = false,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const [key, lines] of artistLines(artist)) setKey(doc, ARTIST_FIELD_ORDER, key, lines);
	const aliases = mergeAliases(artist.aliases, listValues(previous.aliases), [
		...listValues(previous.name),
		...listValues(previous.original_name),
	]);
	doc.blocks.set("aliases", yamlList("aliases", aliases));

	if (photo !== null && (posterMissing || isEmptyValue(doc.blocks.get("poster")))) {
		setKey(doc, ARTIST_FIELD_ORDER, "poster", [posterLine(photo.link.replace(/^!/, ""))]);
		setKey(doc, ARTIST_FIELD_ORDER, "photo_credit", [yamlScalar("photo_credit", photo.credit)]);
	}
	return serializeFrontmatterBlocks(doc);
}

/**
 * "Change photo": the note shows another photo, credited to its source — or
 * to nobody, for a picture the user already had. Nothing else moves.
 */
export function setArtistPhoto(content: string, photoLink: string, credit: string | null): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;
	setKey(doc, ARTIST_FIELD_ORDER, "poster", [posterLine(photoLink.replace(/^!/, ""))]);
	setKey(doc, ARTIST_FIELD_ORDER, "photo_credit", [yamlScalar("photo_credit", credit)]);
	return serializeFrontmatterBlocks(doc);
}

// ——— Albums ———

const TRACKS_KEY = "tracks";

const ALBUM_FIELD_ORDER = [
	"title",
	"artists",
	"year",
	"album_type",
	"genres",
	"runtime",
	"tracks_count",
	"poster",
	"mb_album_id",
	"listened",
	"listen_date",
	"listen_count",
	TRACKS_KEY,
];

/** A track as the note keeps it: what MusicBrainz knows, and any key the user added to its line. */
export interface AlbumTrackEntry extends AlbumTrack {
	extra: Record<string, unknown>;
}

const KNOWN_TRACK_KEYS = ["disc", "n", "title", "length"];

function trackLine(track: AlbumTrackEntry): string {
	return flowEntry([
		["disc", track.disc],
		["n", track.n],
		["title", track.title],
		["length", track.length === null ? null : new Quoted(track.length)],
		...Object.entries(track.extra),
	]);
}

export function trackLines(tracks: AlbumTrackEntry[]): string[] {
	return [`${TRACKS_KEY}:`, ...tracks.map(trackLine)];
}

function toTrackEntry(value: unknown): AlbumTrackEntry | null {
	if (typeof value !== "object" || value === null) return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.n !== "number") return null;
	const extra: Record<string, unknown> = {};
	for (const [key, own] of Object.entries(raw)) {
		if (!KNOWN_TRACK_KEYS.includes(key)) extra[key] = own;
	}
	return {
		disc: typeof raw.disc === "number" ? raw.disc : null,
		n: raw.n,
		title: typeof raw.title === "string" ? raw.title : typeof raw.title === "number" ? String(raw.title) : "",
		length: typeof raw.length === "string" ? raw.length : null,
		extra,
	};
}

/**
 * The tracks a note holds. `null` means the block is there but can't be
 * read, and the note is then left alone rather than written over — the same
 * rule a TV note's seasons follow.
 */
export function readTracks(text: string[] | undefined): AlbumTrackEntry[] | null {
	if (text === undefined) return [];
	let parsed: unknown;
	try {
		parsed = parseYaml(text.join("\n")) as unknown;
	} catch {
		return null;
	}
	const list: unknown = (parsed as Record<string, unknown> | null)?.[TRACKS_KEY];
	if (list === null || list === undefined) return [];
	if (!Array.isArray(list)) return null;

	const tracks: AlbumTrackEntry[] = [];
	for (const item of list) {
		const track = toTrackEntry(item);
		if (track === null) return null;
		tracks.push(track);
	}
	return tracks;
}

/** Fresh tracks, each keeping the keys the user added to the same disc and number. */
function mergeTracks(existing: AlbumTrackEntry[], fresh: AlbumTrack[]): AlbumTrackEntry[] {
	const key = (track: AlbumTrack) => `${track.disc ?? 1}.${track.n}`;
	const extras = new Map(existing.map((track) => [key(track), track.extra]));
	return fresh.map((track) => ({ ...track, extra: extras.get(key(track)) ?? {} }));
}

function albumLines(album: AlbumMetadata, links: MusicLinks, previous?: Record<string, unknown>): [string, string[]][] {
	const names = (key: "artists" | "genres", values: string[], link: boolean) =>
		yamlList(key, keepLinks(link ? formatNames(values, links.isResolved) : values, previous?.[key]));
	return [
		["title", [`title: ${yamlString(album.title)}`]],
		["artists", names("artists", album.artists, links.artists)],
		["year", [yamlScalar("year", album.year)]],
		["album_type", [yamlScalar("album_type", album.albumType)]],
		["genres", names("genres", album.genres, links.genres)],
		["runtime", [yamlScalar("runtime", album.runtime)]],
		["tracks_count", [yamlScalar("tracks_count", album.tracks.length)]],
		["mb_album_id", [`mb_album_id: ${album.mbAlbumId}`]],
	];
}

export function buildAlbumNoteContent(album: AlbumMetadata, coverLink: string | null, links: MusicLinks): string {
	const owned = new Map(albumLines(album, links));
	const lines = ["---"];
	for (const key of ALBUM_FIELD_ORDER) {
		if (key === "poster") lines.push(posterLine(coverLink === null ? null : coverLink.replace(/^!/, "")));
		else if (key === "listened") lines.push("listened: false");
		else if (key === "listen_date") lines.push("listen_date:");
		else if (key === "listen_count") lines.push("listen_count: 0");
		else if (key === TRACKS_KEY) lines.push(...trackLines(album.tracks.map((track) => ({ ...track, extra: {} }))));
		else lines.push(...(owned.get(key) ?? []));
	}
	lines.push("---", "");
	return lines.join("\n");
}

/**
 * Rewrites what MusicBrainz knows about the album. `listened`, its date and
 * count, the cover once there is one, a key added to a track's line, every
 * other property and the body are the user's and stay as they are. A note
 * whose tracks can't be read is left untouched.
 */
export function refreshAlbumFrontmatter(
	content: string,
	album: AlbumMetadata,
	links: MusicLinks,
	coverLink: string | null,
	previous: Record<string, unknown> = {},
	posterMissing = false,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;
	const existing = readTracks(doc.blocks.get(TRACKS_KEY));
	if (existing === null) return content;

	for (const [key, lines] of albumLines(album, links, previous)) setKey(doc, ALBUM_FIELD_ORDER, key, lines);
	setKey(doc, ALBUM_FIELD_ORDER, TRACKS_KEY, trackLines(mergeTracks(existing, album.tracks)));
	if (coverLink !== null && (posterMissing || isEmptyValue(doc.blocks.get("poster")))) {
		setKey(doc, ALBUM_FIELD_ORDER, "poster", [posterLine(coverLink.replace(/^!/, ""))]);
	}
	return serializeFrontmatterBlocks(doc);
}

/** Whether a note's tracks can be read — and so written. */
export function tracksReadable(content: string): boolean {
	const doc = parseFrontmatterBlocks(content);
	return doc !== null && readTracks(doc.blocks.get(TRACKS_KEY)) !== null;
}

export interface ListenProgress {
	listened: boolean;
	count: number;
	date: string | null;
}

export function listenProgressOf(frontmatter: Record<string, unknown> | undefined): ListenProgress {
	const count = frontmatter?.listen_count;
	const date = frontmatter?.listen_date;
	return {
		listened: frontmatter?.listened === true,
		count: typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
		date: typeof date === "string" && date.trim() !== "" ? date.trim() : null,
	};
}

/**
 * "Listened today": the album is ticked, dated — the first time only, the
 * way a film's `watch_date` keeps the day it was first seen — and counted
 * once more. Listening again is the point of an album, so unlike a film it
 * can be marked any number of times.
 */
export function markAlbumListened(content: string, date: string, count: number): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;
	setKey(doc, ALBUM_FIELD_ORDER, "listened", ["listened: true"]);
	if (isEmptyValue(doc.blocks.get("listen_date"))) setKey(doc, ALBUM_FIELD_ORDER, "listen_date", [`listen_date: ${date}`]);
	setKey(doc, ALBUM_FIELD_ORDER, "listen_count", [`listen_count: ${count + 1}`]);
	return serializeFrontmatterBlocks(doc);
}

/**
 * The tracks as the TRACKLIST panel shows them: whatever lines can be read,
 * in their order. Only a write needs every line readable (see `readTracks`).
 */
export function albumTracksOf(frontmatter: Record<string, unknown> | undefined): AlbumTrackEntry[] {
	const raw: unknown = frontmatter?.[TRACKS_KEY];
	if (!Array.isArray(raw)) return [];
	return raw.map(toTrackEntry).filter((track): track is AlbumTrackEntry => track !== null);
}

// ——— Songs ———

const SONG_FIELD_ORDER = ["title", "aliases", "artists", "album", "track", "disc", "length", "year", "poster", "mb_recording_id"];

/** The album a song note is added from: a link to the album's note, and the album's year. */
export interface SongAlbum {
	link: string;
	year: number | null;
}

/** What MusicBrainz knows of the song itself — what a refresh rewrites. */
function songLines(song: SongMetadata, links: MusicLinks, previous?: Record<string, unknown>): [string, string[]][] {
	const artists = links.artists ? formatNames(song.artists, links.isResolved) : song.artists;
	return [
		["artists", yamlList("artists", keepLinks(artists, previous?.artists))],
		// Always quoted: "3:06" unquoted is a number of seconds to some YAML readers.
		["length", [song.length === null ? "length:" : `length: ${JSON.stringify(song.length)}`]],
		["mb_recording_id", [`mb_recording_id: ${song.mbRecordingId}`]],
	];
}

/**
 * A song's note: the song, and where it sits on the album it was added from.
 * The cover is the album's own file, linked rather than copied. `disc` is
 * only written for an album of more than one. `alias` is the name a song
 * named by its title alone is also found by: "The Art of Dying (Gojira)".
 */
export function buildSongNoteContent(
	song: AlbumSong,
	album: SongAlbum,
	coverLink: string | null,
	links: MusicLinks,
	alias: string | null = null,
): string {
	const owned = new Map(songLines(song, links));
	const lines = ["---"];
	for (const key of SONG_FIELD_ORDER) {
		if (key === "title") lines.push(`title: ${yamlString(song.title)}`);
		else if (key === "aliases") {
			if (alias !== null) lines.push(...yamlList("aliases", [alias]));
		} else if (key === "album") lines.push(yamlScalar("album", album.link));
		else if (key === "track") lines.push(`track: ${song.n}`);
		else if (key === "disc") {
			if (song.disc !== null) lines.push(`disc: ${song.disc}`);
		} else if (key === "year") lines.push(yamlScalar("year", album.year));
		else if (key === "poster") lines.push(posterLine(coverLink === null ? null : coverLink.replace(/^!/, "")));
		else lines.push(...(owned.get(key) ?? []));
	}
	lines.push("---", "");
	return lines.join("\n");
}

/**
 * Brings a song's artists and length up to date. Its title, album, track
 * and year are where it sits on the album it was added from, and stay; so
 * does the cover once there is one — or is filled in when the note has none,
 * or `posterMissing`, one whose file is gone — and every other property and
 * the body, lyrics copied into it among them.
 */
export function refreshSongFrontmatter(
	content: string,
	song: SongMetadata,
	links: MusicLinks,
	coverLink: string | null,
	previous: Record<string, unknown> = {},
	posterMissing = false,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;
	for (const [key, lines] of songLines(song, links, previous)) setKey(doc, SONG_FIELD_ORDER, key, lines);
	if (coverLink !== null && (posterMissing || isEmptyValue(doc.blocks.get("poster")))) {
		setKey(doc, SONG_FIELD_ORDER, "poster", [posterLine(coverLink.replace(/^!/, ""))]);
	}
	return serializeFrontmatterBlocks(doc);
}
