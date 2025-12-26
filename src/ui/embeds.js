// src/ui/embeds.js
"use strict";

const { EmbedBuilder } = require("discord.js");
const { safeStr } = require("../validation");

/**
 * Professional embed system for Discord.js
 *
 * UX principles:
 * - Minimal but information-dense
 * - Consistent layout and hierarchy
 * - Context-aware footer (paging vs requester)
 * - Clean empty states
 * - Safe truncation within Discord limits
 * - Works with Message or Interaction contexts
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

// Keep icons subtle: only in title
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
  // Best-effort: chat input + component interactions
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

  // requester label
  const requesterTag =
    ctx?.author?.tag ||
    ctx?.user?.tag ||
    (ctx?.user?.username ? `${ctx.user.username}` : "") ||
    "unknown";

  // guild
  const guildNameRaw = ctx?.guild?.name ? String(ctx.guild.name) : "";

  return {
    botName,
    botIcon,
    requesterTag: safeStr(requesterTag),
    guildNameRaw: safeStr(guildNameRaw),
  };
}

/**
 * Footer modes:
 * - "requester": Requested by X • Guild • Extra
 * - "page": Page x/y • Extra  (minimal for paged lists/exports)
 * - "none": no footer text (rare)
 */
function buildFooterText(ctx, { mode = "requester", extra = "" } = {}) {
  const { requesterTag, guildNameRaw } = resolveContextMeta(ctx);

  const extraSafe = safeStr(extra);
  if (mode === "none") return "";

  if (mode === "page") {
    // For paged embeds, keep it minimal
    return truncate(extraSafe, LIMITS.FOOTER);
  }

  // requester mode
  const parts = [];

  // Avoid "powermatin • powermatin" duplication
  const guild = guildNameRaw;
  const same =
    requesterTag &&
    guild &&
    requesterTag.toLowerCase() === guild.toLowerCase();

  parts.push(`Requested by ${requesterTag}`);
  if (guild && !same) parts.push(guild);
  if (extraSafe) parts.push(extraSafe);

  return truncate(parts.join(" • "), LIMITS.FOOTER);
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

/* ------------------------------ core API ------------------------------ */

/**
 * makeEmbed(ctx, options)
 *
 * Backward compatibility:
 * - supports { footerText, extraFooter } (old style)
 * - supports { footer: { text } } (legacy one-off callers)
 *
 * New options:
 * - density: "compact" | "normal" | "verbose"
 * - footerMode: "requester" | "page" | "none"
 * - chrome: "standard" | "minimal" (author/timestamp)
 */
function makeEmbed(
  ctx,
  {
    tone = "INFO",
    title,
    description,
    fields,
    url,

    // footer (legacy + modern)
    extraFooter,
    footerText,
    footer, // { text }
    footerMode = "requester",

    // visuals
    thumbnailUrl,
    imageUrl,

    // layout knobs
    density = "normal",
    chrome = "standard",
    timestamp = true,
  } = {}
) {
  const meta = resolveContextMeta(ctx);

  const e = new EmbedBuilder();
  e.setColor(toneToColor(tone));

  const useChrome = String(chrome || "standard").toLowerCase() !== "minimal";

  // Consistent header (optional)
  if (useChrome) {
    e.setAuthor({ name: meta.botName, iconURL: meta.botIcon });
  }

  // Thumbnail only when explicitly provided (keeps it clean)
  if (thumbnailUrl) e.setThumbnail(String(thumbnailUrl));
  if (imageUrl) e.setImage(String(imageUrl));

  // Title: icon + text
  if (title) {
    const icon = toneToIcon(tone);
    e.setTitle(truncate(`${icon} ${safeStr(title)}`, LIMITS.TITLE));
  }

  if (url) e.setURL(String(url));

  // Density rules (minimal but complete)
  const dens = String(density || "normal").toLowerCase();
  let desc = safeStr(description);

  if (dens === "compact") {
    // Compact: trim aggressively but keep meaning
    desc = truncate(desc, Math.min(LIMITS.DESC, 900));
  } else if (dens === "verbose") {
    // Verbose: allow full desc (still within Discord limit)
    desc = truncate(desc, LIMITS.DESC);
  } else {
    // Normal
    desc = truncate(desc, LIMITS.DESC);
  }

  if (desc) e.setDescription(desc);

  const normFields = normalizeFields(fields);
  if (normFields.length) e.addFields(normFields);

  // Footer text resolution order:
  // 1) footerText explicit
  // 2) footer?.text legacy
  // 3) buildFooterText(ctx, mode, extraFooter)
  const explicitFooter =
    footerText || footer?.text || buildFooterText(ctx, { mode: footerMode, extra: extraFooter });

  if (explicitFooter) {
    e.setFooter({ text: truncate(String(explicitFooter), LIMITS.FOOTER) });
  }

  if (useChrome && timestamp) e.setTimestamp(new Date());

  return e;
}

/* ---------------------------- send helpers ---------------------------- */

/**
 * replyEmbed(ctx, embed, opts)
 * - Works with Message (reply) and Interaction (reply/followUp)
 * - Keeps allowedMentions safe by default
 */
async function replyEmbed(ctx, embed, opts = {}) {
  const payload = {
    embeds: [embed],
    allowedMentions: { parse: [] },
    ...opts,
  };

  // Message path
  if (isMessageLike(ctx)) {
    return ctx.reply(payload).catch(() => null);
  }

  // Interaction path
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

/**
 * For paging: reply first, then send the rest into the channel.
 * (Keeps current behavior; if you later want Button-based paging, we can add it as a separate module.)
 */
async function sendEmbedsPaged(message, embeds) {
  if (!Array.isArray(embeds) || embeds.length === 0) return;
  await replyEmbed(message, embeds[0]);
  for (let i = 1; i < embeds.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await sendEmbed(message, embeds[i]);
  }
}

/* --------------------------- builder helpers -------------------------- */

function looksShortLines(lines) {
  // Heuristic: good for 2-col layout
  // If most lines are short, 2 columns improves scanability.
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const sample = lines.slice(0, Math.min(30, lines.length));
  const avg = sample.reduce((a, s) => a + safeStr(s).length, 0) / sample.length;
  return avg <= 32;
}

/**
 * buildListEmbeds(message, options)
 *
 * options:
 * - layout: "auto" | "single" | "two-column"
 * - perPage: number (for single layout)
 * - perCol: number (for two-column layout)
 *
 * Notes:
 * - Mentions remain clickable (no code blocks)
 * - Footer uses "page" mode for minimal paging UI
 */
function buildListEmbeds(
  ctx,
  {
    tone = "INFO",
    title = "List",
    headerLines = [],
    lines = [],
    // layout
    layout = "auto",
    perPage = 18,
    perCol = 10,
    // empty state
    emptyTitle,
    emptyHint,
  } = {}
) {
  const cleanLines = (lines || []).map((x) => safeStr(x)).filter(Boolean);

  const header = (headerLines || []).map((x) => safeStr(x)).filter(Boolean).join("\n");

  // Empty state (clean + actionable)
  if (cleanLines.length === 0) {
    const descParts = [];
    if (header) descParts.push(header);
    descParts.push(emptyHint ? safeStr(emptyHint) : "No items to display.");
    return [
      makeEmbed(ctx, {
        tone,
        title: emptyTitle || title,
        description: descParts.join("\n\n"),
        density: "normal",
        footerMode: "requester",
      }),
    ];
  }

  // Decide layout
  const mode = String(layout || "auto").toLowerCase();
  const useTwoCol =
    mode === "two-column" ||
    (mode === "auto" && cleanLines.length > 12 && looksShortLines(cleanLines));

  // Two-column layout using inline fields
  if (useTwoCol) {
    const cols = chunkArray(cleanLines, perCol * 2); // each page holds 2 columns
    const totalPages = Math.max(1, cols.length);

    return cols.map((pageLines, idx) => {
      const left = pageLines.slice(0, perCol);
      const right = pageLines.slice(perCol, perCol * 2);

      const fields = [
        {
          name: " ",
          value: left.length ? left.join("\n") : "—",
          inline: true,
        },
        {
          name: " ",
          value: right.length ? right.join("\n") : "—",
          inline: true,
        },
      ];

      // Keep description minimal: header + count only
      const desc = header ? `${header}\n\nTotal: **${cleanLines.length}**` : `Total: **${cleanLines.length}**`;

      return makeEmbed(ctx, {
        tone,
        title: safeStr(title),
        description: desc,
        fields,
        footerMode: "page",
        extraFooter: `Page ${idx + 1}/${totalPages}`,
      });
    });
  }

  // Single-column layout (classic)
  const chunks = chunkArray(cleanLines, perPage);
  const totalPages = Math.max(1, chunks.length);

  return chunks.map((group, idx) => {
    const body = group.join("\n");
    const desc = header ? `${header}\n\n${body}` : body;

    return makeEmbed(ctx, {
      tone,
      title: `${safeStr(title)} (${cleanLines.length})`,
      description: desc,
      footerMode: "page",
      extraFooter: `Page ${idx + 1}/${totalPages}`,
    });
  });
}

/**
 * buildCodeEmbeds(ctx, options)
 * - Uses code blocks in description
 * - Footer uses "page" mode
 */
function buildCodeEmbeds(ctx, { tone = "INFO", title = "Export", lang = "json", text = "" } = {}) {
  const prefix = `\`\`\`${lang}\n`;
  const suffix = "\n```";

  // ensure we don't exceed description limit
  const budget = Math.max(800, LIMITS.DESC - prefix.length - suffix.length);

  const s = safeStr(text);
  const parts = [];
  for (let i = 0; i < s.length; i += budget) parts.push(s.slice(i, i + budget));

  const totalPages = Math.max(1, parts.length);

  return parts.map((p, idx) =>
    makeEmbed(ctx, {
      tone,
      title: safeStr(title),
      description: `${prefix}${p}${suffix}`,
      footerMode: "page",
      extraFooter: `Page ${idx + 1}/${totalPages}`,
      density: "normal",
    })
  );
}

/* ------------------------- quick UI shortcuts ------------------------- */

const ui = {
  info: (ctx, title, description, fields) =>
    replyEmbed(ctx, makeEmbed(ctx, { tone: "INFO", title, description, fields })),

  success: (ctx, title, description, fields) =>
    replyEmbed(ctx, makeEmbed(ctx, { tone: "SUCCESS", title, description, fields })),

  warn: (ctx, title, description, fields) =>
    replyEmbed(ctx, makeEmbed(ctx, { tone: "WARN", title, description, fields })),

  error: (ctx, title, description, fields) =>
    replyEmbed(ctx, makeEmbed(ctx, { tone: "ERROR", title, description, fields })),

  kick: (ctx, title, description, fields) =>
    replyEmbed(ctx, makeEmbed(ctx, { tone: "KICK", title, description, fields })),

  twitch: (ctx, title, description, fields) =>
    replyEmbed(ctx, makeEmbed(ctx, { tone: "TWITCH", title, description, fields })),
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
