export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Optional stdin contents (used by `ingest` / `import -`). */
  stdin?: () => Promise<string>;
}

export function defaultIO(): CliIO {
  return {
    stdout: (t) => process.stdout.write(t + "\n"),
    stderr: (t) => process.stderr.write(t + "\n"),
    cwd: process.cwd(),
    env: process.env,
    stdin: async () => {
      if (process.stdin.isTTY) return "";
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(Buffer.from(c));
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}
