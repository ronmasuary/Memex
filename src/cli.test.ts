import path from "node:path";
import { describe, expect, it } from "vitest";
import { run, type Io } from "./cli.js";

/** Capture stdout/stderr from a CLI run. */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t) };
  return { io, out, err };
}

describe("memex mcp-config", () => {
  it("prints a pasteable mcpServers block with resolved absolute paths", async () => {
    const { io, out } = capture();
    const code = await run(["mcp-config", "--vault", "/tmp/some-vault"], io);
    expect(code).toBe(0);

    const block = JSON.parse(out.join("\n")) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    const server = block.mcpServers.memex;
    expect(server).toBeDefined();
    // `command` is the absolute node binary — desktop hosts can't resolve npx / a PATH bin.
    expect(server!.command).toBe(process.execPath);
    expect(path.isAbsolute(server!.args[0]!)).toBe(true);
    expect(server!.args[0]!.replace(/\\/g, "/")).toMatch(/\/mcp\.js$/);
    expect(path.isAbsolute(server!.env.MEMEX_VAULT!)).toBe(true);
  });

  it("honours --name for the server key", async () => {
    const { io, out } = capture();
    await run(["mcp-config", "--name", "brain"], io);
    const block = JSON.parse(out.join("\n")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(block.mcpServers)).toEqual(["brain"]);
  });

  it("points at the Cursor config path for --host cursor", async () => {
    const { io, err } = capture();
    const code = await run(["mcp-config", "--host", "cursor"], io);
    expect(code).toBe(0);
    expect(err.join("\n")).toMatch(/Cursor/);
    expect(err.join("\n").replace(/\\/g, "/")).toMatch(/\.cursor\/mcp\.json/);
  });

  it("rejects an unknown --host", async () => {
    const { io, err } = capture();
    const code = await run(["mcp-config", "--host", "nope"], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/--host must be claude or cursor/);
  });

  it("warns when the target vault has not been initialised", async () => {
    const { io, err } = capture();
    await run(["mcp-config", "--vault", "/definitely/not/a/vault"], io);
    expect(err.join("\n")).toMatch(/is not a Memex vault yet/);
  });
});
