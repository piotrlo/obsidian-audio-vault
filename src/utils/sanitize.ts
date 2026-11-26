/**
 * Sanitize note content for TTS by removing frontmatter, code, media and HTML tags.
 *
 * Removes:
 * - YAML frontmatter at the start of the file
 * - Code blocks (```...```, ~~~...~~~) and inline code (`...`)
 * - Markdown heading markers (# through ######), retaining heading text
 * - HTML blocks: script, style, svg, iframe, audio, video, picture, canvas, object, embed, noscript
 * - HTML comments <!-- ... -->
 * - Images (Markdown ![alt](url), wiki ![[...]], HTML <img ...>)
 * - Residual HTML tags (<...>)
 * - Autolinks <http://...> and bare URLs
 * - Obsidian-generated "Generated audio: [[...]]" lines
 * - Excess whitespace
 *
 * Retains plain textual content and link texts from Markdown links.
 *
 * @param {string} input Raw note content.
 * @returns {string} Clean text suitable for TTS and chunking.
 */
export function sanitizeNoteForTts(input: string): string {
  const blockTags = [
    "script", "style", "svg", "iframe", "audio", "video", 
    "picture", "canvas", "object", "embed", "noscript"
  ];

  const patterns = {
    frontmatter: [/^---[\t ]*\r?\n[\s\S]*?\r?\n---[\t ]*\r?\n?/, ""],
    htmlComment: [/<!--([\s\S]*?)-->/g, " "],
    codeFences: [/(?:```[\s\S]*?```|~~~[\s\S]*?~~~)/g, " "],
    inlineCode: [/`[^`]*`/g, " "],
    blockHtml: [new RegExp(`<(?:${blockTags.join("|")})\\b[\\s\\S]*?<\\/(?:${blockTags.join("|")})>`, "gi"), " "],
    htmlImg: [/<img\b[^>]*>/gi, " "],
    mdImage: [/!\[[^\]]*\]\([^\)]*\)/g, " "],
    wikiImage: [/!\[\[[^\]]*\]\]/g, " "],
    mdLink: [/\[([^\]]+)\]\(([^)]+)\)/g, "$1"],
    angleAutolink: [/<https?:[^>]+>/gi, " "],
    bareUrl: [/https?:\/\/\S+/gi, " "],
    anyHtmlTag: [/<[^>]+>/g, " "],
    spaces: [/[\t ]+/g, " "],
    nbsp: [/\u00A0/g, " "],
    aroundNewlines: [/\s*\n\s*/g, "\n"],
    manyNewlines: [/\n{3,}/g, "\n\n"]
  } as const;

  const applyReplace = (text: string, [pattern, replacement]: readonly [RegExp, string]) => 
    text.replace(pattern, replacement);

  const stripHeadingMarkers = (text: string) =>
    text.replace(/^ {0,3}#{1,6}(?=[\t ]|$)[^\r\n]*/gm, (heading) =>
      heading.replace(/^ {0,3}#{1,6}/, "").replace(/[\t ]+#+[\t ]*$/, "").trim());

  const removeGeneratedAudioLines = (text: string) =>
    text
      .split(/\r?\n/)
      .filter((line) => !/^Generated audio:\s*\[\[/i.test(line))
      .join("\n");

  const convertWikiLinks = (text: string) =>
    text.replace(/\[\[[^\]|]+(?:\|[^\]]+)?\]\]/g, (link) =>
      (link.slice(2).split(/[|\]]/, 1)[0].split("/").pop() || "").replace(/\.(md|markdown)$/i, ""));

  const transformations = [
    (s: string) => applyReplace(s, patterns.frontmatter),
    (s: string) => applyReplace(s, patterns.htmlComment),
    (s: string) => applyReplace(s, patterns.codeFences),
    stripHeadingMarkers,
    (s: string) => applyReplace(s, patterns.inlineCode),
    (s: string) => applyReplace(s, patterns.blockHtml),
    (s: string) => applyReplace(s, patterns.htmlImg),
    (s: string) => applyReplace(s, patterns.mdImage),
    (s: string) => applyReplace(s, patterns.wikiImage),
    removeGeneratedAudioLines,
    (s: string) => applyReplace(s, patterns.mdLink),
    convertWikiLinks,
    (s: string) => applyReplace(s, patterns.angleAutolink),
    (s: string) => applyReplace(s, patterns.bareUrl),
    (s: string) => applyReplace(s, patterns.anyHtmlTag),
    (s: string) => applyReplace(s, patterns.spaces),
    (s: string) => applyReplace(s, patterns.nbsp),
    (s: string) => applyReplace(s, patterns.aroundNewlines),
    (s: string) => applyReplace(s, patterns.manyNewlines),
    (s: string) => s.trim()
  ];

  return transformations.reduce((acc, transform) => transform(acc), String(input || ""));
}
