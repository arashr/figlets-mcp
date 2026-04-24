const fs = require("fs");
const path = require("path");
const http = require("http");
const { inspectComponentData } = require("../../../figlets-core/src/index.js");

const inspectComponentTool = {
  name: "inspect_component",
  description: "Inspects the user's currently selected component or frame in Figma. Returns structural data, auto-layout settings, and variant properties. Requires the Figma bridge plugin to be running.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

function handleInspectComponent() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      "http://localhost:1337/request-selection",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const responseData = JSON.parse(body);
              const selectionPath = responseData.path;
              
              if (!fs.existsSync(selectionPath)) {
                throw new Error("Selection data file was not created.");
              }

              const rawData = fs.readFileSync(selectionPath, "utf-8");
              const parsedData = JSON.parse(rawData);

              const normalizedData = {
                target: "figma-selection",
                selection: parsedData.selection || []
              };

              // We pass the selection data to the core logic. 
              const result = inspectComponentData(normalizedData);

              resolve({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                  }
                ]
              });
            } catch (err) {
              reject(new Error(`Failed to parse selection data: ${err.message}`));
            }
          } else {
            reject(new Error(`Selection sync failed with status ${res.statusCode}: ${body}`));
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
  inspectComponentTool,
  handleInspectComponent
};
