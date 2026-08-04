export type Availability = "in_stock" | "out_of_stock";

export interface Book {
  id: string;
  isbn: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisher: string;
  publishedYear: number;
  language: string;
  categories: string[];
  tags: string[];
  format: string;
  pages: number;
  price: number;
  currency: "THB";
  rating: number;
  reviewCount: number;
  stock: number;
  availability: Availability;
  coverImageUrl: string;
  blurb: string[];
  createdAt: string;
  updatedAt: string;
}

export type MutableBookFields = Omit<Book, "id" | "availability" | "createdAt" | "updatedAt">;
export type BookPatch = Partial<MutableBookFields>;

export interface RepositoryPaths {
  dataPath: string;
  seedPath: string;
}

export const SORT_FIELDS = [
  "title", "publishedYear", "price", "rating", "reviewCount", "stock", "createdAt"
] as const;
export type SortField = typeof SORT_FIELDS[number];

export interface ListQuery {
  offset: number;
  limit: number;
  search?: string;
  nolimit?: boolean;
  category?: string;
  author?: string;
  publisher?: string;
  language?: string;
  format?: string;
  tags?: string[];
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  availableOnly?: boolean;
  publishedFrom?: number;
  publishedTo?: number;
  sortBy?: SortField;
  sortOrder?: "asc" | "desc";
}

export interface ListResult {
  items: Book[];
  meta: {
    total: number;
    offset: number;
    limit: number;
    returned: number;
    hasMore: boolean;
    nolimit: boolean;
  };
}

export interface SimilarBook {
  book: Book;
  score: number;
  reasons: string[];
}
