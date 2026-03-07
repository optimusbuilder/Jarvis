import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PermissionStatus = {
  accessibility: boolean | null;
  platform_supported: boolean;
};

export async function getFrontmostAppName(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to get name of first application process whose frontmost is true'
    ]);
    const name = stdout.trim();
    return name.length ? name : null;
  } catch {
    return null;
  }
}

export async function getPermissionStatus(): Promise<PermissionStatus> {
  if (process.platform !== "darwin") {
    return {
      accessibility: null,
      platform_supported: false
    };
  }

  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to UI elements enabled'
    ]);
    const value = stdout.trim().toLowerCase();
    return {
      accessibility: value === "true",
      platform_supported: true
    };
  } catch {
    return {
      accessibility: false,
      platform_supported: true
    };
  }
}

export async function openApp(name: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("open_app is only implemented for macOS in v1");
  }
  await execFileAsync("open", ["-a", name]);
}

export async function openPath(path: string): Promise<void> {
  await execFileAsync("open", [expandUserPath(path)]);
}

export async function openUrl(url: string): Promise<void> {
  await execFileAsync("open", [url]);
}

function expandUserPath(input: string): string {
  if (input === "~") return process.env.HOME ?? input;
  if (input.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) return input;
    return `${home}/${input.slice(2)}`;
  }
  return input;
}

export async function addCalendarEvent(
  title: string,
  startDateIso: string,
  endDateIso: string,
  notes: string = ""
): Promise<string> {
  const script = `
    var app = Application('Calendar');
    var title = ${JSON.stringify(title)};
    var start = new Date(${JSON.stringify(startDateIso)});
    var end = new Date(${JSON.stringify(endDateIso)});
    var notes = ${JSON.stringify(notes)};
    
    var cals = app.calendars;
    if (cals.length === 0) throw new Error("No calendars found");
    var targetCal = null;
    for (var i = 0; i < cals.length; i++) {
        var c = cals[i];
        if (c.name() === "Home" || c.name() === "Calendar" || c.name() === "Work") {
            targetCal = c;
            break;
        }
    }
    if (!targetCal) targetCal = cals[0];

    var newEvent = app.Event({
        summary: title,
        startDate: start,
        endDate: end,
        description: notes
    });
    
    app.calendars.byName(targetCal.name()).events.push(newEvent);
    targetCal.name();
  `;

  const { stdout, stderr } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script]);
  if (stderr && !stdout) {
    throw new Error(stderr);
  }
  return stdout.trim();
}
