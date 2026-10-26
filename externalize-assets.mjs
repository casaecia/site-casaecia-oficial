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
const templateTag = /(<script type="__bundler\/template">)([\s\S]*?)(<\/script>)/;
const gtmHeadMarker = "<!-- Google Tag Manager -->";
const metaPixelMarker = "<!-- Meta Pixel Code -->";
const gtmHead = `${gtmHeadMarker}
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-WGVGVN4X');</script>
<!-- End Google Tag Manager -->`;
const metaPixelHead = `${metaPixelMarker}
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '3564763540354699');
fbq('track', 'PageView');
</script>
<!-- End Meta Pixel Code -->`;
const bodyTrackingFallbacks = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-WGVGVN4X"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=3564763540354699&ev=PageView&noscript=1"
/></noscript>`;

let extractedCount = 0;
let extractedBytes = 0;
let manifestChanged = false;
let templateChanged = false;

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

const templateMatch = html.match(templateTag);
if (!templateMatch) {
  throw new Error("Could not find the embedded page template in index.html");
}

let pageTemplate = JSON.parse(templateMatch[2]);
if (!pageTemplate.includes(gtmHeadMarker)) {
  const headEnd = pageTemplate.indexOf("</head>");
  if (headEnd === -1) {
    throw new Error("Could not find </head> in the embedded page template");
  }
  pageTemplate = `${pageTemplate.slice(0, headEnd)}${gtmHead}\n${pageTemplate.slice(headEnd)}`;
  templateChanged = true;
}

if (!pageTemplate.includes(metaPixelMarker)) {
  const headEnd = pageTemplate.indexOf("</head>");
  if (headEnd === -1) {
    throw new Error("Could not find </head> in the embedded page template");
  }
  pageTemplate = `${pageTemplate.slice(0, headEnd)}${metaPixelHead}\n${pageTemplate.slice(headEnd)}`;
  templateChanged = true;
}

if (!pageTemplate.includes("GTM-WGVGVN4X")) {
  throw new Error("Google Tag Manager head code was not added to the page template");
}

if (!pageTemplate.includes("googletagmanager.com/ns.html?id=GTM-WGVGVN4X")) {
  const bodyOpen = pageTemplate.match(/<body\b[^>]*>/i);
  if (!bodyOpen) {
    throw new Error("Could not find <body> in the embedded page template");
  }
  const bodyEnd = bodyOpen.index + bodyOpen[0].length;
  const gtmFallbackEnd = bodyTrackingFallbacks.indexOf("<!-- End Google Tag Manager (noscript) -->") +
    "<!-- End Google Tag Manager (noscript) -->".length;
  pageTemplate = `${pageTemplate.slice(0, bodyEnd)}\n${bodyTrackingFallbacks.slice(0, gtmFallbackEnd)}\n${pageTemplate.slice(bodyEnd)}`;
  templateChanged = true;
}

if (!pageTemplate.includes("facebook.com/tr?id=3564763540354699")) {
  const bodyOpen = pageTemplate.match(/<body\b[^>]*>/i);
  if (!bodyOpen) {
    throw new Error("Could not find <body> in the embedded page template");
  }
  const bodyEnd = bodyOpen.index + bodyOpen[0].length;
  const metaFallback = bodyTrackingFallbacks.slice(
    bodyTrackingFallbacks.indexOf("<noscript><img"),
  );
  pageTemplate = `${pageTemplate.slice(0, bodyEnd)}\n${metaFallback}\n${pageTemplate.slice(bodyEnd)}`;
  templateChanged = true;
}

if (templateChanged) {
  html = html.replace(
    templateTag,
    (_, openTag, _content, closeTag) =>
      `${openTag}${JSON.stringify(pageTemplate).replace(/<\/script/gi, "<\\/script")}${closeTag}`,
  );
}

if (manifestChanged) {
  html = html.replace(
    manifestTag,
    (_, openTag, _content, closeTag) =>
      `${openTag}${JSON.stringify(manifest)}${closeTag}`,
  );
}

if (manifestChanged || templateChanged) {
  await writeFile(htmlPath, html);
}

console.log(
  [
    extractedCount > 0 &&
      `Externalized ${extractedCount} images (${extractedBytes} bytes) to the project root.`,
    manifestChanged && extractedCount === 0 && "Updated image paths to the project root.",
    templateChanged && "Added GTM and Meta Pixel tracking to the embedded page.",
  ]
    .filter(Boolean)
    .join(" ") || "Assets and tracking tags are already configured.",
);
