import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
