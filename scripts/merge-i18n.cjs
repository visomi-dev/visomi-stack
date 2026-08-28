/* eslint-disable */
// Merges the freshly-extracted source XLF into messages.es.xlf.
// For every trans-unit in messages.xlf that is missing from messages.es.xlf,
// it appends a <trans-unit> whose <target> is the English <source> (so the
// build stops warning; the team can hand-translate the new entries later).
// Existing <target> translations are preserved.

const fs = require('node:fs');
const path = require('node:path');

const localesDir = path.join(__dirname, '..', 'apps', 'web', 'app', 'src', 'locales');
const sourcePath = path.join(localesDir, 'messages.xlf');
const targetPath = path.join(localesDir, 'messages.es.xlf');

const source = fs.readFileSync(sourcePath, 'utf8');
const existing = fs.readFileSync(targetPath, 'utf8');

const transUnitRegex = /<trans-unit\b[^>]*\bid="([^"]+)"[\s\S]*?<\/trans-unit>/g;

function extractUnits(xlf) {
  const units = new Map();
  let match;

  while ((match = transUnitRegex.exec(xlf)) !== null) {
    units.set(match[1], match[0]);
  }

  return units;
}

const sourceUnits = extractUnits(source);
const existingUnits = extractUnits(existing);

const missing = [];
const reordered = [];

for (const [id, block] of sourceUnits) {
  if (existingUnits.has(id)) {
    reordered.push(existingUnits.get(id));

    continue;
  }

  // Extract the <source>...</source> inner text and use it as the <target>.
  const sourceMatch = block.match(/<source>([\s\S]*?)<\/source>/);
  const sourceText = sourceMatch ? sourceMatch[1].trim() : id;
  const isHtml = /datatype="html"/.test(block);

  const escapedSource = sourceText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const target = isHtml ? ` ${escapedSource} ` : escapedSource;

  // Strip context-group (location metadata) — not needed in the es file.
  const cleanedBlock = block.replace(/\s*<context-group[\s\S]*?<\/context-group>/g, '');

  // Replace the </source> close with </source><target>…</target>.
  const mergedBlock = cleanedBlock.replace(/<\/source>/, `</source>\n        <target>${target}</target>`);

  reordered.push(mergedBlock);
  missing.push(id);
}

const header = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en-US" target-language="es" datatype="plaintext" original="ng2.template">
    <body>
`;
const footer = `    </body>
  </file>
</xliff>
`;

const newBody = reordered.map((b) => `      ${b}`).join('\n');
const output = header + newBody + '\n' + footer;

fs.writeFileSync(targetPath, output);

console.log(`merged ${sourceUnits.size} units (${missing.length} new, ${sourceUnits.size - missing.length} kept).`);
if (missing.length) {
  console.log(`new keys: ${missing.join(', ')}`);
}
