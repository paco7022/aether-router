// Artifact detection for the in-app chat.
//
// Walks an assistant message and decides which fenced code blocks and XML
// artifact tags deserve to live in the side panel ("artifacts") vs stay
// inline. The decision is purely heuristic — model output isn't required
// to follow any convention, so this works for models that use markdown
// fences as well as Claude-style XML artifacts.
//
// Source of truth is always the raw message text. We don't persist
// artifacts; they're re-derived on every render. IDs are stable as long
// as the message text doesn't change (which it doesn't after streaming).

export type ArtifactKind = "html" | "svg" | "code";

export type Artifact = {
  id: string;
  messageId: string;
  index: number;
  language: string;
  title: string;
  filename: string;
  code: string;
  kind: ArtifactKind;
  closed: boolean;
};

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "code-inline"; language: string; code: string; closed: boolean }
  | { kind: "artifact-ref"; artifactId: string };

export type ParsedMessage = {
  segments: Segment[];
  artifacts: Artifact[];
};

const ALWAYS_ARTIFACT = new Set([
  "html", "svg", "jsx", "tsx", "vue", "svelte", "react",
]);

const MIN_LINES = 15;
const MIN_CHARS = 500;

function normalize(lang: string): string {
  return lang.toLowerCase().trim();
}

function shouldBeArtifact(language: string, code: string): boolean {
  if (ALWAYS_ARTIFACT.has(normalize(language))) return true;
  const lineCount = code.split("\n").length;
  return lineCount >= MIN_LINES || code.length >= MIN_CHARS;
}

function getArtifactKind(language: string): ArtifactKind {
  const l = normalize(language);
  if (l === "html") return "html";
  if (l === "svg") return "svg";
  return "code";
}

const EXT_MAP: Record<string, string> = {
  javascript: "js", js: "js",
  typescript: "ts", ts: "ts",
  jsx: "jsx", tsx: "tsx",
  python: "py", py: "py",
  html: "html", css: "css", scss: "scss",
  svg: "svg",
  json: "json", yaml: "yml", yml: "yml",
  markdown: "md", md: "md",
  shell: "sh", bash: "sh", sh: "sh",
  sql: "sql",
  rust: "rs", rs: "rs",
  go: "go",
  java: "java", kotlin: "kt", kt: "kt",
  c: "c", cpp: "cpp", "c++": "cpp",
  csharp: "cs", "c#": "cs", cs: "cs",
  ruby: "rb", rb: "rb",
  php: "php",
  swift: "swift",
  vue: "vue", svelte: "svelte",
  react: "jsx",
  text: "txt", "": "txt",
};

function langExt(lang: string): string {
  return EXT_MAP[normalize(lang)] ?? "txt";
}

function deriveTitle(lang: string, code: string, index: number): { title: string; filename: string } {
  const trimmed = code.trim();
  const ext = langExt(lang);
  const fallback = `${normalize(lang) || "snippet"}-${index + 1}`;

  const htmlTitle = trimmed.match(/<title>\s*([^<\n]+?)\s*<\/title>/i);
  if (htmlTitle) {
    const t = htmlTitle[1].slice(0, 60);
    return { title: t, filename: slugify(t) + "." + ext };
  }

  const jsName = trimmed.match(
    /(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/
  );
  if (jsName) return { title: jsName[1], filename: jsName[1] + "." + ext };

  const pyName = trimmed.match(/(?:def|class)\s+([A-Za-z_][\w]*)/);
  if (pyName) return { title: pyName[1], filename: pyName[1] + "." + ext };

  const firstComment = trimmed.match(/^(?:\/\/|#|--)\s*(.{4,60})/m);
  if (firstComment) {
    const t = firstComment[1].trim().slice(0, 60);
    return { title: t, filename: slugify(t) + "." + ext };
  }

  return { title: fallback, filename: fallback + "." + ext };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "artifact";
}

// ---------------------------------------------------------------------------
// XML artifact tag extraction
// ---------------------------------------------------------------------------
// Claude and other models emit artifacts using XML-style tags rather than
// markdown fences. We support two formats:
//
//   <antml:artifact identifier="id" type="application/vnd.ant.code" title="file.py">
//     <antml:parameter name="language">python</antml:parameter>
//     code here
//   </antml:artifact>
//
//   <artifact name="file.py" language="python" type="code">
//     code here
//   </artifact>
//
// We also handle the generic <artifact>...</artifact> form with no attributes,
// treating the entire content as a text artifact.
//
// These are extracted BEFORE fallback fence scanning so that XML tags are
// stripped from the displayed text and replaced with artifact-ref segments.

type XmlArtifact = {
  start: number;
  end: number;
  language: string;
  title: string;
  code: string;
};

function extractXmlArtifacts(raw: string): XmlArtifact[] {
  const results: XmlArtifact[] = [];

  // Pattern 1: <antml:artifact ...>...</antml:artifact>
  const antmlRe = /<antml:artifact\b[^>]*>[\s\S]*?<\/antml:artifact>/g;
  let m: RegExpExecArray | null;
  while ((m = antmlRe.exec(raw)) !== null) {
    const full = m[0];
    const start = m.index;
    const end = start + full.length;

    const titleAttr = full.match(/\btitle\s*=\s*"([^"]*)"/);
    const title = titleAttr?.[1] ?? "";

    const langParam = full.match(/<antml:parameter\s+name\s*=\s*"language"[^>]*>([^<]*)<\/antml:parameter>/);
    const language = langParam?.[1]?.trim()?.toLowerCase() ?? "";

    // Extract the code content: everything after the last </antml:parameter>
    // and before </antml:artifact>, trimmed.
    const lastParamEnd = full.lastIndexOf("</antml:parameter>");
    const codeStart = lastParamEnd === -1
      ? full.indexOf(">") + 1
      : lastParamEnd + "</antml:parameter>".length;
    const codeEnd = full.lastIndexOf("</antml:artifact>");
    const code = full.slice(codeStart, codeEnd).trim();

    results.push({ start, end, language, title, code });
  }

  // Pattern 2: <artifact ...>...</artifact> (simple attributes)
  const artRe = /<artifact\b[^>]*>[\s\S]*?<\/artifact>/g;
  while ((m = artRe.exec(raw)) !== null) {
    // Skip if this position overlaps with an already-extracted antml:artifact
    const overlap = results.some(
      (r) => m!.index >= r.start && m!.index < r.end
    );
    if (overlap) continue;

    const full = m[0];
    const start = m.index;
    const end = start + full.length;

    const nameAttr = full.match(/\bname\s*=\s*"([^"]*)"/);
    const langAttr = full.match(/\blanguage\s*=\s*"([^"]*)"/);
    const typeAttr = full.match(/\btype\s*=\s*"([^"]*)"/);

    const title = nameAttr?.[1] ?? "";
    let language = langAttr?.[1]?.toLowerCase() ?? "";

    // Infer language from type if not explicit (e.g. type="application/vnd.ant.code")
    if (!language && typeAttr) {
      const typeLang = typeAttr[1].match(/\/(?:x-)?(\w+)$/);
      if (typeLang) language = typeLang[1].toLowerCase();
    }

    const openEnd = full.indexOf(">");
    const closeStart = full.lastIndexOf("</artifact>");
    const code = full.slice(openEnd + 1, closeStart).trim();

    results.push({ start, end, language, title, code });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Combining XML extraction + markdown fence scanning
// ---------------------------------------------------------------------------

export function parseMessage(messageId: string, raw: string): ParsedMessage {
  const segments: Segment[] = [];
  const artifacts: Artifact[] = [];
  let artifactIndex = 0;

  // Phase 1: extract XML artifacts and build a mask of their spans so we
  // can skip those regions during fence scanning.
  const xmlArts = extractXmlArtifacts(raw);
  const xmlSpans: Array<{ start: number; end: number }> = xmlArts.map((a) => ({
    start: a.start,
    end: a.end,
  }));

  // If we found XML artifacts, split the text into regions: text that falls
  // outside XML tags (scanned for markdown fences) and artifact-ref
  // segments replacing the XML tags.
  if (xmlArts.length > 0) {
    // Sort by start position
    xmlArts.sort((a, b) => a.start - b.start);

    let cursor = 0;
    for (const xa of xmlArts) {
      // Text before this XML artifact — scan for markdown fences
      if (xa.start > cursor) {
        const textBefore = raw.slice(cursor, xa.start);
        const { segments: fenceSegs, artifacts: fenceArts, nextIndex } = scanFences(
          messageId,
          textBefore,
          artifactIndex,
        );
        segments.push(...fenceSegs);
        artifacts.push(...fenceArts);
        artifactIndex = nextIndex;
      }

      // The XML artifact itself becomes an artifact-ref
      const id = `${messageId}#${artifactIndex}`;
      const lang = xa.language || "text";
      const effectiveLang = normalize(lang) || "text";

      // If the XML artifact provided a title, use it; otherwise derive
      let title: string;
      let filename: string;
      if (xa.title) {
        title = xa.title;
        filename = xa.title.includes(".")
          ? xa.title
          : xa.title + "." + langExt(effectiveLang);
      } else {
        ({ title, filename } = deriveTitle(effectiveLang, xa.code, artifactIndex));
      }

      artifacts.push({
        id,
        messageId,
        index: artifactIndex,
        language: effectiveLang,
        title,
        filename,
        code: xa.code,
        kind: getArtifactKind(effectiveLang),
        closed: true,
      });
      segments.push({ kind: "artifact-ref", artifactId: id });
      artifactIndex++;

      cursor = xa.end;
    }

    // Remaining text after the last XML artifact
    if (cursor < raw.length) {
      const textAfter = raw.slice(cursor);
      const { segments: fenceSegs, artifacts: fenceArts, nextIndex } = scanFences(
        messageId,
        textAfter,
        artifactIndex,
      );
      segments.push(...fenceSegs);
      artifacts.push(...fenceArts);
      artifactIndex = nextIndex;
    }

    return { segments, artifacts };
  }

  // Phase 2: no XML artifacts found — pure markdown fence scanning
  const { segments: fenceSegs, artifacts: fenceArts } = scanFences(messageId, raw, 0);
  return { segments: fenceSegs, artifacts: fenceArts };
}

// Markdown fence scanner (```lang\n...code...\n```)
// Extracted into a reusable function so the XML path can call it on
// sub-regions of the text.
function scanFences(
  messageId: string,
  raw: string,
  startIndex: number,
): { segments: Segment[]; artifacts: Artifact[]; nextIndex: number } {
  const segments: Segment[] = [];
  const artifacts: Artifact[] = [];
  let artifactIndex = startIndex;

  const FENCE_OPEN = /```([\w+#.-]*)\n/g;
  let cursor = 0;

  while (cursor < raw.length) {
    FENCE_OPEN.lastIndex = cursor;
    const open = FENCE_OPEN.exec(raw);
    if (!open) {
      if (cursor < raw.length) {
        segments.push({ kind: "text", text: raw.slice(cursor) });
      }
      break;
    }

    if (open.index > cursor) {
      segments.push({ kind: "text", text: raw.slice(cursor, open.index) });
    }

    const lang = open[1] || "";
    const codeStart = open.index + open[0].length;

    const closeIdx = findFenceClose(raw, codeStart);

    if (closeIdx === -1) {
      const code = raw.slice(codeStart);
      segments.push({ kind: "code-inline", language: lang, code, closed: false });
      cursor = raw.length;
      break;
    }

    const code = raw.slice(codeStart, closeIdx);
    let afterClose = closeIdx + 3;
    if (raw[afterClose] === "\n") afterClose++;

    if (shouldBeArtifact(lang, code)) {
      const id = `${messageId}#${artifactIndex}`;
      const { title, filename } = deriveTitle(lang, code, artifactIndex);
      artifacts.push({
        id,
        messageId,
        index: artifactIndex,
        language: normalize(lang) || "text",
        title,
        filename,
        code,
        kind: getArtifactKind(lang),
        closed: true,
      });
      segments.push({ kind: "artifact-ref", artifactId: id });
      artifactIndex++;
    } else {
      segments.push({ kind: "code-inline", language: lang, code, closed: true });
    }

    cursor = afterClose;
  }

  return { segments, artifacts, nextIndex: artifactIndex };
}

function findFenceClose(raw: string, from: number): number {
  let i = from;
  while (i < raw.length) {
    const next = raw.indexOf("```", i);
    if (next === -1) return -1;
    const prev = next === 0 ? "\n" : raw[next - 1];
    const after = raw[next + 3];
    if (prev === "\n" && (after === "\n" || after === undefined)) {
      return next;
    }
    i = next + 3;
  }
  return -1;
}

export function collectArtifacts(items: Array<{ id: string; text: string }>): Artifact[] {
  const out: Artifact[] = [];
  for (const item of items) {
    const { artifacts } = parseMessage(item.id, item.text);
    out.push(...artifacts);
  }
  return out;
}