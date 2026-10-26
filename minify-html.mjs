import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { minify } from "html-minifier-terser";

const htmlPath = resolve("index.html");
const html = await readFile(htmlPath, "utf8");
const minified = await minify(html, {
  collapseWhitespace: true,
  conservativeCollapse: true,
  minifyCSS: true,
  minifyJS: { format: { comments: "all" } },
});

await writeFile(htmlPath, minified);
console.log(
  `Minified index.html: ${Buffer.byteLength(html)} -> ${Buffer.byteLength(minified)} bytes`,
);
