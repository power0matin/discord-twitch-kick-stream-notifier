"use strict";

/**
 * Modular entrypoint (Phase 1).
 *
 * For now, we load the legacy Stream Notifier module as-is,
 * so behavior stays identical while we modularize the repo structure.
 *
 * Next phases:
 * - Create a single shared Discord client here
 * - Register modules (tickets, fivem status, welcome) on that client
 */
require("./modules/stream-notifier");
require("./modules/fivem");
require("./modules/welcome");
require("./modules/tickets");
