import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync("backups", { recursive: true });
const db = new DatabaseSync(resolve(process.env.DB_PATH || "data/shop.sqlite"));
const target = resolve(
  "backups",
  `shop-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
await backup(db, target);
db.close();
console.log(`Database backup created: ${target}`);
