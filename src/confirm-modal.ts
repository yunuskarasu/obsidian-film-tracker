import { App, Modal, Setting, type ButtonComponent } from "obsidian";

/** A question for `ConfirmModal`. */
export interface ConfirmRequest {
	title: string;
	message: string;
	/** The button that goes ahead, shown as a warning since it deletes something. */
	confirmLabel: string;
	/** The button that doesn't: "Cancel" unless given. */
	cancelLabel?: string;
	/** An extra yes/no shown as a toggle, off to start with. */
	option?: { name: string; desc: string };
}

/** `null` for Cancel or a dismissed dialog; otherwise whether the extra toggle was on. */
export type ConfirmAnswer = { option: boolean } | null;

/**
 * Shows a button as one that deletes something. `setDestructive` took over
 * from `setWarning` in Obsidian 1.13, and versions before it have only
 * `setWarning`; the plugin still supports 1.5.7.
 */
function markDestructive(button: ButtonComponent): ButtonComponent {
	const versions: { setDestructive?: () => unknown; setWarning: () => unknown } = button;
	if (versions.setDestructive !== undefined) versions.setDestructive();
	else versions.setWarning();
	return button;
}

/**
 * Asks before the plugin deletes anything: Remove manga, or a poster no note
 * uses any more. Closing the dialog counts as Cancel.
 */
export class ConfirmModal extends Modal {
	private readonly request: ConfirmRequest;
	private readonly onAnswer: (answer: ConfirmAnswer) => void;
	private answer: ConfirmAnswer = null;
	private option = false;

	constructor(app: App, request: ConfirmRequest, onAnswer: (answer: ConfirmAnswer) => void) {
		super(app);
		this.request = request;
		this.onAnswer = onAnswer;
	}

	onOpen(): void {
		const { contentEl } = this;
		const { title, message, confirmLabel, cancelLabel, option } = this.request;
		contentEl.createEl("h2", { text: title });
		contentEl.createEl("p", { text: message });

		if (option !== undefined) {
			new Setting(contentEl)
				.setName(option.name)
				.setDesc(option.desc)
				.addToggle((toggle) =>
					toggle.setValue(false).onChange((value) => {
						this.option = value;
					}),
				);
		}

		new Setting(contentEl)
			.addButton((button) => button.setButtonText(cancelLabel ?? "Cancel").onClick(() => this.close()))
			.addButton((button) =>
				markDestructive(button.setButtonText(confirmLabel)).onClick(() => {
					this.answer = { option: this.option };
					this.close();
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		this.onAnswer(this.answer);
	}
}
