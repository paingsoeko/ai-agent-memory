/**
 * Thin loader for `node:sqlite` that silences the ExperimentalWarning emitted
 * by Node 22 when the module is first loaded. Nothing else is touched.
 */
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

export type SqliteDatabase = DatabaseSyncType;

let ctor: typeof DatabaseSyncType | undefined;

export async function loadSqlite(): Promise<typeof DatabaseSyncType> {
  if (ctor) return ctor;
  const original = process.emitWarning;
  const filtered: typeof process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : ((warning as Error)?.message ?? "");
    const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string })?.type;
    if (
      (type === "ExperimentalWarning" || /ExperimentalWarning/.test(String(type))) &&
      /SQLite/i.test(text)
    ) {
      return;
    }
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  process.emitWarning = filtered;
  try {
    const mod = await import("node:sqlite");
    ctor = mod.DatabaseSync;
  } catch (err) {
    throw new Error(
      `node:sqlite is not available (${(err as Error).message}). @ai-memory requires Node.js >= 22.13 (or 24+).`,
    );
  } finally {
    process.emitWarning = original;
  }
  return ctor;
}
