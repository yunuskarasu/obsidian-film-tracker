import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// Only the IGDB recorder, tests/igdb-record.test.mts, which saves real answers
// for the replayed tests. It needs IGDB_CLIENT_ID and IGDB_CLIENT_SECRET set.
export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL("./tests/obsidian-stub.ts", import.meta.url)),
		},
	},
	test: {
		include: ["tests/igdb-record.test.mts"],
	},
});
