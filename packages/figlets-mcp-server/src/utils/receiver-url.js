"use strict";

const DEFAULT_RECEIVER_PORT = 17337;
const DEFAULT_RECEIVER_HOST = "127.0.0.1";

function getReceiverPort() {
  const raw = process.env.FIGLETS_RECEIVER_PORT;
  const parsed = raw ? Number(raw) : DEFAULT_RECEIVER_PORT;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RECEIVER_PORT;
}

function getReceiverUrl() {
  if (process.env.FIGLETS_RECEIVER_URL) return process.env.FIGLETS_RECEIVER_URL;
  return `http://${DEFAULT_RECEIVER_HOST}:${getReceiverPort()}`;
}

module.exports = {
  DEFAULT_RECEIVER_HOST,
  DEFAULT_RECEIVER_PORT,
  getReceiverPort,
  getReceiverUrl,
};
