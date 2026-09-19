import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { isMissingHere, keychainOf, moveKeysToKeychain, readKey, type Keychain } from "../src/secrets";
import { DEFAULT_SETTINGS, type FilmTrackerSettings } from "../src/settings";

/** An in-memory keychain; `broken` makes every write fail the way a locked OS keychain would. */
function fakeKeychain(secrets: Record<string, string> = {}, broken = false): Keychain & { secrets: Map<string, string> } {
	const store = new Map(Object.entries(secrets));
	return {
		secrets: store,
		getSecret: (id) => store.get(id) ?? null,
		setSecret: (id, secret) => {
			if (broken) throw new Error("Keychain unavailable");
			store.set(id, secret);
		},
	};
}

function settings(overrides: Partial<FilmTrackerSettings>): FilmTrackerSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("keychainOf", () => {
	/**
	 * Regression: this trusted the version alone. Anything that reports 1.11.4
	 * without carrying the keychain — a platform Obsidian hasn't brought it to
	 * yet — handed back `undefined`, which every caller then read as "there is
	 * a keychain", and each command died on `getSecret`.
	 */
	it("takes a keychain only when it is really there", () => {
		expect(keychainOf({} as App)).toBeNull();
		expect(keychainOf({ secretStorage: {} } as unknown as App)).toBeNull();
		expect(keychainOf({ secretStorage: { getSecret: () => null } } as unknown as App)).toBeNull();
		const real = fakeKeychain();
		expect(keychainOf({ secretStorage: real } as unknown as App)).toBe(real);
	});
});

describe("moveKeysToKeychain", () => {
	it("moves typed-in keys into the keychain and out of the settings", () => {
		const keychain = fakeKeychain();
		const current = settings({ apiKey: "tmdb-key", malClientId: "mal-id" });

		expect(moveKeysToKeychain(keychain, current)).toBe(true);
		expect(current).toMatchObject({
			apiKey: "",
			apiKeySecretName: "film-tracker-tmdb-api-key",
			malClientId: "",
			malClientIdSecretName: "film-tracker-mal-client-id",
		});
		expect(keychain.secrets.get("film-tracker-tmdb-api-key")).toBe("tmdb-key");
		expect(keychain.secrets.get("film-tracker-mal-client-id")).toBe("mal-id");
	});

	it("never writes over another secret that has the name, and reuses one that holds the same key", () => {
		const keychain = fakeKeychain({ "film-tracker-tmdb-api-key": "someone else's", "film-tracker-mal-client-id": "mal-id" });
		const current = settings({ apiKey: "tmdb-key", malClientId: "mal-id" });
		moveKeysToKeychain(keychain, current);

		expect(current.apiKeySecretName).toBe("film-tracker-tmdb-api-key-2");
		expect(keychain.secrets.get("film-tracker-tmdb-api-key")).toBe("someone else's");
		expect(keychain.secrets.get("film-tracker-tmdb-api-key-2")).toBe("tmdb-key");
		expect(current.malClientIdSecretName).toBe("film-tracker-mal-client-id");
	});

	/** A vault synced with a device still on an older Obsidian: that device reads the typed-in key. */
	it("leaves a typed-in key alone once its secret has a name", () => {
		const keychain = fakeKeychain({ "film-tracker-tmdb-api-key": "tmdb-key" });
		const current = settings({ apiKey: "typed on the old device", apiKeySecretName: "film-tracker-tmdb-api-key" });

		expect(moveKeysToKeychain(keychain, current)).toBe(false);
		expect(current.apiKey).toBe("typed on the old device");
		expect(keychain.secrets.get("film-tracker-tmdb-api-key")).toBe("tmdb-key");
	});

	it("keeps a key where it was when the keychain can't take it, and says why in the console", () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const current = settings({ apiKey: "tmdb-key" });
		expect(moveKeysToKeychain(fakeKeychain({}, true), current)).toBe(false);
		expect(current).toMatchObject({ apiKey: "tmdb-key", apiKeySecretName: "" });
		expect(logged).toHaveBeenCalledOnce();
		logged.mockRestore();
	});

	it("keeps a key where it was when the keychain doesn't give it back", () => {
		const forgetful: Keychain = { getSecret: () => null, setSecret: () => undefined };
		const current = settings({ apiKey: "tmdb-key" });
		expect(moveKeysToKeychain(forgetful, current)).toBe(false);
		expect(current).toMatchObject({ apiKey: "tmdb-key", apiKeySecretName: "" });
	});

	it("has nothing to do without typed-in keys", () => {
		expect(moveKeysToKeychain(fakeKeychain(), settings({}))).toBe(false);
	});
});

describe("readKey", () => {
	it("reads the keychain's secret when this device has it", () => {
		const keychain = fakeKeychain({ "film-tracker-tmdb-api-key": " tmdb-key " });
		expect(readKey(keychain, settings({ apiKeySecretName: "film-tracker-tmdb-api-key" }), "tmdb")).toBe("tmdb-key");
	});

	it("reads the typed-in key before Obsidian 1.11.4, or when this device lacks the secret", () => {
		expect(readKey(null, settings({ malClientId: "mal-id" }), "mal")).toBe("mal-id");
		const elsewhere = settings({ apiKey: "typed on the old device", apiKeySecretName: "film-tracker-tmdb-api-key" });
		expect(readKey(fakeKeychain(), elsewhere, "tmdb")).toBe("typed on the old device");
	});

	it("is empty when there is no key at all", () => {
		expect(readKey(fakeKeychain(), settings({}), "tmdb")).toBe("");
	});
});

describe("isMissingHere", () => {
	it("tells a secret set up on another device from a key never set", () => {
		const named = settings({ apiKeySecretName: "film-tracker-tmdb-api-key" });
		expect(isMissingHere(fakeKeychain(), named, "tmdb")).toBe(true);
		expect(isMissingHere(fakeKeychain({ "film-tracker-tmdb-api-key": "tmdb-key" }), named, "tmdb")).toBe(false);
		expect(isMissingHere(fakeKeychain(), settings({}), "tmdb")).toBe(false);
		expect(isMissingHere(null, named, "tmdb")).toBe(false);
	});
});
