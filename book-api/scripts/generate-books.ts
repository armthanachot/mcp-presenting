import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Book } from "../src/types";
import { validateCatalog } from "../src/validation";

const categories = ["Technology", "Business", "Finance", "Science", "History", "Fiction", "Self Development", "Design", "Leadership", "Data"];
const topics = ["Artificial Intelligence", "Cloud Architecture", "Personal Finance", "Modern Leadership", "Data Analytics", "Product Design", "World History", "Sustainable Business", "Creative Thinking", "Software Engineering"];
const adjectives = ["Practical", "Essential", "Modern", "Complete", "Focused", "Applied", "Accessible", "Strategic", "Thoughtful", "Definitive"];
const firstNames = ["Ananda", "Maya", "Narin", "Sophia", "Kiet", "Emma", "Pim", "Noah", "Arun", "Lina"];
const lastNames = ["Morgan", "Sukhum", "Chen", "Williams", "Patel", "Tan", "Rivera", "Khan", "Silva", "Martin"];
const publishers = ["Riverstone Press", "Northstar Books", "Siam Knowledge", "Blue Oak Publishing", "Open Shelf", "Vertex House", "Lantern Media", "Horizon Works"];
const languages = ["en", "th", "de", "fr", "ja"];
const formats = ["paperback", "hardcover", "ebook", "audiobook"];

export const createSyntheticBooks = (count = 10_000): Book[] => Array.from({ length: count }, (_, offset) => {
  const index = offset + 1;
  const topic = topics[offset % topics.length]!;
  const category = categories[offset % categories.length]!;
  const secondaryCategory = categories[(offset + 3) % categories.length]!;
  const author = `${firstNames[offset % firstNames.length]} ${lastNames[Math.floor(offset / firstNames.length) % lastNames.length]}`;
  const coAuthor = `${firstNames[(offset + 4) % firstNames.length]} ${lastNames[(offset + 7) % lastNames.length]}`;
  const timestamp = new Date(Date.UTC(2020 + (offset % 6), offset % 12, (offset % 27) + 1)).toISOString();
  const stock = offset % 13 === 0 ? 0 : (offset * 7) % 51;
  return {
    id: `book-${String(index).padStart(6, "0")}`,
    isbn: `978616${String(index).padStart(7, "0")}`,
    title: `${adjectives[offset % adjectives.length]} ${topic} ${index}`,
    ...(offset % 4 === 0 ? { subtitle: `A guided journey from foundations to real-world practice` } : {}),
    authors: offset % 5 === 0 ? [author, coAuthor] : [author],
    publisher: publishers[offset % publishers.length]!,
    publishedYear: 2000 + (offset % 27),
    language: languages[offset % languages.length]!,
    categories: category === secondaryCategory ? [category] : [category, secondaryCategory],
    tags: [topic.toLocaleLowerCase().replaceAll(" ", "-"), offset % 3 === 0 ? "beginner" : "intermediate", `topic-${offset % 25}`],
    format: formats[offset % formats.length]!,
    pages: 120 + (offset * 17) % 781,
    price: 150 + (offset * 37) % 1_851,
    currency: "THB",
    rating: Number((2.5 + (offset % 26) / 10).toFixed(1)),
    reviewCount: (offset * 97) % 50_001,
    stock,
    availability: stock > 0 ? "in_stock" : "out_of_stock",
    coverImageUrl: `https://example.com/book-covers/${String(index).padStart(6, "0")}.jpg`,
    blurb: [
      `Explore ${topic.toLocaleLowerCase()} through a clear and approachable narrative designed for curious readers.`,
      `The book connects essential principles with concrete situations drawn from contemporary professional practice.`,
      `Each chapter builds deliberately on the last so readers can move from foundational ideas toward confident application.`,
      `Useful examples and reflective questions make the material suitable for both independent study and team discussion.`,
      `Readers will discover practical ways to evaluate trade-offs, communicate decisions, and avoid common mistakes.`,
      `By the final chapter, the ideas come together as a durable framework that can be adapted to new challenges.`
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  };
});

const books = validateCatalog(createSyntheticBooks());
const dataDirectory = join(import.meta.dir, "..", "data");
await mkdir(dataDirectory, { recursive: true });
const serialized = JSON.stringify(books);
await Promise.all([
  writeFile(join(dataDirectory, "books.seed.json"), serialized),
  writeFile(join(dataDirectory, "books.json"), serialized)
]);
console.log(`Generated ${books.length} deterministic books in ${dataDirectory}`);
