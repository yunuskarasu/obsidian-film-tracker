import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// Only the recorders, which save real answers for the replayed tests: run one
// at a time, by naming its file. tests/igdb-record.test.mts needs
// IGDB_CLIENT_ID and IGDB_CLIENT_SECRET set; tests/openlibrary-record.test.mts
// needs nothing.
export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL("./tests/obsidian-stub.ts", import.meta.url)),
		},
	},
	test: {
		include: ["tests/igdb-record.test.mts", "tests/openlibrary-record.test.mts"],
	},
});
