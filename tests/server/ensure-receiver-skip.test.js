const assert = require("assert");

const ensureReceiver = require("../../packages/figlets-mcp-server/src/utils/ensure-receiver.js");

const original = process.env.FIGLETS_SKIP_RECEIVER;

try {
  process.env.FIGLETS_SKIP_RECEIVER = "1";
  assert.strictEqual(ensureReceiver.isReceiverStartupSkipped(), true, "FIGLETS_SKIP_RECEIVER=1 should skip receiver startup");

  process.env.FIGLETS_SKIP_RECEIVER = "true";
  assert.strictEqual(ensureReceiver.isReceiverStartupSkipped(), true, "FIGLETS_SKIP_RECEIVER=true should skip receiver startup");

  process.env.FIGLETS_SKIP_RECEIVER = "0";
  assert.strictEqual(ensureReceiver.isReceiverStartupSkipped(), false, "FIGLETS_SKIP_RECEIVER=0 should not skip receiver startup");
} finally {
  if (original === undefined) delete process.env.FIGLETS_SKIP_RECEIVER;
  else process.env.FIGLETS_SKIP_RECEIVER = original;
}
