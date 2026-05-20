const args = process.argv.slice(2)

const command = args[0] === "run" ? args[1] : args[0]

if (command === "start") {
  require("./dist/index.js")
  return
}

console.error(
  `Unsupported runtime command: pnpm ${args.join(" ")}. This image only supports "pnpm start".`,
)
process.exit(1)
