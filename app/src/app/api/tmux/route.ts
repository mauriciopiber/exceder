import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface TmuxSession {
  name: string;
  windows: number;
  created: string;
  attached: boolean;
  lastActivity: string;
  ttydPort: number | null;
}

export interface TtydProcess {
  pid: number;
  port: number;
  session: string;
}

async function getTmuxSessions(): Promise<TmuxSession[]> {
  try {
    const { stdout } = await execAsync(
      'tmux list-sessions -F "#{session_name}|#{session_windows}|#{session_created}|#{session_attached}|#{session_activity}" 2>/dev/null'
    );

    // Get ttyd processes to match with sessions
    const ttydProcesses = await getTtydProcesses();

    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, windows, created, attached, activity] = line.split("|");
        const ttyd = ttydProcesses.find(t => t.session === name);

        return {
          name,
          windows: parseInt(windows) || 1,
          created: new Date(parseInt(created) * 1000).toISOString(),
          attached: attached === "1",
          lastActivity: new Date(parseInt(activity) * 1000).toISOString(),
          ttydPort: ttyd?.port || null,
        };
      });
  } catch {
    return [];
  }
}

async function getTtydProcesses(): Promise<TtydProcess[]> {
  try {
    // Find ttyd processes and extract their port and session
    const { stdout } = await execAsync(
      'ps aux | grep "[t]tyd" | grep -v grep'
    );

    const processes: TtydProcess[] = [];

    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      const pidMatch = line.match(/^\S+\s+(\d+)/);
      const portMatch = line.match(/-p\s+(\d+)/);
      const sessionMatch = line.match(/tmux\s+(?:new\s+-A\s+-s|attach\s+-t)\s+(\S+)/);

      if (pidMatch && portMatch) {
        processes.push({
          pid: parseInt(pidMatch[1]),
          port: parseInt(portMatch[1]),
          session: sessionMatch?.[1] || "unknown",
        });
      }
    }

    return processes;
  } catch {
    return [];
  }
}

export async function GET() {
  const sessions = await getTmuxSessions();

  return NextResponse.json({
    sessions,
    summary: {
      total: sessions.length,
      attached: sessions.filter(s => s.attached).length,
      withTtyd: sessions.filter(s => s.ttydPort !== null).length,
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { action, name, cwd, port } = body;

  try {
    switch (action) {
      case "create": {
        // Create a new tmux session
        const sessionName = name || `session-${Date.now()}`;
        const workDir = cwd || process.cwd();

        await execAsync(
          `tmux new-session -d -s "${sessionName}" -c "${workDir}"`
        );

        return NextResponse.json({
          success: true,
          session: sessionName,
          message: `Session "${sessionName}" created`
        });
      }

      case "create-with-ttyd": {
        // Create tmux session and start ttyd for web access
        const sessionName = name || `session-${Date.now()}`;
        const workDir = cwd || process.cwd();
        const ttydPort = port || 7681;

        // Create tmux session
        await execAsync(
          `tmux new-session -d -s "${sessionName}" -c "${workDir}"`
        );

        // Start ttyd pointing to the session
        await execAsync(
          `ttyd -W -p ${ttydPort} tmux attach -t "${sessionName}" &`
        );

        return NextResponse.json({
          success: true,
          session: sessionName,
          ttydPort,
          message: `Session "${sessionName}" created with ttyd on port ${ttydPort}`
        });
      }

      case "start-ttyd": {
        // Start ttyd for an existing session
        const ttydPort = port || 7681;

        // Kill existing ttyd on this port if any
        await execAsync(`lsof -ti:${ttydPort} | xargs kill -9 2>/dev/null || true`);

        // Start ttyd
        await execAsync(
          `ttyd -W -p ${ttydPort} tmux attach -t "${name}" &`
        );

        return NextResponse.json({
          success: true,
          session: name,
          ttydPort,
          message: `ttyd started on port ${ttydPort} for session "${name}"`
        });
      }

      case "stop-ttyd": {
        // Stop ttyd for a session
        const ttydProcesses = await getTtydProcesses();
        const ttyd = ttydProcesses.find(t => t.session === name);

        if (ttyd) {
          await execAsync(`kill ${ttyd.pid}`);
          return NextResponse.json({
            success: true,
            message: `ttyd stopped for session "${name}"`
          });
        }

        return NextResponse.json({
          success: false,
          message: `No ttyd found for session "${name}"`
        });
      }

      case "kill": {
        // Kill a tmux session
        await execAsync(`tmux kill-session -t "${name}"`);

        return NextResponse.json({
          success: true,
          message: `Session "${name}" killed`
        });
      }

      case "send-keys": {
        // Send keys to a tmux session (for sending commands)
        const { keys, enter = true } = body;
        const enterKey = enter ? " Enter" : "";

        await execAsync(
          `tmux send-keys -t "${name}" "${keys}"${enterKey}`
        );

        return NextResponse.json({
          success: true,
          message: `Keys sent to session "${name}"`
        });
      }

      default:
        return NextResponse.json(
          { success: false, message: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
