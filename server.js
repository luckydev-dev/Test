import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 3000);
const requestTimeout = Number(process.env.SNAPP_UPSTREAM_TIMEOUT || 18000);

// The UI assets live in `public/`. Locally that directory sits next to this
// file, but a serverless bundle can place it one or two levels up, so probe a
// few candidates instead of assuming a single layout.
const publicDirCandidates = [
  path.join(__dirname, 'public'),
  path.join(__dirname, '..', 'public'),
  path.join(__dirname, '..', '..', 'public'),
  path.join(process.cwd(), 'public')
];

let cachedPublicDir = null;
function getPublicDir() {
  if (cachedPublicDir) return cachedPublicDir;
  cachedPublicDir = publicDirCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html')))
    || publicDirCandidates[0];
  return cachedPublicDir;
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const instagramHosts = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const remoteMediaSuffixes = ['.cdninstagram.com', '.fbcdn.net', '.fbsbx.com'];

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function cleanText(value) {
  return String(value || '')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .trim();
}

function safeFilename(value) {
  return String(value || 'download')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 100) || 'download';
}

function parseInstagramUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!instagramHosts.has(hostname)) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  let kind = parts[0]?.toLowerCase();
  let shortcode = parts[1];

  if (kind === 'share' && (parts[1] === 'reel' || parts[1] === 'p')) {
    kind = parts[1];
    shortcode = parts[2];
  }

  if (!['p', 'reel', 'reels', 'tv'].includes(kind) || !shortcode) return null;
  if (!/^[a-zA-Z0-9_-]{3,120}$/.test(shortcode)) return null;

  const canonicalKind = kind === 'reels' ? 'reel' : kind;
  const canonical = `https://www.instagram.com/${canonicalKind}/${shortcode}/`;
  return { canonical, kind: canonicalKind, shortcode };
}

function isAllowedMediaUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const hostname = parsed.hostname.toLowerCase();
  return hostname === 'instagram.com'
    || hostname.endsWith('.instagram.com')
    || remoteMediaSuffixes.some((suffix) => hostname.endsWith(suffix));
}

function mediaProxyUrl(mediaUrl, filename, download = false) {
  const endpoint = download ? '/api/download' : '/api/media';
  return `${endpoint}?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(filename)}`;
}

function parseTagAttributes(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    attrs[match[1].toLowerCase()] = cleanText(match[3]);
  }
  return attrs;
}

function getMetaTags(html) {
  const tags = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseTagAttributes(match[0]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key) tags.push({ key, content: attrs.content || '' });
  }
  return tags;
}

function metaValue(tags, ...keys) {
  const found = tags.find((tag) => keys.includes(tag.key));
  return found ? cleanText(found.content) : '';
}

function extractBalancedJson(text, startIndex) {
  const opening = text[startIndex];
  if (opening !== '{' && opening !== '[') return null;
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, index + 1);
    }
  }
  return null;
}

function collectMediaFromObject(value, collected = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value) || collected.length >= 40) return collected;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectMediaFromObject(item, collected, seen);
    return collected;
  }

  const type = value.media_type ?? value.type;
  const videoCandidates = [];
  if (typeof value.video_url === 'string') videoCandidates.push(value.video_url);
  if (Array.isArray(value.video_versions)) {
    for (const candidate of value.video_versions) {
      if (typeof candidate === 'string') videoCandidates.push(candidate);
      else if (candidate?.url) videoCandidates.push(candidate.url);
    }
  }
  const imageCandidates = [];
  for (const key of ['display_url', 'image_url', 'thumbnail_src', 'src']) {
    if (typeof value[key] === 'string') imageCandidates.push(value[key]);
  }
  if (value.image_versions2?.candidates && Array.isArray(value.image_versions2.candidates)) {
    for (const candidate of value.image_versions2.candidates) {
      if (candidate?.url) imageCandidates.push(candidate.url);
    }
  }

  const unique = (items) => items.map(cleanText).filter(isAllowedMediaUrl);
  const videos = unique(videoCandidates);
  const images = unique(imageCandidates);

  if (videos.length || (Number(type) === 2 && images.length)) {
    const videoUrl = videos[0];
    const thumbnail = images[0] || '';
    if (videoUrl) collected.push({ type: 'video', url: videoUrl, thumbnail });
  } else if (images.length && (Number(type) === 1 || value.display_url || value.image_versions2)) {
    collected.push({ type: 'image', url: images[0], thumbnail: '' });
  }

  for (const child of Object.values(value)) collectMediaFromObject(child, collected, seen);
  return collected;
}

function parseInstagramDocument(html) {
  const tags = getMetaTags(html);
  const title = metaValue(tags, 'og:title', 'twitter:title');
  const description = metaValue(tags, 'og:description', 'description', 'twitter:description');
  const metaImage = metaValue(tags, 'og:image', 'twitter:image');
  const metaVideo = metaValue(tags, 'og:video', 'og:video:secure_url', 'twitter:player:stream');
  const objects = [];

  const sharedIndex = html.indexOf('window._sharedData');
  if (sharedIndex >= 0) {
    const objectStart = html.indexOf('{', sharedIndex);
    const json = objectStart >= 0 ? extractBalancedJson(html, objectStart) : null;
    if (json) {
      try { objects.push(JSON.parse(json)); } catch { /* The page can contain partial data. */ }
    }
  }

  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { objects.push(JSON.parse(match[1])); } catch { /* Ignore malformed structured data. */ }
  }

  const collected = [];
  for (const object of objects) collectMediaFromObject(object, collected);

  const videoMatches = [...html.matchAll(/(?:"|\\")video_url(?:"|\\")\s*:\s*(?:"|\\")([^"\\]+)(?:"|\\")/gi)]
    .map((match) => cleanText(match[1]))
    .filter(isAllowedMediaUrl);
  const displayMatches = [...html.matchAll(/(?:"|\\")(?:display_url|thumbnail_src)(?:"|\\")\s*:\s*(?:"|\\")([^"\\]+)(?:"|\\")/gi)]
    .map((match) => cleanText(match[1]))
    .filter(isAllowedMediaUrl);

  for (const url of videoMatches) {
    if (!collected.some((item) => item.url === url)) collected.unshift({ type: 'video', url, thumbnail: displayMatches[0] || metaImage });
  }
  if (metaVideo && isAllowedMediaUrl(metaVideo) && !collected.some((item) => item.url === metaVideo)) {
    collected.unshift({ type: 'video', url: metaVideo, thumbnail: metaImage });
  }
  if (metaImage && isAllowedMediaUrl(metaImage) && !collected.some((item) => item.url === metaImage)) {
    collected.push({ type: 'image', url: metaImage, thumbnail: '' });
  }
  for (const imageUrl of displayMatches) {
    if (!collected.some((item) => item.url === imageUrl)) collected.push({ type: 'image', url: imageUrl, thumbnail: '' });
  }

  // Avoid rendering duplicate URLs discovered in several embedded objects.
  const media = [];
  const seen = new Set();
  for (const item of collected) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    media.push(item);
  }

  const authorMatch = description.match(/(?:by|from)\s+@?([a-zA-Z0-9._]+)/i);
  return {
    title,
    description,
    author: authorMatch ? `@${authorMatch[1]}` : '',
    media: media.slice(0, 20)
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(requestTimeout)
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function resolveInstagramMedia(instagram) {
  const endpoints = [
    instagram.canonical,
    `${instagram.canonical}?__a=1&__d=dis`,
    `${instagram.canonical}embed/captioned/`,
    `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(instagram.canonical)}`
  ];
  let lastStatus = 0;
  let lastError;

  for (const endpoint of endpoints) {
    try {
      const result = await fetchText(endpoint);
      lastStatus = result.status;
      if (!result.ok || !result.text) continue;
      const parsed = parseInstagramDocument(result.text);
      if (parsed.media.length) {
        const isJsonEndpoint = endpoint.includes('__a=1') || endpoint.includes('oembed');
        let data = parsed;
        if (isJsonEndpoint) {
          try {
            const json = JSON.parse(result.text);
            const oembedImage = json.thumbnail_url;
            if (oembedImage && isAllowedMediaUrl(oembedImage)) {
              data.media.push({ type: 'image', url: oembedImage, thumbnail: '' });
            }
            data = { ...parsed, title: parsed.title || json.title || '', author: parsed.author || (json.author_name ? `@${json.author_name}` : '') };
          } catch { /* HTML parsing already handled the response. */ }
        }
        const uniqueMedia = [];
        const seen = new Set();
        for (const item of data.media) {
          if (!seen.has(item.url)) {
            seen.add(item.url);
            uniqueMedia.push(item);
          }
        }
        return { ...data, media: uniqueMedia.slice(0, 20) };
      }
      if (!lastError && /not found|private|log in|login/i.test(result.text)) lastError = new Error('The post is private or unavailable.');
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError?.message === 'The post is private or unavailable.') {
    throw lastError;
  }
  if (lastStatus === 429 || lastStatus === 403) {
    throw new Error('Instagram temporarily blocked the request. Please try again in a moment.');
  }
  throw new Error('We could not find public media at that link. Check the URL and try again.');
}

function getExtension(media) {
  if (media.type === 'video') return 'mp4';
  try {
    const pathname = new URL(media.url).pathname.toLowerCase();
    const match = pathname.match(/\.(jpe?g|png|webp|gif)(?:$|\?)/);
    return match ? match[1].replace('jpeg', 'jpg') : 'jpg';
  } catch {
    return 'jpg';
  }
}

async function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 32_000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

async function handleResolve(request, response) {
  let payload;
  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch {
    sendJson(response, 400, { error: 'Please send a valid request.' });
    return;
  }

  const instagram = parseInstagramUrl(payload.url);
  if (!instagram) {
    sendJson(response, 400, { error: 'Paste a valid public Instagram post, Reel, or video link.' });
    return;
  }

  try {
    const resolved = await resolveInstagramMedia(instagram);
    const media = resolved.media.map((item, index) => {
      const filename = `snapp-${instagram.shortcode}${resolved.media.length > 1 ? `-${index + 1}` : ''}.${getExtension(item)}`;
      const previewUrl = mediaProxyUrl(item.url, filename);
      return {
        type: item.type,
        previewUrl,
        downloadUrl: mediaProxyUrl(item.url, filename, true),
        filename,
        thumbnailUrl: item.thumbnail && isAllowedMediaUrl(item.thumbnail)
          ? mediaProxyUrl(item.thumbnail, `${filename}-thumbnail.jpg`)
          : previewUrl
      };
    });

    sendJson(response, 200, {
      sourceUrl: instagram.canonical,
      shortcode: instagram.shortcode,
      kind: instagram.kind,
      title: resolved.title || `${instagram.kind === 'reel' ? 'Instagram Reel' : 'Instagram post'} ${instagram.shortcode}`,
      description: resolved.description,
      author: resolved.author,
      media
    });
  } catch (error) {
    sendJson(response, 422, { error: error.message || 'Unable to fetch that Instagram link.' });
  }
}

async function handleMedia(request, response, requestUrl, forceDownload = false) {
  const target = requestUrl.searchParams.get('url');
  if (!target || !isAllowedMediaUrl(target)) {
    sendJson(response, 400, { error: 'That media URL is not available.' });
    return;
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Snapp/1.0)',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8',
        ...(request.headers.range ? { Range: request.headers.range } : {})
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(requestTimeout)
    });
    if (!upstream.ok || !upstream.body) {
      sendJson(response, 502, { error: 'Instagram did not return that file. Please resolve the link again.' });
      return;
    }

    const requestedName = safeFilename(requestUrl.searchParams.get('filename') || 'instagram-download');
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*'
    };
    if (contentLength) headers['Content-Length'] = contentLength;
    if (upstream.headers.has('content-range')) headers['Content-Range'] = upstream.headers.get('content-range');
    if (upstream.headers.has('accept-ranges')) headers['Accept-Ranges'] = upstream.headers.get('accept-ranges');
    if (forceDownload) headers['Content-Disposition'] = `attachment; filename="${requestedName}"`;
    response.writeHead(upstream.status === 206 ? 206 : 200, headers);
    // Node 18+ exposes the Web stream returned by fetch as a Node-readable stream.
    const stream = (await import('node:stream')).Readable.fromWeb(upstream.body);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch {
    if (!response.headersSent) sendJson(response, 502, { error: 'The media file could not be retrieved right now.' });
    else response.destroy();
  }
}

function serveStatic(request, response, pathname) {
  const publicDir = getPublicDir();
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(requestedPath).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') sendJson(response, 404, { error: 'Not found.' });
      else sendJson(response, 500, { error: 'Unable to read that file.' });
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    response.end(content);
  });
}

export async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'POST' && requestUrl.pathname === '/api/resolve') {
    await handleResolve(request, response);
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/media') {
    await handleMedia(request, response, requestUrl, false);
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/download') {
    await handleMedia(request, response, requestUrl, true);
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'GET') {
    serveStatic(request, response, decodeURIComponent(requestUrl.pathname));
    return;
  }
  sendJson(response, 405, { error: 'Method not allowed.' });
}

export default handleRequest;

// Start the standalone server only when this file is the entry point. On
// Vercel the module is imported by the `api/index.js` function instead.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const server = http.createServer(handleRequest);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Snapp is running on http://0.0.0.0:${port}`);
  });
}
