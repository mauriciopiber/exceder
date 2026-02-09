import { exec } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execRaw = promisify(exec);

function execAsync(cmd: string, opts?: { timeout?: number }) {
  return execRaw(cmd, { timeout: opts?.timeout ?? 10000 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      // Docker containers
      case "stop-container": {
        const { container } = body;
        if (!container) {
          return NextResponse.json(
            { error: "container name required" },
            { status: 400 },
          );
        }
        await execAsync(`docker stop "${container}"`);
        return NextResponse.json({
          success: true,
          message: `Stopped ${container}`,
        });
      }

      case "stop-containers": {
        const { prefix } = body;
        if (!prefix) {
          return NextResponse.json(
            { error: "prefix required" },
            { status: 400 },
          );
        }
        const { stdout } = await execAsync(
          `docker ps --format "{{.Names}}" | grep "^${prefix}" || true`,
        );
        const names = stdout.trim().split("\n").filter(Boolean);
        if (names.length === 0) {
          return NextResponse.json({
            success: true,
            message: "No matching containers",
          });
        }
        await execAsync(`docker stop ${names.join(" ")}`, { timeout: 30000 });
        return NextResponse.json({
          success: true,
          message: `Stopped ${names.length} containers`,
        });
      }

      // Storybook processes
      case "stop-storybook": {
        const { pid } = body;
        if (!pid) {
          return NextResponse.json({ error: "pid required" }, { status: 400 });
        }
        await execAsync(`kill ${pid}`);
        return NextResponse.json({
          success: true,
          message: `Stopped storybook (pid ${pid})`,
        });
      }

      case "stop-all-storybooks": {
        const { stdout } = await execAsync(
          `ps aux | grep "storybook/dist/bin/dispatcher.js" | grep -v grep | awk '{print $2}' || true`,
        );
        const pids = stdout.trim().split("\n").filter(Boolean);
        if (pids.length === 0) {
          return NextResponse.json({
            success: true,
            message: "No storybooks running",
          });
        }
        await execAsync(`kill ${pids.join(" ")}`);
        return NextResponse.json({
          success: true,
          message: `Stopped ${pids.length} storybooks`,
        });
      }

      // Claude instances
      case "stop-claude": {
        const { pid } = body;
        if (!pid) {
          return NextResponse.json({ error: "pid required" }, { status: 400 });
        }
        // Self-protection: don't kill ourselves
        if (pid === process.pid || pid === process.ppid) {
          return NextResponse.json(
            { error: "Cannot stop own process" },
            { status: 400 },
          );
        }
        await execAsync(`kill ${pid}`);
        return NextResponse.json({
          success: true,
          message: `Stopped claude (pid ${pid})`,
        });
      }

      case "stop-all-claudes": {
        const { stdout } = await execAsync(
          `pgrep -f "claude" 2>/dev/null || true`,
        );
        const pids = stdout.trim().split("\n").filter(Boolean);
        if (pids.length === 0) {
          return NextResponse.json({
            success: true,
            message: "No claude instances running",
          });
        }
        // Filter out ourselves and filter to actual claude CLI processes
        const myPid = process.pid.toString();
        const safePids = pids.filter((p) => p !== myPid);
        if (safePids.length > 0) {
          await execAsync(`kill ${safePids.join(" ")} 2>/dev/null || true`);
        }
        return NextResponse.json({
          success: true,
          message: `Stopped ${safePids.length} claude instances`,
        });
      }

      // Web server processes
      case "stop-web": {
        const { pid } = body;
        if (!pid) {
          return NextResponse.json({ error: "pid required" }, { status: 400 });
        }
        // Self-protection: don't kill exceder
        const { stdout: cmdOut } = await execAsync(
          `ps -p ${pid} -o command= 2>/dev/null || true`,
        );
        if (cmdOut.includes("exceder")) {
          return NextResponse.json(
            { error: "Cannot stop exceder dashboard" },
            { status: 400 },
          );
        }
        await execAsync(`kill ${pid}`);
        return NextResponse.json({
          success: true,
          message: `Stopped web server (pid ${pid})`,
        });
      }

      case "stop-all-web": {
        const { stdout } = await execAsync(
          `ps aux | grep -E "next-server|next dev" | grep -v grep | grep -v exceder | awk '{print $2}' || true`,
        );
        const pids = stdout.trim().split("\n").filter(Boolean);
        if (pids.length === 0) {
          return NextResponse.json({
            success: true,
            message: "No web servers running",
          });
        }
        await execAsync(`kill ${pids.join(" ")}`);
        return NextResponse.json({
          success: true,
          message: `Stopped ${pids.length} web servers`,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Process action failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
