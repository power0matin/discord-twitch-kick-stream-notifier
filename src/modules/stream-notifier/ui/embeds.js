// src/ui/embeds.js
"use strict";

const { EmbedBuilder } = require("discord.js");
const { safeStr } = require("../validation");

/**
 * Professional embed system for Discord.js
 *
 * UX principles:
 * - Minimal but information-dense
 * - Clear hierarchy: title → meta → details
 * - Lists rendered in fields (keeps mentions clickable)
 * - Paging footer stays minimal (Page x/y)
 * - Safe truncation within Discord limits
 * - Works with Message or Interaction contexts
 *
 * Visual polish (non-dry):
 * - subtle "meta chips" line
 * - quote-style headers
 * - footer icon (requester/guild) for a premium feel
 */

/* ------------------------------- limits ------------------------------- */

const LIMITS = Object.freeze({
  TITLE: 256,
  DESC: 4096,
  FIELD_NAME: 256,
  FIELD_VALUE: 1024,
  FOOTER: 2048,
  FIELDS_MAX: 25,
});

/* ------------------------------- theme -------------------------------- */

const COLORS = Object.freeze({
  BRAND: 0x5865f2,
  INFO: 0x2f3136,
  SUCCESS: 0x57f287,
  WARN: 0xfee75c,
  ERROR: 0xed4245,
  KICK: 0x2dd4bf,
  TWITCH: 0x9146ff,
});

// Keep icons subtle: only in title / small meta chips
const ICONS = Object.freeze({
  INFO: "ℹ️",
  SUCCESS: "✅",
  WARN: "⚠️",
  ERROR: "❌",
  KICK: "🟢",
  TWITCH: "🟣",
});

/* ----------------------------- type guards ---------------------------- */

function isMessageLike(ctx) {
  return Boolean(ctx && typeof ctx.reply === "function" && ctx.channel);
}

function isInteractionLike(ctx) {
  return Boolean(ctx && typeof ctx.isRepliable === "function");
}

/* ------------------------------ utilities ----------------------------- */

function chunkArray(arr, size) {
  if (!Array.isArray(arr) || size <= 0) return [];
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function truncate(value, max) {
  const s = safeStr(value);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function toUnixSeconds(ms) {
  const n = Number(ms || 0);
  if (!n) return 0;
  return Math.floor(n / 1000);
}

/**
 * Discord timestamp formatting:
 * <t:unix:f> = full date/time
 * <t:unix:R> = relative
 */
function fmtDiscordTime(ms) {
  const u = toUnixSeconds(ms);
  if (!u) return "-";
  return `<t:${u}:f> • <t:${u}:R>`;
}

function toneToColor(tone) {
  const t = String(tone || "INFO").toUpperCase();
  if (t === "SUCCESS") return COLORS.SUCCESS;
  if (t === "WARN") return COLORS.WARN;
  if (t === "ERROR") return COLORS.ERROR;
  if (t === "KICK") return COLORS.KICK;
  if (t === "TWITCH") return COLORS.TWITCH;
  if (t === "INFO") return COLORS.INFO;
  return COLORS.BRAND;
}

function parseColor(input) {
  if (input == null) return null;

  if (typeof input === "number" && Number.isFinite(input)) {
    const n = Math.floor(input);
    if (n < 0 || n > 0xffffff) return null;
    return n;
  }

  const s = String(input).trim();
  if (!s) return null;

  // Accept: "#RRGGBB", "RRGGBB", "0xRRGGBB"
  const cleaned = s.replace(/^#/g, "").replace(/^0x/i, "").trim();

  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;

  const n = Number.parseInt(cleaned, 16);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toneToIcon(tone) {
  const t = String(tone || "INFO").toUpperCase();
  return ICONS[t] || ICONS.INFO;
}

/**
 * Resolve bot/requester/guild metadata from Message OR Interaction
 */
function resolveContextMeta(ctx) {
  const client = ctx?.client || ctx?.message?.client || null;

  const botName = client?.user?.username || "Stream Notifier";
  const botIcon = client?.user?.displayAvatarURL?.() || undefined;

  const requesterTag =
    ctx?.author?.tag ||
    ctx?.user?.tag ||
    (ctx?.user?.username ? `${ctx.user.username}` : "") ||
    "unknown";

  const guildNameRaw = ctx?.guild?.name ? String(ctx.guild.name) : "";

  const requesterAvatar =
    ctx?.author?.displayAvatarURL?.() ||
    ctx?.user?.displayAvatarURL?.() ||
    undefined;

  const guildIcon = ctx?.guild?.iconURL?.() || undefined;

  return {
    botName,
    botIcon,
    requesterTag: safeStr(requesterTag),
    guildNameRaw: safeStr(guildNameRaw),
    requesterAvatar,
    guildIcon,
  };
}

/**
 * Footer modes:
 * - "requester": Requested by X • Guild • Extra
 * - "page": Page x/y • Extra
 * - "none": no footer text
 */
function buildFooterText(ctx, { mode = "requester", extra = "" } = {}) {
  const { requesterTag, guildNameRaw } = resolveContextMeta(ctx);

  const extraSafe = safeStr(extra);
  if (mode === "none") return "";

  if (mode === "page") return truncate(extraSafe, LIMITS.FOOTER);

  const parts = [];
  const guild = guildNameRaw;
  const same =
    requesterTag && guild && requesterTag.toLowerCase() === guild.toLowerCase();

  parts.push(`Requested by ${requesterTag}`);
  if (guild && !same) parts.push(guild);
  if (extraSafe) parts.push(extraSafe);

  return truncate(parts.join(" • "), LIMITS.FOOTER);
}

/**
 * Visual polish:
 * - a subtle "meta chips" line (bold labels, separated by •)
 * - example: **Total:** 3 • **Page:** 1/2 • **Showing:** 18
 */
function buildMetaLine(pairs) {
  const clean = (pairs || [])
    .filter(Boolean)
    .map((p) => {
      const k = safeStr(p.key);
      const v = safeStr(p.value);
      if (!k || !v) return null;
      return `**${k}:** ${v}`;
    })
    .filter(Boolean);

  if (!clean.length) return "";
  return clean.join(" • ");
}

/**
 * Quote-style header (softer than plain lines)
 */
function quoteLines(lines) {
  const clean = (lines || []).map((x) => safeStr(x)).filter(Boolean);
  if (!clean.length) return "";
  // Use blockquote styling for a clean "card header" feel
  return clean.map((l) => `> ${l}`).join("\n");
}

/**
 * Normalize fields and enforce limits
 */
function normalizeFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return [];

  return fields
    .filter(Boolean)
    .slice(0, LIMITS.FIELDS_MAX)
    .map((f) => ({
      name: truncate(safeStr(f.name) || "\u200b", LIMITS.FIELD_NAME),
      value: truncate(safeStr(f.value) || "\u200b", LIMITS.FIELD_VALUE),
      inline: Boolean(f.inline),
    }));
}

/**
 * Split lines into chunks that fit within Discord field value limit.
 * Prevents ugly truncation and keeps mentions clickable (no code blocks).
 */
function splitLinesToFieldValues(lines, maxChars = LIMITS.FIELD_VALUE) {
  const clean = (lines || []).map((x) => safeStr(x)).filter(Boolean);
  const chunks = [];
  let buf = [];
  let len = 0;

  for (const line of clean) {
    const addLen = (buf.length ? 1 : 0) + line.length; // +1 for '\n'
    if (len + addLen > maxChars) {
      if (buf.length) chunks.push(buf.join("\n"));
      buf = [line];
      len = line.length;
      continue;
    }
    buf.push(line);
    len += addLen;
  }

  if (buf.length) chunks.push(buf.join("\n"));
  return chunks.length ? chunks : ["—"];
}

function looksShortLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const sample = lines.slice(0, Math.min(30, lines.length));
  const avg = sample.reduce((a, s) => a + safeStr(s).length, 0) / sample.length;
  return avg <= 32;
}

function pickFooterIconURL(ctx, footerMode, chrome) {
  const meta = resolveContextMeta(ctx);
  const useChrome = String(chrome || "standard").toLowerCase() !== "minimal";
  if (!useChrome) return undefined;

  // Page footers: prefer guild icon (feels "server branded")
  if (footerMode === "page") return meta.guildIcon || meta.botIcon;

  // Requester footers: show requester avatar (more personal/premium)
  if (footerMode === "requester")
    return meta.requesterAvatar || meta.guildIcon || meta.botIcon;

  return meta.botIcon;
}

/* ------------------------------ core API ------------------------------ */

/**
 * makeEmbed(ctx, options)
 *
 * Backward compatibility:
 * - supports { footerText, extraFooter } (old style)
 * - supports { footer: { text } } (legacy one-off callers)
 *
 * Options:
 * - density: "compact" | "normal" | "verbose"
 * - footerMode: "requester" | "page" | "none"
 * - chrome: "standard" | "minimal"
 */
function makeEmbed(
  ctx,
  {
    tone = "INFO",
    title,
    description,
    fields,
    url,

    // NEW: explicit color override (hex string or number)
    color,

    // NEW: control title icon behavior
    // - true (default): prefix icon based on tone
    // - false: no icon
    // - string: custom icon (e.g., "🎉")
    titleIcon = true,

    extraFooter,
    footerText,
    footer, // { text }
    footerMode = "requester",

    thumbnailUrl,
    imageUrl,

    density = "normal",
    chrome = "standard",

    // timestamp:
    // - true  => keep legacy behavior (only when chrome !== minimal)
    // - false => no timestamp
    // - "always" => force timestamp even in chrome:"minimal" (needed for Welcome footer time)
    timestamp = true,
  } = {}
) {
  const meta = resolveContextMeta(ctx);

  const e = new EmbedBuilder();

  const colorOverride = parseColor(color);
  e.setColor(colorOverride != null ? colorOverride : toneToColor(tone));

  const useChrome = String(chrome || "standard").toLowerCase() !== "minimal";

  // Consistent header
  if (useChrome) {
    e.setAuthor({ name: meta.botName, iconURL: meta.botIcon });
  }

  if (thumbnailUrl) e.setThumbnail(String(thumbnailUrl));
  if (imageUrl) e.setImage(String(imageUrl));

  if (title) {
    let prefix = "";

    if (typeof titleIcon === "string" && titleIcon.trim()) {
      prefix = `${titleIcon.trim()} `;
    } else if (titleIcon !== false) {
      // default behavior (backward compatible)
      prefix = `${toneToIcon(tone)} `;
    }

    e.setTitle(truncate(`${prefix}${safeStr(title)}`, LIMITS.TITLE));
  }

  if (url) e.setURL(String(url));

  const dens = String(density || "normal").toLowerCase();
  let desc = safeStr(description);

  if (dens === "compact") desc = truncate(desc, Math.min(LIMITS.DESC, 900));
  else desc = truncate(desc, LIMITS.DESC);

  if (desc) e.setDescription(desc);

  const normFields = normalizeFields(fields);
  if (normFields.length) e.addFields(normFields);

  const explicitFooter =
    footerText ||
    footer?.text ||
    buildFooterText(ctx, { mode: footerMode, extra: extraFooter });

  if (explicitFooter) {
    const iconURL = pickFooterIconURL(ctx, footerMode, chrome);
    e.setFooter({
      text: truncate(String(explicitFooter), LIMITS.FOOTER),
      ...(iconURL ? { iconURL } : {}),
    });
  }

  const tsMode =
    timestamp === "always" ? "always" : timestamp ? "chrome" : "off";
  if (tsMode === "always" || (tsMode === "chrome" && useChrome)) {
    e.setTimestamp(new Date());
  }

  return e;
}

/* ---------------------------- send helpers ---------------------------- */

async function replyEmbed(ctx, embed, opts = {}) {
  const payload = {
    embeds: [embed],
    allowedMentions: { parse: [] },
    ...opts,
  };

  if (isMessageLike(ctx)) {
    return ctx.reply(payload).catch(() => null);
  }

  if (isInteractionLike(ctx)) {
    try {
      if (ctx.deferred || ctx.replied) return await ctx.followUp(payload);
      return await ctx.reply(payload);
    } catch {
      return null;
    }
  }

  return null;
}

async function sendEmbed(message, embed, opts = {}) {
  if (!message?.channel?.send) return null;
  return message.channel
    .send({
      embeds: [embed],
      allowedMentions: { parse: [] },
      ...opts,
    })
    .catch(() => null);
}

async function sendEmbedsPaged(message, embeds) {
  if (!Array.isArray(embeds) || embeds.length === 0) return;
  await replyEmbed(message, embeds[0]);
  for (let i = 1; i < embeds.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await sendEmbed(message, embeds[i]);
  }
}

/* --------------------------- builder helpers -------------------------- */

/**
 * buildListEmbeds(ctx, options)
 *
 * Visual polish:
 * - header shown as quote block
 * - meta chips line: Total/Page/Showing (clean + modern)
 * - list stays in fields (mentions clickable)
 */
function buildListEmbeds(
  ctx,
  {
    tone = "INFO",
    title = "List",
    headerLines = [],
    lines = [],
    layout = "auto",
    perPage = 18,
    perCol = 10,
    emptyTitle,
    emptyHint,
  } = {}
) {
  const cleanLines = (lines || []).map((x) => safeStr(x)).filter(Boolean);

  const headerBlock = quoteLines(headerLines);

  if (cleanLines.length === 0) {
    const hint = emptyHint ? safeStr(emptyHint) : "No items to display.";
    const desc = [headerBlock, hint].filter(Boolean).join("\n\n");

    return [
      makeEmbed(ctx, {
        tone,
        title: emptyTitle || title,
        description: desc,
        footerMode: "requester",
        density: "normal",
      }),
    ];
  }

  const mode = String(layout || "auto").toLowerCase();
  const useTwoCol =
    mode === "two-column" ||
    (mode === "auto" && cleanLines.length >= 12 && looksShortLines(cleanLines));

  if (useTwoCol) {
    const pageBlocks = chunkArray(cleanLines, perCol * 2);
    const totalPages = Math.max(1, pageBlocks.length);

    return pageBlocks.map((pageLines, idx) => {
      const left = pageLines.slice(0, perCol);
      const right = pageLines.slice(perCol, perCol * 2);

      const leftVal =
        splitLinesToFieldValues(left, LIMITS.FIELD_VALUE)[0] || "—";
      const rightVal =
        splitLinesToFieldValues(right, LIMITS.FIELD_VALUE)[0] || "—";

      const fields = [
        { name: "\u200b", value: leftVal, inline: true },
        { name: "\u200b", value: rightVal, inline: true },
      ];

      const metaLine = buildMetaLine([
        { key: "Total", value: String(cleanLines.length) },
        { key: "Page", value: `${idx + 1}/${totalPages}` },
        { key: "Showing", value: String(pageLines.length) },
      ]);

      const desc = [headerBlock, metaLine].filter(Boolean).join("\n\n");

      return makeEmbed(ctx, {
        tone,
        title: safeStr(title),
        description: desc,
        fields,
        footerMode: "page",
        extraFooter: `Page ${idx + 1}/${totalPages}`,
        density: "normal",
      });
    });
  }

  // Single-column
  const chunks = chunkArray(cleanLines, perPage);
  const totalPages = Math.max(1, chunks.length);

  return chunks.map((group, idx) => {
    const fieldValues = splitLinesToFieldValues(group, LIMITS.FIELD_VALUE);

    // Usually a single field is enough; if it grows, we split to multiple fields
    const listFields = fieldValues.slice(0, LIMITS.FIELDS_MAX).map((v) => ({
      name: "\u200b",
      value: v,
      inline: false,
    }));

    const metaLine = buildMetaLine([
      { key: "Total", value: String(cleanLines.length) },
      { key: "Page", value: `${idx + 1}/${totalPages}` },
      { key: "Showing", value: String(group.length) },
    ]);

    const desc = [headerBlock, metaLine].filter(Boolean).join("\n\n");

    return makeEmbed(ctx, {
      tone,
      title: safeStr(title),
      description: desc,
      fields: listFields,
      footerMode: "page",
      extraFooter: `Page ${idx + 1}/${totalPages}`,
      density: "normal",
    });
  });
}

/**
 * buildCodeEmbeds(ctx, options)
 * - code blocks in description
 * - meta chips line at top (subtle)
 * - chrome minimal (focus on content)
 */
function buildCodeEmbeds(
  ctx,
  { tone = "INFO", title = "Export", lang = "json", text = "" } = {}
) {
  const prefix = `\`\`\`${lang}\n`;
  const suffix = "\n```";
  const budget = Math.max(800, LIMITS.DESC - prefix.length - suffix.length);

  const s = safeStr(text);
  const parts = [];
  for (let i = 0; i < s.length; i += budget) parts.push(s.slice(i, i + budget));

  const totalPages = Math.max(1, parts.length);

  return parts.map((p, idx) => {
    const metaLine = buildMetaLine([
      { key: "Page", value: `${idx + 1}/${totalPages}` },
      { key: "Lang", value: lang },
    ]);

    const desc = [metaLine, `${prefix}${p}${suffix}`]
      .filter(Boolean)
      .join("\n\n");

    return makeEmbed(ctx, {
      tone,
      title: safeStr(title),
      description: desc,
      footerMode: "page",
      extraFooter: `Page ${idx + 1}/${totalPages}`,
      chrome: "minimal",
      timestamp: false,
      density: "normal",
    });
  });
}

/* ------------------------- quick UI shortcuts ------------------------- */

const ui = {
  info: (ctx, title, description, fields) =>
    replyEmbed(
      ctx,
      makeEmbed(ctx, { tone: "INFO", title, description, fields })
    ),

  success: (ctx, title, description, fields) =>
    replyEmbed(
      ctx,
      makeEmbed(ctx, { tone: "SUCCESS", title, description, fields })
    ),

  warn: (ctx, title, description, fields) =>
    replyEmbed(
      ctx,
      makeEmbed(ctx, { tone: "WARN", title, description, fields })
    ),

  error: (ctx, title, description, fields) =>
    replyEmbed(
      ctx,
      makeEmbed(ctx, { tone: "ERROR", title, description, fields })
    ),

  kick: (ctx, title, description, fields) =>
    replyEmbed(
      ctx,
      makeEmbed(ctx, { tone: "KICK", title, description, fields })
    ),

  twitch: (ctx, title, description, fields) =>
    replyEmbed(
      ctx,
      makeEmbed(ctx, { tone: "TWITCH", title, description, fields })
    ),
};

module.exports = {
  // core
  makeEmbed,
  ui,

  // send helpers
  replyEmbed,
  sendEmbed,
  sendEmbedsPaged,

  // builders
  buildListEmbeds,
  buildCodeEmbeds,

  // misc helpers used elsewhere
  truncate,
  fmtDiscordTime,
};
