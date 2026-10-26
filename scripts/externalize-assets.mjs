import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const htmlPath = resolve("index.html");
const assetsPath = resolve("assets");
let html = await readFile(htmlPath, "utf8");
const manifestTag = /(<script type="__bundler\/manifest">)([\s\S]*?)(<\/script>)/;
const manifestMatch = html.match(manifestTag);

if (!manifestMatch) {
  throw new Error("Could not find the embedded asset manifest in index.html");
}

const manifest = JSON.parse(manifestMatch[2]);
const extensionByMime = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
]);
const inlineAssetLoader =
  "const r=atob(t.data),i=new Uint8Array(r.length);for(let e=0;e<r.length;e++)i[e]=r.charCodeAt(e);";
const externalAssetLoader =
  'const r=t.src?await fetch(t.src):null;if(r&&!r.ok)throw new Error("Asset request failed ("+r.status+"): "+t.src);const i=r?new Uint8Array(await r.arrayBuffer()):(()=>{const r=atob(t.data),i=new Uint8Array(r.length);for(let e=0;e<r.length;e++)i[e]=r.charCodeAt(e);return i})();';

let extractedCount = 0;
let extractedBytes = 0;

for (const [id, asset] of Object.entries(manifest)) {
  if (!asset.mime.startsWith("image/") || asset.src) {
    continue;
  }

  const extension = extensionByMime.get(asset.mime);
  if (!extension) {
    throw new Error(`No file extension configured for ${asset.mime}`);
  }

  const data = Buffer.from(asset.data, "base64");
  const relativePath = `assets/${id}.${extension}`;
  await mkdir(assetsPath, { recursive: true });
  await writeFile(resolve(assetsPath, `${id}.${extension}`), data);
  asset.src = relativePath;
  delete asset.data;
  extractedCount += 1;
  extractedBytes += data.byteLength;
}

if (extractedCount > 0) {
  const scriptTag = /(<script>)([\s\S]*?)(<\/script>)/;
  const scriptMatch = html.match(scriptTag);
  if (!scriptMatch || !scriptMatch[2].includes(inlineAssetLoader)) {
    throw new Error("Could not find the expected inline asset loader in index.html");
  }

  html = html.replace(
    scriptTag,
    (_, openTag, script, closeTag) =>
      `${openTag}${script.replace(inlineAssetLoader, externalAssetLoader)}${closeTag}`,
  );
  html = html.replace(
    manifestTag,
    (_, openTag, _content, closeTag) =>
      `${openTag}${JSON.stringify(manifest)}${closeTag}`,
  );
  await writeFile(htmlPath, html);
}

console.log(
  extractedCount > 0
    ? `Externalized ${extractedCount} images (${extractedBytes} bytes) to assets/`
    : "No embedded images to externalize.",
);
