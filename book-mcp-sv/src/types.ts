export interface Book {
  id: string;
  isbn: string;
  title: string;
  subtitle?: string | undefined;
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
  availability: string;
  coverImageUrl: string;
  blurb: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BookListResponse {
  items: Book[];
  meta: {
    total: number;
    offset: number;
    limit: number;
    returned: number;
    hasMore: boolean;
    nolimit: false;
  };
}

export interface SimilarBook {
  book: Book;
  score: number;
  reasons: string[];
}

export interface SimilarBooksResponse {
  source: Book;
  items: SimilarBook[];
}

export interface CatalogStatistics {
  totalBooks: number;
  totalStock: number;
  availableBooks: number;
  outOfStockBooks: number;
  price: { min: number | null; max: number | null; average: number | null };
  categories: Record<string, number>;
  languages: Record<string, number>;
}

export interface BookWriteInput {
  isbn: string;
  title: string;
  subtitle?: string | undefined;
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
  coverImageUrl: string;
  blurb: string[];
}

export type BookChanges = {
  [Key in keyof BookWriteInput]?: BookWriteInput[Key] | undefined;
};

export interface SearchBooksQuery {
  search: string;
  offset?: number;
  limit?: number;
  category?: string;
  author?: string;
  publisher?: string;
  language?: string;
  format?: string;
  tags?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  availableOnly?: boolean;
  publishedFrom?: number;
  publishedTo?: number;
  sortBy?: "title" | "publishedYear" | "price" | "rating" | "reviewCount" | "stock" | "createdAt";
  sortOrder?: "asc" | "desc";
}
