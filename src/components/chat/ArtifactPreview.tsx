"use client";

import { useMemo } from "react";
import type { Artifact } from "@/lib/chat/artifacts";

// Render an executable preview for HTML or SVG artifacts inside a sandboxed
// iframe. The sandbox token list intentionally omits `allow-same-origin`
// so untrusted markup from the model can't read parent cookies / storage,
// and `allow-top-navigation` is omitted so it can't navigate us away.
//
// `allow-scripts` is needed for HTML artifacts that include <script>.
// SVG is wrapped in a minimal HTML shell so the iframe can size to fit.
export function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const srcDoc = useMemo(() => buildSrcDoc(artifact), [artifact]);

  return (
    <iframe
      title={`Preview: ${artifact.filename}`}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-modals allow-forms allow-popups"
      className="w-full h-full"
      style={{
        background: "white",
        border: "none",
        display: "block",
      }}
    />
  );
}

function buildSrcDoc(artifact: Artifact): string {
  if (artifact.kind === "svg") {
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}
svg{max-width:100%;max-height:100%}
</style></head><body>${artifact.code}</body></html>`;
  }

  // For HTML, if the snippet already declares a full document just use it
  // as-is so we don't fight the model's intent. Otherwise wrap in a minimal
  // shell so partial fragments still render reasonably.
  const looksLikeDocument = /<!doctype/i.test(artifact.code) || /<html[\s>]/i.test(artifact.code);
  if (looksLikeDocument) return artifact.code;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;padding:1rem;font-family:system-ui,-apple-system,sans-serif;color:#222;background:#fff}
</style></head><body>${artifact.code}</body></html>`;
}
