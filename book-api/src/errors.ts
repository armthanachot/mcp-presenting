export type ErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: string[] = []
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const validationError = (details: string[], message = "Request validation failed") =>
  new ApiError(400, "VALIDATION_ERROR", message, details);

export const errorBody = (error: ApiError) => ({
  error: { code: error.code, message: error.message, details: error.details }
});
