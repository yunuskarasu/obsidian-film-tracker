import type { Plugin } from "obsidian";
import { diaryEntriesOf, type DiaryEntry } from "../diary";
import { DIARY_VIEW, DiaryView, type DiarySource } from "../diary-view";
import { parseLinkTarget } from "../note";
import type { Services } from "../services";

/** The diary: a view of its own, and the command that opens it. */
export class DiaryCommands {
	constructor(private readonly services: Services) {}

	/** The diary's own kind of tab. */
	registerView(plugin: Plugin): void {
		plugin.registerView(DIARY_VIEW, (leaf) => new DiaryView(leaf, this.source()));
	}

	register(plugin: Plugin): void {
		plugin.addCommand({
			id: "open-diary",
			name: "Open diary",
			callback: () => void this.openDiary(),
		});
	}

	/** The diary in a tab of its own: the one already open, if there is one. */
	async openDiary(): Promise<void> {
		const { workspace } = this.services.app;
		const open = workspace.getLeavesOfType(DIARY_VIEW)[0];
		const leaf = open ?? workspace.getLeaf("tab");
		if (open === undefined) await leaf.setViewState({ type: DIARY_VIEW, active: true });
		workspace.setActiveLeaf(leaf, { focus: true });
	}

	/** What the diary reads: every note's days of finishing, and the covers they show. */
	private source(): DiarySource {
		const { app, notes } = this.services;
		return {
			entries: () =>
				app.vault.getMarkdownFiles().flatMap((file): DiaryEntry[] => {
					const kind = notes.kindOf(file);
					const frontmatter = notes.frontmatterOf(file);
					return kind === null || frontmatter === undefined ? [] : diaryEntriesOf(file.path, file.basename, kind, frontmatter);
				}),
			imageUrl: (entry) => {
				const linkpath = parseLinkTarget(entry.poster);
				const image = linkpath === null ? null : app.metadataCache.getFirstLinkpathDest(linkpath, entry.path);
				return image === null ? null : app.vault.getResourcePath(image);
			},
		};
	}
}
