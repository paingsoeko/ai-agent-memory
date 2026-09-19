export function timeAgo(iso: string | Date | undefined): string {
  if (!iso) return "—";
  const t = +new Date(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return h === 1 ? "1 hr ago" : `${h} hrs ago`;
  }
  const d = Math.floor(s / 86400);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return formatDate(iso);
}

export function formatDate(iso: string | Date | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string | Date | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBytes(n: number | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function pct(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

export function importanceLabel(n: number): string {
  if (n >= 0.75) return "High";
  if (n >= 0.5) return "Medium";
  return "Low";
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function highlight(content: string, terms: string[] | undefined): { __html: string } | null {
  if (!terms || terms.length === 0) return null;
  let out = escapeHtml(content);
  for (const t of terms) {
    if (!t) continue;
    const re = new RegExp(`(${escapeReg(t)})`, "gi");
    out = out.replace(re, "<mark>$1</mark>");
  }
  return { __html: out };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
