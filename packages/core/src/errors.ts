export type MemoryErrorCode =
  "NOT_FOUND" | "INVALID_INPUT" | "CONFIG" | "STORAGE" | "EMBEDDINGS" | "AMBIGUOUS" | "UNSUPPORTED";

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;
  readonly hint?: string;
  constructor(code: MemoryErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
    this.hint = hint;
  }
}

export class NotFoundError extends MemoryError {
  constructor(what: string, id: string) {
    super("NOT_FOUND", `${what} not found: ${id}`, "Use `aam list` to see available ids.");
    this.name = "NotFoundError";
  }
}

export class InvalidInputError extends MemoryError {
  constructor(message: string, hint?: string) {
    super("INVALID_INPUT", message, hint);
    this.name = "InvalidInputError";
  }
}
