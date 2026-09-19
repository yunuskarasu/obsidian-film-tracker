import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// Written the way both files are kept in the repo — two-space indent and a
// final newline — so a version bump changes only the version lines.
const format = (value) => `${JSON.stringify(value, null, 2)}\n`;

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", format(manifest));

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", format(versions));
