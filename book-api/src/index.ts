import { join } from "node:path";
import { createApp } from "./app";
import { BookRepository } from "./repository";

const dataDirectory = join(import.meta.dir, "..", "data");
const repository = await BookRepository.load({
  dataPath: process.env.BOOK_DATA_PATH ?? join(dataDirectory, "books.json"),
  seedPath: process.env.BOOK_SEED_PATH ?? join(dataDirectory, "books.seed.json")
});

const hostname = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer from 1 through 65535");

createApp(repository).listen({ hostname, port });
console.log(`Book API listening on http://${hostname}:${port}`);
