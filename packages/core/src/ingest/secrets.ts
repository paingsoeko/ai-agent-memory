/** Patterns that indicate credentials or secrets. Such text is never extracted into memory. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/, // OpenAI-style keys
  /\bsk-ant-[A-Za-z0-9_-]{16,}/, // Anthropic keys
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key
  /\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}/, // GitHub tokens
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?[^\s'"]{6,}/i,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/, // long base64 blobs
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN-like
  /\b(?:\d[ -]*?){13,19}\b/, // card-number-like
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}
