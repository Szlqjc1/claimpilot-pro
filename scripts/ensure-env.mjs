// Creates .env from .env.example on first install so a clean clone boots in mock mode.
import { copyFileSync, existsSync } from "node:fs";

if (!existsSync(".env") && existsSync(".env.example")) {
  copyFileSync(".env.example", ".env");
  console.log("[ensure-env] Created .env from .env.example (AI_MODE=mock).");
}
