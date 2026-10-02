const safeGitHubClickDirective =
  /^\s*click\s+[a-z_][a-z0-9_-]*\s+"https:\/\/github\.com\/[^"\s]+"\s*$/iu;

// Mermaid's lexer tokenizes `click` followed by ANY whitespace run (tab, or
// even a newline — making a bare "click" line continue onto the next line), so
// detection must not assume the single-space form the compiler emits.
const clickDirectiveStart = /^click(\s|$)/u;

export function sanitizeMermaidSourceForRender(source: string): string {
  const lines: string[] = [];
  let insideConfigDirective = false;

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (insideConfigDirective) {
      insideConfigDirective = !trimmed.includes("}%%");
      continue;
    }
    if (trimmed.startsWith("%%{")) {
      insideConfigDirective = !trimmed.includes("}%%");
      continue;
    }
    if (
      clickDirectiveStart.test(trimmed) &&
      !safeGitHubClickDirective.test(line)
    ) {
      continue;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

const leftoverNumericEntity = /&#(?:(\d{1,7})|x([0-9a-f]{1,6}));/giu;

/**
 * The compiler escapes label punctuation as entity codes, and with
 * htmlLabels off Mermaid leaves some of them as literal text (subgraph
 * titles show "Model Inference &#40;LLAMA&#41;"). Decodes those in the SVG's
 * text nodes. Only text node values change, never markup, so a decoded "<"
 * stays text.
 */
export function decodeLeftoverLabelEntities(root: Node): void {
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue;
    if (!text?.includes("&#")) continue;
    node.nodeValue = text.replace(
      leftoverNumericEntity,
      (entity, decimal: string | undefined, hex: string | undefined) => {
        const codePoint = decimal ? Number(decimal) : Number.parseInt(hex!, 16);
        const printable =
          codePoint >= 0x20 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff);
        return printable ? String.fromCodePoint(codePoint) : entity;
      },
    );
  }
}

export function enforceSafeMermaidLinks(root: ParentNode): void {
  for (const anchor of root.querySelectorAll("a")) {
    const rawHref =
      anchor.getAttribute("href") ?? anchor.getAttribute("xlink:href") ?? "";

    try {
      const url = new URL(rawHref, window.location.origin);
      if (url.protocol !== "https:" || url.hostname !== "github.com") {
        anchor.removeAttribute("href");
        anchor.removeAttribute("xlink:href");
        continue;
      }

      anchor.setAttribute("href", url.toString());
      anchor.removeAttribute("xlink:href");
      anchor.setAttribute("rel", "noopener noreferrer");
    } catch {
      anchor.removeAttribute("href");
      anchor.removeAttribute("xlink:href");
    }
  }
}
