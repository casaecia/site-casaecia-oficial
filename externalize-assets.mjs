import { access, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const htmlPath = resolve("index.html");
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
let manifestChanged = false;

for (const [id, asset] of Object.entries(manifest)) {
  if (!asset.mime.startsWith("image/")) {
    continue;
  }

  const extension = extensionByMime.get(asset.mime);
  if (!extension) {
    throw new Error(`No file extension configured for ${asset.mime}`);
  }

  const fileName = `${id}.${extension}`;
  const filePath = resolve(fileName);

  if (asset.src) {
    if (asset.src !== fileName) {
      try {
        await access(resolve(asset.src));
        await rename(resolve(asset.src), filePath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
        await access(filePath);
      }

      asset.src = fileName;
      manifestChanged = true;
    }
    continue;
  }

  const data = Buffer.from(asset.data, "base64");
  await writeFile(filePath, data);
  asset.src = fileName;
  delete asset.data;
  extractedCount += 1;
  extractedBytes += data.byteLength;
  manifestChanged = true;
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
}

if (manifestChanged) {
  html = html.replace(
    manifestTag,
    (_, openTag, _content, closeTag) =>
      `${openTag}${JSON.stringify(manifest)}${closeTag}`,
  );
  await writeFile(htmlPath, html);
}

console.log(
  extractedCount > 0
    ? `Externalized ${extractedCount} images (${extractedBytes} bytes) to the project root.`
    : manifestChanged
      ? "Updated image paths to the project root."
      : "No embedded images to externalize.",
);
