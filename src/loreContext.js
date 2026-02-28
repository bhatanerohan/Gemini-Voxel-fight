// src/loreContext.js — Multi-channel lore storage + retrieval for gameplay prompts

const STORAGE_KEY = 'voxel-arena.lore-context.v2';
const LEGACY_STORAGE_KEY = 'voxel-arena.lore-context.v1';
const MAX_CONTEXT_CHARS = 24000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEV_PROXY_POLL_ATTEMPTS = 24;
const DEV_PROXY_POLL_DELAY_MS = 1200;
const CHANNEL_ORDER = ['uploaded_lore', 'codex_milestones', 'relic_decodes'];
const PACK_FIELDS = ['worldRules', 'relicThemes', 'decreeArchetypes'];

function createEmptyLorePack() {
  return {
    worldRules: [],
    relicThemes: [],
    decreeArchetypes: [],
  };
}

function createEmptyChannel() {
  return {
    text: '',
    fileName: '',
    sourceType: '',
    charCount: 0,
    updatedAt: '',
    lorePack: createEmptyLorePack(),
  };
}

function createDefaultContext() {
  return {
    channels: {
      uploaded_lore: createEmptyChannel(),
      codex_milestones: createEmptyChannel(),
      relic_decodes: createEmptyChannel(),
    },
    updatedAt: '',
  };
}

let _context = loadLoreContext();

function nowIso() {
  return new Date().toISOString();
}

function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CONTEXT_CHARS);
}

function sanitizeSnippet(text, max = 180) {
  const clean = sanitizeText(text).replace(/\n+/g, ' ');
  return clean.slice(0, max);
}

function uniqueLimited(values = [], max = 12) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const snippet = sanitizeSnippet(value, 220);
    if (!snippet) continue;
    const key = snippet.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(snippet);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeLorePack(input) {
  const pack = createEmptyLorePack();
  for (const field of PACK_FIELDS) {
    pack[field] = uniqueLimited(Array.isArray(input?.[field]) ? input[field] : [], 14);
  }
  return pack;
}

function sanitizeChannel(input, key) {
  const text = sanitizeText(input?.text);
  const hasPack = key === 'uploaded_lore';
  return {
    text,
    fileName: typeof input?.fileName === 'string' ? input.fileName.slice(0, 180) : '',
    sourceType: typeof input?.sourceType === 'string' ? input.sourceType.slice(0, 40) : '',
    charCount: text.length,
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : '',
    lorePack: hasPack ? sanitizeLorePack(input?.lorePack) : createEmptyLorePack(),
  };
}

function latestTimestamp(channels) {
  let latest = '';
  let latestMs = 0;
  for (const key of CHANNEL_ORDER) {
    const ts = channels?.[key]?.updatedAt;
    const ms = ts ? Date.parse(ts) : 0;
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latest = ts;
    }
  }
  return latest;
}

function normalizeContext(input) {
  const base = createDefaultContext();
  if (!input || typeof input !== 'object') return base;

  // Legacy flat schema support.
  if (!input.channels && (typeof input.text === 'string' || typeof input.fileName === 'string')) {
    base.channels.uploaded_lore = sanitizeChannel({
      text: input.text,
      fileName: input.fileName,
      sourceType: input.sourceType || 'legacy-import',
      updatedAt: input.updatedAt,
    }, 'uploaded_lore');
    base.updatedAt = base.channels.uploaded_lore.updatedAt;
    return base;
  }

  for (const key of CHANNEL_ORDER) {
    base.channels[key] = sanitizeChannel(input.channels?.[key], key);
  }
  base.updatedAt = typeof input.updatedAt === 'string' && input.updatedAt
    ? input.updatedAt
    : latestTimestamp(base.channels);
  return base;
}

function loadLoreContext() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeContext(JSON.parse(raw));
  } catch (_) {
    // ignore parse errors and continue fallback
  }
  try {
    const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (rawLegacy) return normalizeContext(JSON.parse(rawLegacy));
  } catch (_) {
    // ignore parse errors
  }
  return createDefaultContext();
}

function saveLoreContext(context) {
  _context = normalizeContext(context);
  if (!_context.updatedAt) _context.updatedAt = latestTimestamp(_context.channels) || nowIso();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_context));
  } catch (_) {
    // Ignore storage write failures (private mode, quota, etc.)
  }
  emitLoreContextUpdate();
  return getLoreContext();
}

function normalizeExtension(fileName = '') {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0) return '';
  return fileName.slice(idx + 1).toLowerCase();
}

function isLikelyTextFile(file) {
  const ext = normalizeExtension(file?.name || '');
  const textExtensions = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'log']);
  if (textExtensions.has(ext)) return true;
  const type = String(file?.type || '').toLowerCase();
  return type.startsWith('text/') || type.includes('json') || type.includes('csv');
}

function extractTextFromParseResponse(data) {
  if (!data) return '';
  if (typeof data.text === 'string') return data.text;
  if (typeof data.content === 'string') return data.content;
  if (typeof data.markdown === 'string') return data.markdown;
  if (typeof data?.result?.text === 'string') return data.result.text;
  if (typeof data?.result?.markdown === 'string') return data.result.markdown;
  if (Array.isArray(data.pages)) {
    return data.pages
      .map((page) => (typeof page === 'string' ? page : (typeof page?.text === 'string' ? page.text : '')))
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function parseFileViaDevProxy(file, signal) {
  const formData = new FormData();
  formData.append('file', file, file?.name || 'upload');

  const uploadRes = await fetch('/llamaparse/v2/parse/upload', {
    method: 'POST',
    body: formData,
    signal,
  });

  if (!uploadRes.ok) {
    let message = `Dev LlamaParse upload failed (${uploadRes.status})`;
    try {
      const body = await uploadRes.json();
      const detail = body?.detail || body?.error?.message || body?.message;
      if (typeof detail === 'string' && detail.trim()) message = detail.trim();
    } catch (_) {
      // Keep default message.
    }
    throw new Error(message);
  }

  const uploadData = await uploadRes.json().catch(() => ({}));
  const directText = sanitizeText(extractTextFromParseResponse(uploadData));
  if (directText) return directText;

  const jobId = uploadData?.id || uploadData?.job_id || uploadData?.job?.id;
  if (!jobId) throw new Error('Dev LlamaParse upload returned no job ID.');

  for (let attempt = 0; attempt < DEV_PROXY_POLL_ATTEMPTS; attempt++) {
    const jobRes = await fetch(`/llamaparse/v2/parse/${encodeURIComponent(jobId)}?expand=text,markdown`, {
      method: 'GET',
      signal,
    });

    if (!jobRes.ok) {
      let message = `Dev LlamaParse poll failed (${jobRes.status})`;
      try {
        const body = await jobRes.json();
        const detail = body?.detail || body?.error?.message || body?.message;
        if (typeof detail === 'string' && detail.trim()) message = detail.trim();
      } catch (_) {
        // Keep default message.
      }
      throw new Error(message);
    }

    const jobData = await jobRes.json().catch(() => ({}));
    const text = sanitizeText(extractTextFromParseResponse(jobData));
    if (text) return text;
    const status = String(jobData?.status || jobData?.job?.status || '').toLowerCase();
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      const detail = jobData?.error_message || jobData?.message || 'Dev LlamaParse job failed.';
      throw new Error(typeof detail === 'string' ? detail : 'Dev LlamaParse job failed.');
    }
    await sleep(DEV_PROXY_POLL_DELAY_MS);
  }

  throw new Error('Dev LlamaParse timed out. Try again with a smaller file.');
}

async function parseFileViaServer(file, signal) {
  if (Number.isFinite(file?.size) && file.size > MAX_UPLOAD_BYTES) {
    throw new Error('File is too large (max 10 MB).');
  }

  const payload = {
    fileName: file?.name || 'upload',
    mimeType: file?.type || 'application/octet-stream',
    base64: await fileToBase64(file),
  };

  const res = await fetch('/llamaparse/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    if ((res.status === 404 || res.status === 500 || res.status === 503) && import.meta.env.DEV) {
      return parseFileViaDevProxy(file, signal);
    }
    let message = `Parser request failed (${res.status})`;
    try {
      const body = await res.json();
      const detail = body?.error?.message || body?.message;
      if (typeof detail === 'string' && detail.trim()) message = detail.trim();
    } catch (_) {
      // Keep default message.
    }
    throw new Error(message);
  }

  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    throw new Error('Parser response was not valid JSON.');
  }

  const extracted = sanitizeText(extractTextFromParseResponse(body));
  if (!extracted) throw new Error('Parser returned empty text.');
  return extracted;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

function emitLoreContextUpdate() {
  try {
    window.dispatchEvent(new CustomEvent('lore_context_updated', { detail: getLoreContext() }));
  } catch (_) {
    // Non-browser environments.
  }
}

function channelLabel(key) {
  if (key === 'uploaded_lore') return 'Upload';
  if (key === 'codex_milestones') return 'Milestones';
  if (key === 'relic_decodes') return 'Relics';
  return 'Lore';
}

function channelForMeta(meta = {}) {
  if (CHANNEL_ORDER.includes(meta.channel)) return meta.channel;
  const sourceType = String(meta.sourceType || '').toLowerCase();
  if (sourceType.includes('relic')) return 'relic_decodes';
  if (sourceType.includes('codex')) return 'codex_milestones';
  return 'uploaded_lore';
}

function buildAggregateText(maxChars = MAX_CONTEXT_CHARS, order = CHANNEL_ORDER) {
  const sections = [];
  for (const key of order) {
    const text = _context.channels[key]?.text || '';
    if (!text) continue;
    sections.push(`${channelLabel(key)}:\n${text}`);
  }
  return sanitizeText(sections.join('\n\n')).slice(0, maxChars);
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function splitLongSegment(text, maxLen = 360) {
  const clean = sanitizeText(text);
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];
  const out = [];
  let remaining = clean;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('.', maxLen);
    if (splitAt < Math.floor(maxLen * 0.5)) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < Math.floor(maxLen * 0.35)) splitAt = maxLen;
    out.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) out.push(remaining);
  return out.filter(Boolean);
}

function splitTextToChunks(text, maxLen = 360) {
  const clean = sanitizeText(text);
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLen) {
      chunks.push(paragraph);
      continue;
    }
    const sentenceChunks = paragraph.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    if (!sentenceChunks.length) {
      chunks.push(...splitLongSegment(paragraph, maxLen));
      continue;
    }
    let buf = '';
    for (const sentence of sentenceChunks) {
      if (!buf) {
        buf = sentence;
        continue;
      }
      const candidate = `${buf} ${sentence}`;
      if (candidate.length <= maxLen) {
        buf = candidate;
      } else {
        chunks.push(buf);
        buf = sentence;
      }
    }
    if (buf) chunks.push(buf);
  }
  return chunks.slice(0, 180);
}

function scoreChunk(chunkText, queryTokens, queryText, index, channelKey) {
  if (!queryTokens.length) return Math.max(0.01, 1 - index * 0.01);
  const tokens = new Set(tokenize(chunkText));
  let overlap = 0;
  for (const token of queryTokens) {
    if (tokens.has(token)) overlap++;
  }
  const phraseBonus = queryText && chunkText.toLowerCase().includes(queryText.toLowerCase()) ? 1.8 : 0;
  const channelBias = channelKey === 'uploaded_lore' ? 0.35 : 0.12;
  return overlap * 2 + phraseBonus + channelBias - index * 0.01;
}

function buildLorePack(text) {
  const clean = sanitizeText(text);
  const lines = clean.split('\n').map(s => s.trim()).filter(Boolean);
  const paragraphs = clean.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);

  const worldRules = [];
  const relicThemes = [];
  const decreeArchetypes = [];

  const pushUnique = (arr, value, max = 14) => {
    if (!value || arr.length >= max) return;
    const cleanValue = sanitizeSnippet(value, 220);
    if (!cleanValue) return;
    const found = arr.some(existing => existing.toLowerCase() === cleanValue.toLowerCase());
    if (!found) arr.push(cleanValue);
  };

  for (const line of lines) {
    if (/(rule|must|cannot|never|always|forbid|ban|allowed|limit|required)/i.test(line)) {
      pushUnique(worldRules, line);
    }
    if (/(relic|artifact|sigil|shard|tablet|fragment|glyph|rune|codex)/i.test(line)) {
      pushUnique(relicThemes, line);
    }
    if (/(decree|mutator|modifier|risk|reward|trade.?off|buff|debuff|boon|curse)/i.test(line)) {
      pushUnique(decreeArchetypes, line);
    }
  }

  for (const paragraph of paragraphs) {
    if (!worldRules.length) pushUnique(worldRules, paragraph);
    if (relicThemes.length < 4 && /(arena|relic|artifact|codex|boss|champion)/i.test(paragraph)) pushUnique(relicThemes, paragraph);
    if (decreeArchetypes.length < 4 && /(risk|reward|decree|mutator|modifier|wave|pressure)/i.test(paragraph)) pushUnique(decreeArchetypes, paragraph);
  }

  if (!worldRules.length && paragraphs.length) {
    for (const paragraph of paragraphs.slice(0, 4)) pushUnique(worldRules, paragraph);
  }
  if (!relicThemes.length && paragraphs.length) {
    for (const paragraph of paragraphs.slice(0, 4)) pushUnique(relicThemes, paragraph);
  }
  if (!decreeArchetypes.length && paragraphs.length) {
    for (const paragraph of paragraphs.slice(0, 4)) pushUnique(decreeArchetypes, paragraph);
  }

  return {
    worldRules: uniqueLimited(worldRules, 14),
    relicThemes: uniqueLimited(relicThemes, 14),
    decreeArchetypes: uniqueLimited(decreeArchetypes, 14),
  };
}

function getStats() {
  const upload = _context.channels.uploaded_lore;
  const relic = _context.channels.relic_decodes;
  const codex = _context.channels.codex_milestones;
  const pack = upload.lorePack || createEmptyLorePack();
  return {
    uploadedChars: upload.charCount || 0,
    relicChars: relic.charCount || 0,
    codexChars: codex.charCount || 0,
    worldRuleCount: (pack.worldRules || []).length,
    relicThemeCount: (pack.relicThemes || []).length,
    decreeArchetypeCount: (pack.decreeArchetypes || []).length,
  };
}

export function getLoreRetrieval(opts = {}) {
  const queryText = sanitizeSnippet(opts.query || '', 180);
  const queryTokens = tokenize(queryText);
  const maxChars = Number.isFinite(opts.maxChars) ? Math.max(120, Math.floor(opts.maxChars)) : 1600;
  const limit = Number.isFinite(opts.limit) ? Math.max(1, Math.floor(opts.limit)) : 5;
  const channels = Array.isArray(opts.channels) && opts.channels.length
    ? opts.channels.filter(key => CHANNEL_ORDER.includes(key))
    : CHANNEL_ORDER.slice();
  const items = [];

  for (const key of channels) {
    const channel = _context.channels[key];
    if (!channel) continue;
    const chunks = splitTextToChunks(channel.text, 360);
    for (let i = 0; i < chunks.length; i++) {
      items.push({
        channel: key,
        text: chunks[i],
        score: scoreChunk(chunks[i], queryTokens, queryText, i, key),
      });
    }
  }

  // Lore-pack snippets from upload get extra relevance for relic/decree generation.
  const uploadPack = _context.channels.uploaded_lore?.lorePack || createEmptyLorePack();
  for (const field of PACK_FIELDS) {
    const rows = Array.isArray(uploadPack[field]) ? uploadPack[field] : [];
    for (let i = 0; i < rows.length; i++) {
      const text = `${field}: ${rows[i]}`;
      items.push({
        channel: 'uploaded_lore',
        text,
        score: scoreChunk(text, queryTokens, queryText, i, 'uploaded_lore') + 0.6,
      });
    }
  }

  items.sort((a, b) => b.score - a.score);

  const selected = [];
  const seen = new Set();
  let charBudget = 0;
  for (const item of items) {
    const key = item.text.toLowerCase();
    if (seen.has(key)) continue;
    if (selected.length >= limit) break;
    const line = `[${channelLabel(item.channel)}] ${item.text}`;
    if (charBudget + line.length > maxChars) continue;
    selected.push({ ...item, line });
    seen.add(key);
    charBudget += line.length + 1;
  }

  if (!selected.length && !queryTokens.length) {
    const fallback = buildAggregateText(maxChars, channels).slice(0, maxChars);
    return {
      text: fallback,
      sources: fallback ? ['Aggregate lore stream'] : [],
      usedChannels: channels,
    };
  }

  return {
    text: selected.map(item => item.line).join('\n'),
    sources: selected.map(item => `${channelLabel(item.channel)}: ${sanitizeSnippet(item.text, 90)}`),
    usedChannels: [...new Set(selected.map(item => item.channel))],
  };
}

export function getLoreContext() {
  const aggregate = buildAggregateText(MAX_CONTEXT_CHARS, CHANNEL_ORDER);
  const stats = getStats();
  return {
    text: aggregate,
    fileName: _context.channels.uploaded_lore.fileName || '',
    sourceType: 'multi',
    charCount: aggregate.length,
    updatedAt: _context.updatedAt || latestTimestamp(_context.channels),
    channels: {
      uploaded_lore: { ..._context.channels.uploaded_lore, lorePack: sanitizeLorePack(_context.channels.uploaded_lore.lorePack) },
      codex_milestones: { ..._context.channels.codex_milestones, lorePack: createEmptyLorePack() },
      relic_decodes: { ..._context.channels.relic_decodes, lorePack: createEmptyLorePack() },
    },
    stats,
  };
}

export function getLoreContextText(maxChars = 6000, opts = undefined) {
  const n = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 6000;
  if (opts && typeof opts === 'object') {
    const retrieval = getLoreRetrieval({ ...opts, maxChars: n });
    return retrieval.text.slice(0, n);
  }
  return buildAggregateText(n, CHANNEL_ORDER).slice(0, n);
}

export function clearLoreContext() {
  return saveLoreContext(createDefaultContext());
}

export function appendLoreContext(snippet, meta = {}) {
  const next = sanitizeText(snippet);
  if (!next) return getLoreContext();
  const target = channelForMeta(meta);
  const existing = _context.channels[target] || createEmptyChannel();
  const combined = sanitizeText(existing.text ? `${existing.text}\n\n${next}` : next);
  const updatedAt = nowIso();
  const updatedChannel = sanitizeChannel({
    ...existing,
    text: combined,
    fileName: typeof meta.fileName === 'string' && meta.fileName.trim() ? meta.fileName : (existing.fileName || channelLabel(target)),
    sourceType: typeof meta.sourceType === 'string' && meta.sourceType.trim() ? meta.sourceType : (existing.sourceType || target),
    updatedAt,
    lorePack: target === 'uploaded_lore'
      ? (meta.reparsePack ? buildLorePack(combined) : existing.lorePack)
      : createEmptyLorePack(),
  }, target);
  return saveLoreContext({
    ..._context,
    channels: {
      ..._context.channels,
      [target]: updatedChannel,
    },
    updatedAt,
  });
}

export async function importLoreFile(file, { signal } = {}) {
  if (!file) throw new Error('Choose a file first.');

  let extracted = '';
  if (isLikelyTextFile(file)) {
    extracted = sanitizeText(await file.text());
  } else {
    extracted = await parseFileViaServer(file, signal);
  }

  if (!extracted) throw new Error('No readable text found in file.');

  const updatedAt = nowIso();
  const uploaded = sanitizeChannel({
    text: extracted,
    fileName: file.name || 'Imported file',
    sourceType: file.type || normalizeExtension(file.name) || 'import',
    updatedAt,
    lorePack: buildLorePack(extracted),
  }, 'uploaded_lore');

  return saveLoreContext({
    ..._context,
    channels: {
      ..._context.channels,
      uploaded_lore: uploaded,
    },
    updatedAt,
  });
}
