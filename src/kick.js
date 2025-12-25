const axios = require("axios");

const KICK_OAUTH_BASE = "https://id.kick.com";
const KICK_API_BASE = "https://api.kick.com/public/v1";

/**
 * Minimal Kick API client (using app access token via client_credentials).
 * Docs: https://docs.kick.com/
 */
class KickClient {
  /**
   * @param {{ clientId?: string, clientSecret?: string }} opts
   */
  constructor(opts) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;

    this._token = null;
    this._tokenExpiresAt = 0;
  }

  get enabled() {
    return Boolean(this.clientId && this.clientSecret);
  }

  async _getAppToken() {
    if (!this.enabled) {
      throw new Error(
        "Kick is not configured (missing clientId/clientSecret)."
      );
    }

    const now = Date.now();
    if (this._token && now < this._tokenExpiresAt - 30_000) {
      return this._token;
    }

    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);

    const resp = await axios.post(`${KICK_OAUTH_BASE}/oauth/token`, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15_000,
    });

    const token = resp.data?.access_token;
    const expiresIn = Number(resp.data?.expires_in ?? 0);
    if (!token) throw new Error("Kick token response missing access_token");

    this._token = token;
    this._tokenExpiresAt = Date.now() + Math.max(60, expiresIn) * 1000;
    return token;
  }

  async _get(path, params) {
    const token = await this._getAppToken();

    const resp = await axios.get(`${KICK_API_BASE}${path}`, {
      params, // can be URLSearchParams or object
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return resp.data;
  }

  /**
   * GET /channels?slug=... (collectionFormat=multi => slug=a&slug=b)
   * @param {string[]} slugs
   */
  async getChannelsBySlugs(slugs) {
    if (!Array.isArray(slugs) || slugs.length === 0) return [];

    // Kick expects "multi" query format: slug=a&slug=b (NOT slug[]=a)
    const qs = new URLSearchParams();
    for (const s of slugs.slice(0, 50)) {
      const v = String(s ?? "").trim();
      if (v) qs.append("slug", v);
    }

    const data = await this._get("/channels", qs);
    return data?.data ?? [];
  }

  /**
   * GET /categories?q=...
   */
  async searchCategories(query, page = 1) {
    const data = await this._get("/categories", { q: query, page });
    return data?.data ?? [];
  }

  /**
   * Find category id by best name match (case-insensitive).
   */
  async findCategoryIdByName(name) {
    const results = await this.searchCategories(name, 1);
    const target = String(name).trim().toLowerCase();

    const exact = results.find(
      (c) =>
        String(c?.name ?? "")
          .trim()
          .toLowerCase() === target
    );
    if (exact?.id) return exact.id;

    return results[0]?.id ?? null;
  }

  /**
   * GET /livestreams?category_id=...&limit=...
   */
  async getLivestreamsByCategoryId(
    categoryId,
    limit = 100,
    sort = "viewer_count"
  ) {
    const data = await this._get("/livestreams", {
      category_id: categoryId,
      limit,
      sort,
    });
    return data?.data ?? [];
  }
}

module.exports = { KickClient };
