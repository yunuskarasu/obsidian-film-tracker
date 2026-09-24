import { MarkdownView, Notice, TFile, TFolder, getLinkpath, normalizePath, type App } from "obsidian";
import { MalError } from "./mal";
import {
	chooseNotePath,
	joinPath,
	parseFrontmatterBlocks,
	parseLinkTarget,
	type NotePathChoice,
	type PathOccupant,
} from "./note";
import { classifyNote, matchesRef, type NoteKind, type NoteRef } from "./note-kind";
import { TmdbError } from "./tmdb";

/** A note's top-level `poster`: a film's or an anime's, or a person's photo. */
export function topLevelPoster(frontmatter: Record<string, unknown>): unknown {
	return frontmatter.poster;
}

/** The manga side's own poster on a Series note, kept apart from the anime's. */
export function mangaPoster(frontmatter: Record<string, unknown>): unknown {
	const manga: unknown = frontmatter.manga;
	return typeof manga === "object" && manga !== null
		? (manga as Record<string, unknown>).poster
		: undefined;
}

/** A note path's file name without ".md" — what its poster is named after. */
export function noteName(notePath: string): string {
	return notePath.slice(notePath.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

/**
 * Runs one action of the plugin, turning a failure into a Notice: TMDB's or
 * MyAnimeList's own message for an API error, a pointer to the console for
 * anything unexpected. `what` completes "Could not …".
 */
export async function reportFailures(what: string, action: () => Promise<void>): Promise<void> {
	try {
		await action();
	} catch (error) {
		if (error instanceof TmdbError || error instanceof MalError) {
			new Notice(error.message);
			return;
		}
		console.error(`Film + Anime-Manga Tracker: could not ${what}`, error);
		new Notice(`Could not ${what}. See the console for details.`);
	}
}

/**
 * The plugin's view of the vault: which notes are its own and what each one
 * is, where a new note goes, and how frontmatter and images are written.
 * The film and anime actions reach the vault through here.
 */
export class VaultNotes {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	/** What the note is, read from its own properties — see `classifyNote` for why never from its folder. */
	kindOf(file: TFile): NoteKind | null {
		return classifyNote(this.frontmatterOf(file));
	}

	/**
	 * The MAL id of a note's manga side — what Add mangaka reads the authors
	 * from, and what the Read commands write across. A TV series note can
	 * carry one as well as a Series note can.
	 */
	mangaIdOf(file: TFile): number | null {
		const note = this.kindOf(file);
		return note?.kind === "series" || note?.kind === "tv" ? note.mangaMalId : null;
	}

	frontmatterOf(file: TFile): Record<string, unknown> | undefined {
		return this.app.metadataCache.getFileCache(file)?.frontmatter;
	}

	/**
	 * The note `ref` names, anywhere in the vault. Matching the note's kind as
	 * well as its id (see `matchesRef`) is what keeps a director and a film —
	 * or a mangaka and an anime — with numerically equal ids apart, so the
	 * lookup never has to be scoped to a folder, and a note the user moved or
	 * a folder setting changed later can't hide an existing note from it.
	 */
	findNote(ref: NoteRef): TFile | null {
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (matchesRef(this.kindOf(file), ref)) return file;
		}
		return null;
	}

	/** Every note `ref` names: an anime or a manga can sit on one Series note per adaptation. */
	findNotes(ref: NoteRef): TFile[] {
		return this.app.vault.getMarkdownFiles().filter((file) => matchesRef(this.kindOf(file), ref));
	}

	/** The other notes carrying this anime or this manga, for `sharedImage` and for keeping `watched`/`read` in step. */
	otherNotesWith(ref: NoteRef, file: TFile | null): TFile[] {
		return this.findNotes(ref).filter((note) => note.path !== file?.path);
	}

	/**
	 * The note Add anime or Add manga may link into: the one in the active
	 * editor tab, and only that. `getActiveFile` falls back to the last note
	 * used even while Graph view or a canvas has focus, which linked into a
	 * note that wasn't on screen.
	 */
	visibleNote(): TFile | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
	}

	/** Whether a note named `name` exists, seen from `sourcePath` — the test for writing a name as a link. */
	isResolved(sourcePath: string): (name: string) => boolean {
		return (name) => this.app.metadataCache.getFirstLinkpathDest(name, sourcePath) !== null;
	}

	/**
	 * Where a new note goes (see `chooseNotePath`), or `null` when the folder
	 * setting names a file and `ensureFolder` has already said so.
	 */
	async newNotePath(folder: string, names: string[]): Promise<NotePathChoice | null> {
		if (!(await this.ensureFolder(folder))) return null;
		return chooseNotePath(folder, names, (path) => this.pathOccupant(path));
	}

	private pathOccupant(path: string): PathOccupant {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing === null) return "free";
		return existing instanceof TFile && this.kindOf(existing) !== null ? "plugin" : "other";
	}

	/** A new note's name is held by a note the plugin didn't write (see `chooseNotePath`): show that note rather than write a second one beside it. */
	async openConflict(path: string): Promise<void> {
		new Notice(`A note already exists at ${path}`);
		const existing = this.app.vault.getFileByPath(path);
		if (existing !== null) await this.openNote(existing);
	}

	/**
	 * An image another note already uses for the same work — `poster` reads
	 * the property it's in. Linking a manga to a second adaptation, or filling
	 * a poster in on refresh, reuses that file instead of downloading a copy
	 * of it ("Hunter x Hunter (Manga) 1.jpg").
	 */
	sharedImage(notes: TFile[], poster: (frontmatter: Record<string, unknown>) => unknown): TFile | null {
		for (const note of notes) {
			const image = this.posterFile(note, poster);
			if (image !== null) return image;
		}
		return null;
	}

	/** The image a note's poster property — `poster` reads it — links to, if it exists. */
	private posterFile(note: TFile, poster: (frontmatter: Record<string, unknown>) => unknown): TFile | null {
		const frontmatter = this.frontmatterOf(note);
		const linkpath = frontmatter === undefined ? null : parseLinkTarget(poster(frontmatter));
		return linkpath === null ? null : this.app.metadataCache.getFirstLinkpathDest(linkpath, note.path);
	}

	/**
	 * The anime poster on `file` when nothing else uses it — what Remove
	 * anime offers to delete. Anything else means another note links or
	 * embeds it or has it as a poster, or `file` uses it anywhere but its
	 * own `poster` — the manga side included.
	 */
	unusedAnimePoster(file: TFile): TFile | null {
		return this.unusedPoster(file, topLevelPoster, mangaPoster, (link) => link.key !== "poster");
	}

	/**
	 * The manga poster on `file` when nothing else uses it — what Remove
	 * manga and Change manga offer to delete. Anything else means another
	 * note links or embeds it, has it as a poster (another adaptation sharing
	 * the file, say), or `file` uses it outside its `manga` block.
	 */
	unusedMangaPoster(file: TFile): TFile | null {
		return this.unusedPoster(
			file,
			mangaPoster,
			topLevelPoster,
			(link) => link.key !== "manga" && !link.key.startsWith("manga."),
		);
	}

	/**
	 * The image `poster` points at, when nothing else in the vault — and
	 * nothing else in this note — points at it too. `otherPoster` is the
	 * note's other side, which may well share the image; `ownLinkIsElsewhere`
	 * says which of this note's own frontmatter links count as another use:
	 * the property being removed is not one of them.
	 */
	private unusedPoster(
		file: TFile,
		poster: (frontmatter: Record<string, unknown>) => unknown,
		otherPoster: (frontmatter: Record<string, unknown>) => unknown,
		ownLinkIsElsewhere: (link: { key: string }) => boolean,
	): TFile | null {
		const image = this.posterFile(file, poster);
		if (image === null) return null;
		if (this.posterFile(file, otherPoster)?.path === image.path) return null;
		const { metadataCache } = this.app;
		const isImage = (candidate: TFile | null) => candidate?.path === image.path;

		for (const [source, targets] of Object.entries(metadataCache.resolvedLinks)) {
			if (source !== file.path && (targets[image.path] ?? 0) > 0) return null;
		}
		for (const note of this.app.vault.getMarkdownFiles()) {
			if (note.path === file.path) continue;
			if (isImage(this.posterFile(note, topLevelPoster)) || isImage(this.posterFile(note, mangaPoster))) {
				return null;
			}
		}

		const cache = metadataCache.getFileCache(file);
		const ownLinks = [
			...(cache?.links ?? []),
			...(cache?.embeds ?? []),
			...(cache?.frontmatterLinks ?? []).filter(ownLinkIsElsewhere),
		];
		return ownLinks.some((link) => isImage(metadataCache.getFirstLinkpathDest(getLinkpath(link.link), file.path)))
			? null
			: image;
	}

	/**
	 * Deletes a file the way Obsidian's "Deleted files" setting says, once
	 * the user has asked for it. The method for that, `FileManager.trashFile`,
	 * came in Obsidian 1.6.6; on older versions Obsidian's own delete prompt
	 * stands in, which follows the same setting but may ask once more —
	 * `false` when the user says no there.
	 */
	async deleteFile(file: TFile): Promise<boolean> {
		const fileManager: { trashFile?: (file: TFile) => Promise<void> } = this.app.fileManager;
		if (fileManager.trashFile === undefined) return this.app.fileManager.promptForDeletion(file);
		await fileManager.trashFile(file);
		return true;
	}

	/**
	 * The link a poster or photo property gets: always a `[[wikilink]]`.
	 * `generateMarkdownLink` follows the vault's "Use [[Wikilinks]]" setting,
	 * and with that turned off it writes a Markdown link that the poster
	 * layout could never read, so the image never showed.
	 */
	imageLink(image: TFile, sourcePath: string): string {
		return `[[${this.app.metadataCache.fileToLinktext(image, sourcePath, false)}]]`;
	}

	/**
	 * `vault.process` for a rewrite of a note's frontmatter. Every rewrite
	 * hands a note it can't parse back unchanged, so this is what tells "there
	 * was nothing to change" apart from "nothing could be read" — the second
	 * gets a Notice instead of a success message for a change never made.
	 */
	async rewriteFrontmatter(file: TFile, rewrite: (content: string) => string): Promise<boolean> {
		let readable = true;
		await this.app.vault.process(file, (content) => {
			if (parseFrontmatterBlocks(content) === null) {
				readable = false;
				return content;
			}
			return rewrite(content);
		});
		if (!readable) {
			new Notice(`Could not read the properties of ${file.basename}, so it was left unchanged.`);
		}
		return readable;
	}

	/**
	 * Downloads an image and saves it for the note at `notePath`: in `folder`
	 * when one is set, otherwise wherever the vault's attachment setting puts
	 * it. `null` when the download or the write fails — a note is never lost
	 * over its image. `what` names it in the console ("the poster").
	 */
	async saveImage(
		download: () => Promise<ArrayBuffer>,
		fileName: string,
		notePath: string,
		folder: string,
		what: string,
	): Promise<TFile | null> {
		try {
			const data = await download();
			const path = await this.resolveImagePath(fileName, notePath, folder);
			return await this.app.vault.createBinary(path, data);
		} catch (error) {
			console.error(`Film + Anime-Manga Tracker: could not save ${what}`, error);
			return null;
		}
	}

	private async resolveImagePath(fileName: string, notePath: string, folder: string): Promise<string> {
		if (folder === "" || !(await this.ensureFolder(folder))) {
			return this.app.fileManager.getAvailablePathForAttachment(fileName, notePath);
		}
		return this.availablePath(joinPath(folder, fileName));
	}

	/** `path` if it's free, otherwise the first free "name 1.ext", "name 2.ext", … */
	availablePath(path: string): string {
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		const dot = path.lastIndexOf(".");
		const base = dot === -1 ? path : path.slice(0, dot);
		const extension = dot === -1 ? "" : path.slice(dot);
		let index = 1;
		while (this.app.vault.getAbstractFileByPath(`${base} ${index}${extension}`)) {
			index += 1;
		}
		return `${base} ${index}${extension}`;
	}

	async ensureFolder(folder: string): Promise<boolean> {
		const path = normalizePath(folder.trim());
		if (path === "" || path === "/") return true;

		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return true;
		if (existing) {
			new Notice(`"${path}" is a file, not a folder. Check your Film + Anime-Manga Tracker settings.`);
			return false;
		}

		await this.app.vault.createFolder(path);
		return true;
	}

	async openNote(file: TFile): Promise<void> {
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}
