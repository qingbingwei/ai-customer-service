import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export const config = {
  port: Number(process.env.PORT || 3000),
  rootDir,
  publicDir: path.join(rootDir, "public"),
  docsDir: path.join(rootDir, "docs"),
  dataFile: process.env.DATA_FILE || path.join(rootDir, "data", "app-data.json"),
  defaultUserId: process.env.DEFAULT_USER_ID || "1"
};
