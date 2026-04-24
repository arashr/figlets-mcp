const { handleInspectComponent } = require("../tools/inspect-component.js");

async function main() {
  try {
    process.stdout.write("Requesting active selection from Figma...\n");
    const result = await handleInspectComponent();
    process.stdout.write(result.content[0].text + "\n");
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
