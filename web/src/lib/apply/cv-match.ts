// Which output/ PDFs belong to a company. One rule for the apply flow (which ATTACHES the file to a
// real application) and for /api/cv-pdf (which shows it), so they always resolve the same file.
//
// The company slug must sit at a token boundary ("meta" matches cv-candidate-meta-2026.pdf, never
// cv-candidate-metabase-2026.pdf), and cover letters are never returned: we would rather attach
// nothing than the wrong document.

export function matchCvFiles(files: string[], company: string): string[] {
  const slug = (company.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  if (!slug) return [];
  const re = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
  return files.filter((f) => {
    const l = f.toLowerCase();
    if (!l.endsWith(".pdf")) return false;
    if (/(^|[^a-z0-9])cover([^a-z0-9]|$)/.test(l)) return false;
    return re.test(l);
  });
}
