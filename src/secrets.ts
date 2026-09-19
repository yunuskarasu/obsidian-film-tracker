import { requireApiVersion, type App } from "obsidian";
import type { FilmTrackerSettings } from "./settings";

/** What the plugin uses of Obsidian's keychain, `App.secretStorage`. */
export interface Keychain {
	getSecret(id: string): string | null;
	setSecret(id: string, secret: string): void;
}

/**
 * Obsidian's keychain, which came in 1.11.4. `null` on earlier versions, and
 * on anything that reports the version without carrying the keychain itself —
 * the version alone is not enough to go on — where the keys stay in the
 * plugin's settings as they always have.
 */
export function keychainOf(app: App): Keychain | null {
	const keychain: Keychain | undefined = requireApiVersion("1.11.4") ? app.secretStorage : undefined;
	const works = typeof keychain?.getSecret === "function" && typeof keychain.setSecret === "function";
	return works && keychain !== undefined ? keychain : null;
}

export type ApiKey = "tmdb" | "mal";

/**
 * Where each key sits in the settings: typed in (`plain`, which ends up in
 * data.json), or as the name of the keychain secret that holds it. `id` is
 * the name the plugin gives a secret when it moves a typed-in key there.
 */
const FIELDS = {
	tmdb: { plain: "apiKey", secretName: "apiKeySecretName", id: "film-tracker-tmdb-api-key" },
	mal: { plain: "malClientId", secretName: "malClientIdSecretName", id: "film-tracker-mal-client-id" },
} as const;

/**
 * The key itself: the keychain's secret when this device has it, otherwise
 * the typed-in one — where a key lives before Obsidian 1.11.4, and where a
 * device still on such a version keeps it in a synced vault.
 */
export function readKey(keychain: Keychain | null, settings: FilmTrackerSettings, key: ApiKey): string {
	const fields = FIELDS[key];
	const name = settings[fields.secretName];
	const secret = keychain !== null && name !== "" ? keychain.getSecret(name) : null;
	return secret?.trim() || settings[fields.plain];
}

/**
 * Whether the key names a keychain secret this device doesn't have. The
 * keychain is kept per device and never syncs, so this is a vault the key
 * was set up in on another device.
 */
export function isMissingHere(keychain: Keychain | null, settings: FilmTrackerSettings, key: ApiKey): boolean {
	const name = settings[FIELDS[key].secretName];
	return keychain !== null && name !== "" && !keychain.getSecret(name)?.trim();
}

/**
 * Moves the typed-in keys into the keychain, keeping them out of data.json,
 * which syncs and is backed up with the vault. Each secret is written and
 * read back before its typed-in copy is cleared, so on any failure a key
 * simply stays where it was. A key whose secret already has a name is left
 * alone: a typed-in copy turning up later was entered on a device still on
 * an older Obsidian, which needs it where it is.
 *
 * Changes `settings` in place; `true` when there is something to save.
 */
export function moveKeysToKeychain(keychain: Keychain, settings: FilmTrackerSettings): boolean {
	let moved = false;
	for (const fields of Object.values(FIELDS)) {
		const plain = settings[fields.plain];
		if (plain === "" || settings[fields.secretName] !== "") continue;
		try {
			const name = freeName(keychain, fields.id, plain);
			keychain.setSecret(name, plain);
			if (keychain.getSecret(name) !== plain) continue;
			settings[fields.secretName] = name;
			settings[fields.plain] = "";
			moved = true;
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: could not move a key into Obsidian's keychain.", error);
		}
	}
	return moved;
}

/** `id`, or `id-2`, `id-3`…: never a name that already holds some other secret. */
function freeName(keychain: Keychain, id: string, value: string): string {
	for (let n = 1; n <= 100; n++) {
		const name = n === 1 ? id : `${id}-${n}`;
		const existing = keychain.getSecret(name);
		if (existing === null || existing === value) return name;
	}
	throw new Error(`No free keychain name for ${id}.`);
}
