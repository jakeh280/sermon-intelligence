"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Split out so react-markdown and remark-gfm (about 200 KB of script) load only when
// there is output to render, instead of on the empty start screen. Callers always
// pass their component map: app/page.tsx relies on it to drop images from output.
export default function Markdown({ children, components }: { children: string; components: Components }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
