import { readdir } from "fs/promises";
import { join } from "node:path";
import config from "./config/config.ts";

export const LATEST_MODEL_VERSION = "2026.05.08";
export const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
export const adminLevels = ["0", "1", "2"];

export const globalBounds = {
  "bounds": {
    "min": {
      "lng": -70.0635,
      "lat": 12.4124
    },
    "max": {
      "lng": -69.8654,
      "lat": 12.624
    }
  }
};


const staveFiles = await readdir(join(config.dataDir, "stave"), { withFileTypes: true });
export const dataVersions = staveFiles
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

const modelFiles = await readdir(join(config.dataDir, "model"), { withFileTypes: true });
export const modelVersions = modelFiles
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);
