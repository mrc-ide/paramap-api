// A setup script to run before starting the app.
// Sends a request to grout to get the bounding boxes for admin0 regions.
// TODO: use dedicated paramap dataset rather than gadm41?

import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

const groutMetadataUrl = "https://mrcdata.dide.ic.ac.uk/grout/region-metadata/gadm41/admin0";
const outputPath = resolve(process.cwd(), "data/admin0-region-metadata.json");

const response = await fetch(groutMetadataUrl);
if (!response.ok) {
  throw new Error(`Failed to fetch admin0 metadata (${response.status} ${response.statusText})`);
}

const responseJson = await response.json();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(responseJson.data, null, 2)}\n`, "utf-8");
console.log(`Wrote ${responseJson.data.length} admin0 metadata rows to ${outputPath}`);
