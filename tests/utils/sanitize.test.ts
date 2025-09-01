import { test, expect } from "bun:test";
import { sanitizeNoteForTts } from "../../src/utils/sanitize";

test("sanitize removes frontmatter, code, images, and HTML", () => {
  const input = `---\nTitle: Example\n---\n
<svg><circle cx="5" cy="5" r="5" /></svg>

![alt](image.png) ![[local.png]] <img src="x" />

Some text with a [link](https://example.com) and a bare URL https://foo.bar .

<!-- comment -->

\`code\` and:
\n\n
\`\`\`
console.log('block');
\`\`\`

Generated audio: [[Audio/file_part_1.mp3]]
`;

  const out = sanitizeNoteForTts(input);
  // Frontmatter removed
  expect(out.includes("Title: Example")).toBe(false);
  // SVG/IMG removed
  expect(/svg|img/i.test(out)).toBe(false);
  // Images removed
  expect(out.includes("![[")).toBe(false);
  expect(out.includes("![")).toBe(false);
  // Code removed
  expect(out.includes("console.log")).toBe(false);
  expect(out.includes("code")).toBe(false);
  // Generated audio line removed
  expect(out.includes("Generated audio: [[")).toBe(false);
  // Link text preserved
  expect(out).toContain("Some text with a link and a bare URL");
});

test("sanitize handles wiki links by keeping filename", () => {
  const input = `Please read [[Folder/Page.md]] and [[Note|Custom Title]].`;
  const out = sanitizeNoteForTts(input);
  expect(out).toContain("Please read Page and Note.");
});


