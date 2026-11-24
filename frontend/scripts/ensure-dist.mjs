import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../../backend/web/dist", import.meta.url));
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, ".gitkeep"), "\n");
