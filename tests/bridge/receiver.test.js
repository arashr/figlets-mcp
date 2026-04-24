const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Use an isolated temp dir so tests never touch .local/figma-data.json
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-receiver-test-"));
const TEMP_FILE = path.join(TEMP_DIR, "figma-data.json");
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

const server = require("../../packages/figma-bridge-plugin/src/receiver.js");

module.exports = new Promise((resolve, reject) => {
  // Start server on a random port for testing
  server.listen(0, () => {
    const port = server.address().port;
    const testData = JSON.stringify({ test: "data", ts: Date.now() });

    const req = http.request(
      `http://localhost:${port}/sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(testData)
        }
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => { responseBody += chunk; });
        res.on("end", () => {
          try {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(JSON.parse(responseBody).success, true);

            // Verify file was written to the isolated temp location
            assert.strictEqual(fs.existsSync(TEMP_FILE), true);
            const writtenData = fs.readFileSync(TEMP_FILE, "utf-8");
            assert.strictEqual(writtenData, testData);

            server.close(() => {
              fs.rmSync(TEMP_DIR, { recursive: true, force: true });
              delete process.env.FIGLETS_LOCAL_DIR;
              resolve();
            });
          } catch (err) {
            server.close(() => {
              fs.rmSync(TEMP_DIR, { recursive: true, force: true });
              delete process.env.FIGLETS_LOCAL_DIR;
              reject(err);
            });
          }
        });
      }
    );

    req.on("error", (err) => {
      server.close(() => {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        delete process.env.FIGLETS_LOCAL_DIR;
        reject(err);
      });
    });

    req.write(testData);
    req.end();
  });
});
