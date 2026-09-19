import { createMemory, type CreateMemoryOptions, type MemoryEngine } from "../src/index.js";

export async function mem(options: CreateMemoryOptions = {}): Promise<MemoryEngine> {
  return createMemory({ path: ":memory:", skipConfigFiles: true, ...options });
}
