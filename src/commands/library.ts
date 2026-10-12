import { Platform, type Plugin } from "obsidian";
import { libraryItemsOf, type LibraryItem } from "../library";
import { LIBRARY_VIEW, LibraryView, type LibrarySource } from "../library-view";
import { parseLinkTarget } from "../note";
import type { Services } from "../services";

/** The library: a view of its own, and the command that opens it. */
export class LibraryCommands {
	constructor(
		private readonly services: Services,
		/** Where the size of the covers is kept. */
		private readonly saveSettings: () => Promise<void>,
	) {}

	/** The library's own kind of tab. */
	registerView(plugin: Plugin): void {
		plugin.registerView(LIBRARY_VIEW, (leaf) => new LibraryView(leaf, this.source()));
	}

	register(plugin: Plugin): void {
		plugin.addCommand({
			id: "open-library",
			name: "Open the library",
			callback: () => void this.openLibrary(),
		});
	}

	/** The library in a tab of its own: the one already open, if there is one. */
	async openLibrary(): Promise<void> {
		const { workspace } = this.services.app;
		const open = workspace.getLeavesOfType(LIBRARY_VIEW)[0];
		const leaf = open ?? workspace.getLeaf("tab");
		if (open === undefined) await leaf.setViewState({ type: LIBRARY_VIEW, active: true });
		workspace.setActiveLeaf(leaf, { focus: true });
	}

	/** What the library reads: every note's works, and the covers they show. */
	private source(): LibrarySource {
		const { app, notes } = this.services;
		return {
			items: () =>
				app.vault.getMarkdownFiles().flatMap((file): LibraryItem[] => {
					const kind = notes.kindOf(file);
					const frontmatter = notes.frontmatterOf(file);
					return kind === null || frontmatter === undefined ? [] : libraryItemsOf(file.path, file.basename, kind, frontmatter, file.stat.ctime);
				}),
			imageUrl: (item) => {
				const linkpath = parseLinkTarget(item.poster);
				const image = linkpath === null ? null : app.metadataCache.getFirstLinkpathDest(linkpath, item.path);
				return image === null ? null : app.vault.getResourcePath(image);
			},
			// A phone keeps its own size: one picked there never changes a computer's, or a tablet's.
			size: () => (Platform.isPhone ? this.services.settings.libraryPhoneSize : this.services.settings.librarySize),
			setSize: (size) => {
				if (Platform.isPhone) this.services.settings.libraryPhoneSize = size;
				else this.services.settings.librarySize = size;
				void this.saveSettings();
			},
		};
	}
}
