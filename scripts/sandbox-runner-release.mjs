import { spawn } from "node:child_process"

const action = process.argv[2]
const image = process.env.BLAME_SANDBOX_RUNNER_IMAGE_TAG
if (!image) throw new Error("BLAME_SANDBOX_RUNNER_IMAGE_TAG is required")
if (!new Set(["build", "release"]).has(action)) throw new Error("Expected build or release")

await command("pnpm", ["--filter", "@blame/sandbox-runner", "build"])

const args = [
  "buildx", "build",
  "--platform", "linux/amd64",
  "--file", "packages/sandbox-runner/Dockerfile",
  "--tag", image,
  ...(action === "release" ? ["--sbom=true", "--provenance=mode=max"] : []),
  action === "release" ? "--push" : "--load",
  ".",
]
await command("docker", args)
if (action === "release") {
  const digest = await output("docker", ["buildx", "imagetools", "inspect", image, "--format", "{{json .Manifest.Digest}}"])
  if (!/^"sha256:[a-f0-9]{64}"$/.test(digest.trim())) throw new Error("Published runner digest is unavailable")
  const immutableImage = `${imageRepository(image)}@${JSON.parse(digest)}`
  await command("grype", [immutableImage, "--fail-on", "critical"])
  await command("cosign", ["sign", "--yes", immutableImage])
  console.log(immutableImage)
}

function imageRepository(value) {
  const withoutDigest = value.split("@", 1)[0]
  const slash = withoutDigest.lastIndexOf("/")
  const colon = withoutDigest.lastIndexOf(":")
  return colon > slash ? withoutDigest.slice(0, colon) : withoutDigest
}

function command(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${program} failed (${code})`)))
  })
}

function output(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "inherit"] })
    let value = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => (value += chunk))
    child.once("error", reject)
    child.once("exit", (code) => code === 0 ? resolve(value) : reject(new Error(`${program} failed (${code})`)))
  })
}
