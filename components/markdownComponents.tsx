"use client";

import type { Components } from "react-markdown";

// react-markdown hands every component its syntax tree node as a `node` prop.
// Spread onto a DOM element, it renders as node="[object Object]".
function withoutNode<T extends object>(props: T): Omit<T, "node"> {
  const rest = { ...props } as T & { node?: unknown };
  delete rest.node;
  return rest;
}

export const markdownComponents: Components = {
  // Images aren't part of the output contract - the prompt never asks for
  // them - so a URL that ends up in the model's response (from the source
  // transcript or an injected instruction) must not become a live <img> tag.
  // A rendered image is an automatic, unclickable request to whatever host
  // that URL names, and any text baked into the URL travels with it. Every
  // Markdown instance uses this component map (directly, or by spreading it,
  // as titleMarkdownComponents does), so this one override covers every
  // rendering site, including restored history.
  img: () => null,
  a: ({ href, children, ...props }) => (
    <a
      {...withoutNode(props)}
      href={href}
      className="font-medium underline decoration-[#0B6ED0]/50 underline-offset-2 transition-colors hover:text-[#3B93E8]"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  p: ({ children, ...props }) => (
    <p className="mb-3 text-base leading-7 text-zinc-300 last:mb-0" {...withoutNode(props)}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul
      className="mb-3 list-disc space-y-1.5 pl-5 text-base leading-7 text-zinc-300 last:mb-0"
      {...withoutNode(props)}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className="mb-3 list-decimal space-y-1.5 pl-5 text-base leading-7 text-zinc-300 last:mb-0"
      {...withoutNode(props)}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-relaxed [&>p]:mb-0" {...withoutNode(props)}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-zinc-100" {...withoutNode(props)}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="text-zinc-200" {...withoutNode(props)}>
      {children}
    </em>
  ),
  h1: ({ children, ...props }) => (
    <h4 className="mb-2 text-base font-semibold text-white" {...withoutNode(props)}>
      {children}
    </h4>
  ),
  h2: ({ children, ...props }) => (
    <h4 className="mb-2 text-base font-semibold text-white" {...withoutNode(props)}>
      {children}
    </h4>
  ),
  h3: ({ children, ...props }) => (
    <h4 className="mb-2 mt-4 text-sm font-semibold text-zinc-100 first:mt-0" {...withoutNode(props)}>
      {children}
    </h4>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="mb-2 text-sm font-semibold text-zinc-200" {...withoutNode(props)}>
      {children}
    </h4>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="mb-3 border-l-2 border-[#0B6ED0]/60 pl-3 text-base italic leading-7 text-zinc-400"
      {...withoutNode(props)}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-zinc-700/80" />,
  code: ({ className, children, ...props }) => {
    const inline = !className;
    if (inline) {
      return (
        <code
          className="rounded bg-zinc-800/90 px-1.5 py-0.5 font-mono text-[0.8125rem] text-[#7EB8F0]"
          {...withoutNode(props)}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...withoutNode(props)}>
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }) => (
    <pre
      className="mb-3 overflow-x-auto rounded-lg border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-300 last:mb-0"
      {...withoutNode(props)}
    >
      {children}
    </pre>
  ),
  table: ({ children, ...props }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left text-sm text-zinc-300" {...withoutNode(props)}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="border-b border-zinc-700 bg-zinc-900/80" {...withoutNode(props)}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }) => (
    <th className="px-3 py-2 font-semibold text-zinc-100" {...withoutNode(props)}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border-b border-zinc-800/80 px-3 py-2 align-top" {...withoutNode(props)}>
      {children}
    </td>
  ),
};

// The Titles card lays its numbered options out side by side as tiles.
export const titleMarkdownComponents: Components = {
  ...markdownComponents,
  ol: ({ children, ...props }) => (
    <ol className="flex flex-col md:flex-row gap-4 w-full list-none" {...withoutNode(props)}>
      {children}
    </ol>
  ),
  ul: ({ children, ...props }) => (
    <ul className="flex flex-col md:flex-row gap-4 w-full list-none" {...withoutNode(props)}>
      {children}
    </ul>
  ),
  li: ({ children, ...props }) => (
    <li className="flex-1 rounded-2xl bg-black/20 border border-white/5 p-4 text-center text-sm font-semibold text-white shadow-lg list-none flex items-center justify-center [&>p]:mb-0 [&>p]:flex-1" {...withoutNode(props)}>
      {children}
    </li>
  ),
};
