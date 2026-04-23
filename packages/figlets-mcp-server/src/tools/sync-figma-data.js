const http = require("http");

const syncFigmaDataTool = {
  name: "sync_figma_data",
  description: "Triggers the local Figma Bridge plugin to wake up, extract all variables, styles, and components, and save them to the local workspace. This tool will block and wait until the sync is complete.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

function handleSyncFigmaData() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      "http://localhost:1337/request-sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve({
              content: [
                {
                  type: "text",
                  text: "Sync complete! The local Figma data snapshot has been updated."
                }
              ]
            });
          } else {
            reject(new Error(`Sync failed with status ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on("error", (err) => {
      reject(new Error(`Failed to contact local receiver. Is it running? Error: ${err.message}`));
    });

    req.end();
  });
}

module.exports = {
  syncFigmaDataTool,
  handleSyncFigmaData
};
