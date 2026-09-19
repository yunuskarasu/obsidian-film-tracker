import type { App, TFile } from "obsidian";
import { parse } from "yaml";
// The same module the plugin gets for "obsidian" in tests (see vitest.config.mts),
// imported directly for its constructors, which Obsidian's own types don't expose.
import { TFile as StubFile, TFolder as StubFolder } from "./obsidian-stub";
import type { ConfirmAnswer, ConfirmRequest } from "../src/confirm-modal";
import type { LinkChoice } from "../src/link-confirm-modal";
import { MalError, type AnimeMetadata, type MalClient, type MangaAuthor, type MangaMetadata, type MangakaMetadata } from "../src/mal";
import { DEFAULT_SETTINGS, type FilmTrackerSettings } from "../src/settings";
import {
	TmdbError,
	type DirectorMetadata,
	type FilmSearchResult,
	type TmdbClient,
} from "../src/tmdb";
import type { FilmMetadata } from "../src/note";

function fileName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function tfile(path: string): TFile {
	// The stub stands in for Obsidian's TFile, whose constructor isn't public;
	// the plugin's own `instanceof TFile` checks see the stub class in tests.
	return new StubFile(path) as unknown as TFile;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n?---(?:\n|$)/;

/** Parsed the way Obsidian's metadata cache hands frontmatter to plugins. */
function frontmatterOf(content: string): Record<string, unknown> | undefined {
	const match = content.replace(/\r\n/g, "\n").match(FRONTMATTER);
	if (match === null) return undefined;
	const parsed: unknown = parse(match[1]);
	return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
}

/** The targets of the `[[links]]` in `text`, embeds included, without any #heading or |alias. */
function wikilinks(text: string): string[] {
	return [...text.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)].map((match) => match[1]);
}

/** A note's links and embeds below its frontmatter, as Obsidian's cache lists them. */
function bodyLinks(content: string): { links: { link: string }[]; embeds: { link: string }[] } {
	const body = content.replace(/\r\n/g, "\n").replace(FRONTMATTER, "");
	const embeds = wikilinks(body.match(/!\[\[[^\]]*\]\]/g)?.join(" ") ?? "");
	const links = wikilinks(body.replace(/!\[\[[^\]]*\]\]/g, ""));
	return { links: links.map((link) => ({ link })), embeds: embeds.map((link) => ({ link })) };
}

/**
 * An in-memory vault with just enough of Obsidian's `App` for the plugin's
 * actions: notes, images and folders; a metadata cache that parses each
 * note's frontmatter; link resolution; and a workspace whose on-screen note
 * the test controls.
 */
export class FakeApp {
	readonly notes = new Map<string, string>();
	readonly images = new Set<string>();
	readonly folders = new Set<string>();
	/** The note in the active editor tab — `null` while e.g. Graph view has the focus. */
	visible: TFile | null = null;
	/** What `getActiveFile` falls back to when no note is on screen. */
	lastActive: TFile | null = null;
	readonly opened: string[] = [];

	constructor(notes: Record<string, string> = {}, images: string[] = []) {
		for (const [path, content] of Object.entries(notes)) this.notes.set(path, content);
		for (const path of images) this.images.add(path);
	}

	/** Puts a note on screen, the way clicking it in the file explorer does. */
	show(path: string): TFile {
		const file = tfile(path);
		this.visible = file;
		this.lastActive = file;
		return file;
	}

	file(path: string): TFile {
		if (!this.exists(path)) throw new Error(`No such file in the fake vault: ${path}`);
		return tfile(path);
	}

	note(path: string): string {
		const content = this.notes.get(path);
		if (content === undefined) throw new Error(`No such note in the fake vault: ${path}`);
		return content;
	}

	frontmatter(path: string): Record<string, unknown> {
		return frontmatterOf(this.note(path)) ?? {};
	}

	private exists(path: string): boolean {
		return this.notes.has(path) || this.images.has(path);
	}

	private allPaths(): string[] {
		return [...this.notes.keys(), ...this.images];
	}

	private freePath(path: string): string {
		if (!this.exists(path)) return path;
		const dot = path.lastIndexOf(".");
		const base = dot === -1 ? path : path.slice(0, dot);
		const extension = dot === -1 ? "" : path.slice(dot);
		let index = 1;
		while (this.exists(`${base} ${index}${extension}`)) index += 1;
		return `${base} ${index}${extension}`;
	}

	get app(): App {
		const vault = {
			getMarkdownFiles: () => [...this.notes.keys()].map((path) => tfile(path)),
			getAbstractFileByPath: (path: string) =>
				this.exists(path) ? tfile(path) : this.folders.has(path) ? new StubFolder(path) : null,
			getFileByPath: (path: string) => (this.exists(path) ? tfile(path) : null),
			create: async (path: string, data: string) => {
				if (this.exists(path)) throw new Error(`File already exists: ${path}`);
				this.notes.set(path, data);
				return tfile(path);
			},
			createBinary: async (path: string) => {
				if (this.exists(path)) throw new Error(`File already exists: ${path}`);
				this.images.add(path);
				return tfile(path);
			},
			createFolder: async (path: string) => {
				const parts = path.split("/");
				for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
			},
			process: async (file: TFile, fn: (data: string) => string) => {
				const next = fn(this.note(file.path));
				this.notes.set(file.path, next);
				return next;
			},
			read: async (file: TFile) => this.note(file.path),
		};

		const resolve = (linkpath: string): string | null => {
			const paths = this.allPaths();
			return (
				paths.find((path) => path === linkpath || path === `${linkpath}.md`) ??
				paths.find((path) => fileName(path) === linkpath || fileName(path) === `${linkpath}.md`) ??
				null
			);
		};

		/** Every note's resolved links, properties included, the way Obsidian counts them. */
		const resolvedLinks = () => {
			const result: Record<string, Record<string, number>> = {};
			for (const [source, content] of this.notes) {
				const targets: Record<string, number> = {};
				for (const link of wikilinks(content)) {
					const target = resolve(link);
					if (target !== null) targets[target] = (targets[target] ?? 0) + 1;
				}
				result[source] = targets;
			}
			return result;
		};

		const metadataCache = {
			get resolvedLinks() {
				return resolvedLinks();
			},
			getFileCache: (file: TFile) => {
				const content = this.notes.get(file.path);
				return content === undefined ? null : { frontmatter: frontmatterOf(content), ...bodyLinks(content) };
			},
			getFirstLinkpathDest: (linkpath: string) => {
				const hit = resolve(linkpath);
				return hit === null ? null : tfile(hit);
			},
			fileToLinktext: (file: TFile, _sourcePath: string, omitMdExtension?: boolean) => {
				const unique = this.allPaths().filter((path) => fileName(path) === file.name).length <= 1;
				const text = unique ? file.name : file.path;
				return omitMdExtension === true && text.endsWith(".md") ? text.slice(0, -3) : text;
			},
		};

		const workspace = {
			getActiveFile: () => this.visible ?? this.lastActive,
			getActiveViewOfType: () => (this.visible === null ? null : { file: this.visible }),
			getLeaf: () => ({
				openFile: async (file: TFile) => {
					this.opened.push(file.path);
					this.visible = file;
					this.lastActive = file;
				},
			}),
		};

		const fileManager = {
			/** Attachments land at the vault root, Obsidian's default. */
			getAvailablePathForAttachment: async (name: string) => this.freePath(name),
			trashFile: async (file: TFile) => {
				this.notes.delete(file.path);
				this.images.delete(file.path);
			},
		};

		return { vault, metadataCache, workspace, fileManager } as unknown as App;
	}
}

export function settings(overrides: Partial<FilmTrackerSettings> = {}): () => FilmTrackerSettings {
	const value = { ...DEFAULT_SETTINGS, apiKey: "key", malClientId: "id", ...overrides };
	return () => value;
}

/** A TMDB client answering from fixtures, recording every request it gets. */
export function fakeTmdb(data: {
	films?: FilmMetadata[];
	people?: DirectorMetadata[];
	search?: (query: string, year: number | null) => FilmSearchResult[];
}): TmdbClient & { calls: string[] } {
	const calls: string[] = [];
	const client = {
		calls,
		getFilm: async (id: number) => {
			calls.push(`getFilm ${id}`);
			const film = data.films?.find((f) => f.tmdbId === id);
			if (film === undefined) throw new TmdbError("TMDB request failed (HTTP 404).");
			return film;
		},
		getPerson: async (id: number) => {
			calls.push(`getPerson ${id}`);
			const person = data.people?.find((p) => p.tmdbId === id);
			if (person === undefined) throw new TmdbError("TMDB request failed (HTTP 404).");
			return person;
		},
		search: async (query: string, year: number | null = null) => {
			calls.push(`search ${query} ${year ?? ""}`.trim());
			return data.search?.(query, year) ?? [];
		},
		downloadImage: async (path: string) => {
			calls.push(`download ${path}`);
			return new ArrayBuffer(4);
		},
	};
	return client as unknown as TmdbClient & { calls: string[] };
}

/** A MyAnimeList client answering from fixtures, recording every request it gets. */
export function fakeMal(data: {
	anime?: AnimeMetadata[];
	manga?: MangaMetadata[];
	people?: MangakaMetadata[];
}): MalClient & { calls: string[] } {
	const calls: string[] = [];
	const client = {
		calls,
		getAnime: async (id: number) => {
			calls.push(`getAnime ${id}`);
			const anime = data.anime?.find((a) => a.malId === id);
			if (anime === undefined) throw new MalError("MyAnimeList request failed (HTTP 404).");
			return anime;
		},
		getManga: async (id: number) => {
			calls.push(`getManga ${id}`);
			const manga = data.manga?.find((m) => m.malId === id);
			if (manga === undefined) throw new MalError("MyAnimeList request failed (HTTP 404).");
			return manga;
		},
		getPerson: async (id: number) => {
			calls.push(`getPerson ${id}`);
			const person = data.people?.find((p) => p.malId === id);
			if (person === undefined) throw new MalError("MyAnimeList request failed (HTTP 404).");
			return person;
		},
		downloadImage: async (url: string) => {
			calls.push(`download ${url}`);
			return new ArrayBuffer(4);
		},
	};
	return client as unknown as MalClient & { calls: string[] };
}

/**
 * The anime dialogs, answered in advance: every "Link to this note?" gets
 * `choice`, and every "Remove the manga?"-style question gets `answer`.
 */
export function fakeUi(choice: LinkChoice | null, answer: ConfirmAnswer = { option: false }) {
	const asked: { workTitle: string; side: string; noteName: string; alsoIn: string[] }[] = [];
	const confirmed: ConfirmRequest[] = [];
	const ui = {
		confirmLink: async (workTitle: string, side: "anime" | "manga", noteName: string, alsoIn: string[]) => {
			asked.push({ workTitle, side, noteName, alsoIn });
			return choice;
		},
		pickMangaka: (candidates: MangaAuthor[], onPick: (author: MangaAuthor) => void) => onPick(candidates[0]),
		confirm: async (request: ConfirmRequest) => {
			confirmed.push(request);
			return answer;
		},
	};
	return { ui, asked, confirmed };
}
