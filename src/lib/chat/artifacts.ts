// Artifact detection for the in-app chat.
//
// Walks an assistant message and decides which fenced code blocks deserve
// to live in the side panel ("artifacts") vs stay inline. The decision is
// purely heuristic — model output isn't required to follow any convention,
// so this works for minimax/deepseek/glm/etc. that don't respect XML tags.
//
// Source of truth is always the raw message text. We don't persist
// artifacts; they're re-derived on every render. IDs are stable as long
// as the message text doesn't change (which it doesn't after streaming).

export type ArtifactKind = "html" | "svg" | "code";

export type Artifact = {
  id: string;          // stable: `${messageId}#${index}`
  messageId: string;
  index: number;       // 0-based ordinal within the message
  language: string;    // lowercased; "text" if none was specified
  title: string;       // derived from code (function name, html title, etc.)
  filename: string;    // `${title || language}-${index+1}.${ext}`
  code: string;
  kind: ArtifactKind;  // determines whether the panel offers a preview tab
  closed: boolean;     // false while the fence is still streaming
};

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "code-inline"; language: string; code: string; closed: boolean }
  | { kind: "artifact-ref"; artifactId: string };

export type ParsedMessage = {
  segments: Segment[];
  artifacts: Artifact[];
};

// Languages that *always* become artifacts regardless of length — these
// have a meaningful preview or are typically substantial UI work.
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

  // <title>...</title> for HTML
  const htmlTitle = trimmed.match(/<title>\s*([^<\n]+?)\s*<\/title>/i);
  if (htmlTitle) {
    const t = htmlTitle[1].slice(0, 60);
    return { title: t, filename: slugify(t) + "." + ext };
  }

  // Top-level JS/TS function or class or exported const
  const jsName = trimmed.match(
    /(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/
  );
  if (jsName) return { title: jsName[1], filename: jsName[1] + "." + ext };

  // Python def/class
  const pyName = trimmed.match(/(?:def|class)\s+([A-Za-z_][\w]*)/);
  if (pyName) return { title: pyName[1], filename: pyName[1] + "." + ext };

  // First non-empty comment line as title
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

// ```lang\n...code...\n``` — captures the opening fence's language.
const FENCE_OPEN = /```([\w+#.-]*)\n/g;

export function parseMessage(messageId: string, raw: string): ParsedMessage {
  const segments: Segment[] = [];
  const artifacts: Artifact[] = [];

  let cursor = 0;
  let artifactIndex = 0;

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

    // Closing fence: a line that is exactly ``` (preceded by newline or at
    // start of buffer, followed by newline or EOS).
    const closeIdx = findFenceClose(raw, codeStart);

    if (closeIdx === -1) {
      // Unclosed — still streaming. Render inline as code so the user sees
      // it grow; we'll re-parse on the next delta and possibly extract.
      const code = raw.slice(codeStart);
      segments.push({ kind: "code-inline", language: lang, code, closed: false });
      cursor = raw.length;
      break;
    }

    const code = raw.slice(codeStart, closeIdx);
    // Skip the "```" itself plus any trailing newline.
    const afterClose = (() => {
      let i = closeIdx + 3;
      if (raw[i] === "\n") i++;
      return i;
    })();

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

  return { segments, artifacts };
}

// Look for a closing ``` that sits on its own line. Permissive about the
// trailing newline so we still match if it's the last thing in the buffer.
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

// Convenience for the panel: collect all artifacts across an array of
// (messageId, content) pairs. Stable ordering: oldest message first,
// preserving in-message index.
export function collectArtifacts(items: Array<{ id: string; text: string }>): Artifact[] {
  const out: Artifact[] = [];
  for (const item of items) {
    const { artifacts } = parseMessage(item.id, item.text);
    out.push(...artifacts);
  }
  return out;
}
