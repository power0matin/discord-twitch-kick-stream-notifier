const axios = require("axios");

const TWITCH_OAUTH_BASE = "https://id.twitch.tv";
const TWITCH_API_BASE = "https://api.twitch.tv/helix";

/**
 * Minimal Twitch Helix client (client credentials flow).
 */
class TwitchClient {
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
    if (!this.enabled)
      throw new Error(
        "Twitch is not configured (missing clientId/clientSecret)."
      );

    const now = Date.now();
    if (this._token && now < this._tokenExpiresAt - 30_000) {
      return this._token;
    }

    const body = new URLSearchParams();
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);
    body.set("grant_type", "client_credentials");

    const resp = await axios.post(`${TWITCH_OAUTH_BASE}/oauth2/token`, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15_000,
    });

    const token = resp.data?.access_token;
    const expiresIn = Number(resp.data?.expires_in ?? 0);
    if (!token) throw new Error("Twitch token response missing access_token");

    this._token = token;
    this._tokenExpiresAt = Date.now() + Math.max(60, expiresIn) * 1000;
    return token;
  }

  async _get(path, params) {
    const token = await this._getAppToken();

    const resp = await axios.get(`${TWITCH_API_BASE}${path}`, {
      params,
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.clientId,
      },
    });

    return resp.data;
  }

  /**
   * Get streams for a list of user logins (max 100).
   * @param {string[]} logins
   * @param {{ gameId?: string }} opts
   */
  async getStreamsByUserLogins(logins, opts = {}) {
    if (!Array.isArray(logins) || logins.length === 0) return [];

    const chunk = logins.slice(0, 100);
    const params = {
      user_login: chunk,
    };
    if (opts.gameId) params.game_id = opts.gameId;

    const data = await this._get("/streams", params);
    return data?.data ?? [];
  }

  /**
   * Optional: global scan for GTA V streams (paginated)
   */
  async getStreamsByGameId(gameId, first = 100, after = undefined) {
    const params = { game_id: gameId, first };
    if (after) params.after = after;
    const data = await this._get("/streams", params);
    return {
      streams: data?.data ?? [],
      cursor: data?.pagination?.cursor ?? null,
    };
  }
}

module.exports = { TwitchClient };
