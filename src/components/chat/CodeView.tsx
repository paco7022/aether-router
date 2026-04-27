"use client";

import dynamic from "next/dynamic";

// Map our normalized language names to prism language names.
const LANG_ALIAS: Record<string, string> = {
  js: "javascript", javascript: "javascript",
  ts: "typescript", typescript: "typescript",
  jsx: "jsx", tsx: "tsx",
  py: "python", python: "python",
  html: "markup", svg: "markup", xml: "markup", vue: "markup", svelte: "markup",
  css: "css", scss: "scss",
  json: "json",
  yaml: "yaml", yml: "yaml",
  bash: "bash", sh: "bash", shell: "bash",
  sql: "sql",
  go: "go",
  rust: "rust", rs: "rust",
  java: "java",
  kotlin: "kotlin", kt: "kotlin",
  c: "c", cpp: "cpp", "c++": "cpp",
  csharp: "csharp", "c#": "csharp", cs: "csharp",
  ruby: "ruby", rb: "ruby",
  php: "php",
  swift: "swift",
  markdown: "markdown", md: "markdown",
};

// Lazy-load the highlighter so its prism core (~150KB gzip) only ships
// when a user actually opens the artifacts panel. We use the
// `PrismAsyncLight` build, which lazy-loads each language grammar via
// import() under the hood — no need to register them ourselves.
//
// `oneDark` style is bundled in the same chunk; one round-trip.
const HighlightedCode = dynamic(
  async () => {
    const [{ PrismAsyncLight }, oneDarkMod] = await Promise.all([
      import("react-syntax-highlighter"),
      import("react-syntax-highlighter/dist/esm/styles/prism"),
    ]);
    const oneDark = (oneDarkMod as unknown as { oneDark: Record<string, React.CSSProperties> }).oneDark;

    return function HighlightedCodeImpl({ language, code }: { language: string; code: string }) {
      const prismLang = LANG_ALIAS[language.toLowerCase()] ?? "text";
      return (
        <PrismAsyncLight
          language={prismLang}
          style={oneDark}
          showLineNumbers
          wrapLines={false}
          customStyle={{
            margin: 0,
            padding: "1rem",
            background: "rgba(0, 0, 0, 0.4)",
            fontSize: "12px",
            lineHeight: "1.55",
            borderRadius: 0,
          }}
          lineNumberStyle={{
            color: "rgba(255, 255, 255, 0.2)",
            minWidth: "2.25em",
            paddingRight: "0.75em",
          }}
        >
          {code}
        </PrismAsyncLight>
      );
    };
  },
  {
    ssr: false,
    loading: () => <FallbackPre code="" />,
  }
);

export function CodeView({ language, code }: { language: string; code: string }) {
  return <HighlightedCode language={language} code={code} />;
}

function FallbackPre({ code }: { code: string }) {
  return (
    <pre
      className="m-0 p-4 text-xs overflow-auto font-mono"
      style={{
        background: "rgba(0, 0, 0, 0.4)",
        color: "rgba(220, 220, 240, 0.9)",
        whiteSpace: "pre",
      }}
    >
      <code>{code}</code>
    </pre>
  );
}
