import { readFile, readdir } from 'node:fs/promises';

export const root = new URL('../', import.meta.url);
export const skillRoot = new URL('skills/threejs/', root);
export const files = [new URL('SKILL.md', skillRoot), ...(await readdir(new URL('references/', skillRoot)))
  .filter(name => name.endsWith('.md')).map(name => new URL(`references/${name}`, skillRoot))];

export function codeBlocks(markdown) {
  return [...markdown.matchAll(/^\s*```(\w*)[^\n]*\n([\s\S]*?)^\s*```\s*$/gm)]
    .map(match => ({ language: match[1], code: match[2] }));
}

export async function example(id) {
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const marker = `<!-- check: ${id} -->`;
    if (source.includes(marker)) return codeBlocks(source.split(marker)[1])[0].code;
  }
  throw new Error(`Missing executable Markdown example: ${id}`);
}

export function withoutImports(code) {
  return code.replace(/^import\s+[\s\S]*?;\s*$/gm, '');
}

export async function evaluateExample(id, bindings, result) {
  return new Function(...Object.keys(bindings), `${withoutImports(await example(id))}\nreturn ${result};`)
    (...Object.values(bindings));
}
