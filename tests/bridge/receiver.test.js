const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const server = require("../../packages/figma-bridge-plugin/src/receiver.js");

const DEST_DIR = path.resolve(__dirname, "../../.local");
const DEST_FILE = path.join(DEST_DIR, "figma-data.json");

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
            
            // Verify file was written
            assert.strictEqual(fs.existsSync(DEST_FILE), true);
            const writtenData = fs.readFileSync(DEST_FILE, "utf-8");
            assert.strictEqual(writtenData, testData);

            server.close(() => resolve());
          } catch (err) {
            server.close(() => reject(err));
          }
        });
      }
    );

    req.on("error", (err) => {
      server.close(() => reject(err));
    });

    req.write(testData);
    req.end();
  });
});
