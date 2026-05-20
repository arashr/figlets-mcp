const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-receiver-dev-bridge-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;
delete process.env.FIGLETS_DEV_BRIDGE;

const receiverPath = path.resolve(__dirname, "../../packages/figma-bridge-plugin/src/receiver.js");
delete require.cache[require.resolve(receiverPath)];
const server = require(receiverPath);

module.exports = new Promise((resolve, reject) => {
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    const payload = JSON.stringify({ names: ["type/body/md"] });

    const req = http.request(
      `http://127.0.0.1:${port}/request-remove-text-styles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            assert.strictEqual(res.statusCode, 404);
            const parsed = JSON.parse(body);
            assert.match(parsed.error || "", /developer-only/i);
            cleanup();
          } catch (err) {
            cleanup(err);
          }
        });
      }
    );

    req.on("error", cleanup);
    req.write(payload);
    req.end();

    function cleanup(err) {
      delete process.env.FIGLETS_LOCAL_DIR;
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      server.close(() => {
        if (err) reject(err);
        else resolve();
      });
    }
  });
});
