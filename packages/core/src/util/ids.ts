import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toDate(value: Date | string | number | null | undefined): Date | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function clamp01(n: number | undefined, fallback: number): number {
  if (n === undefined || n === null || Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}
