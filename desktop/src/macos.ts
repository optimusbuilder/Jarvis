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

/**
 * Sets the system volume (0-100).
 */
export async function setSystemVolume(volumeTarget: number): Promise<string> {
  const vol = Math.max(0, Math.min(100, volumeTarget));
  // AppleScript expects a volume between 0 and 100
  const script = `set volume output volume ${vol}`;

  const { stderr } = await execFileAsync("osascript", ["-e", script]);
  if (stderr) {
    throw new Error(stderr);
  }
  return `System volume set to ${vol}%`;
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Sends an iMessage to a contact by finding their number using the native macOS Contacts framework.
 */
export async function sendIMessage(contactName: string, message: string): Promise<string> {
  const swiftScript = `
import Contacts
import Foundation

let args = CommandLine.arguments
if args.count < 2 { exit(1) }
let searchTerm = args[1].lowercased()

let store = CNContactStore()
let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactPhoneNumbersKey] as [CNKeyDescriptor]
let request = CNContactFetchRequest(keysToFetch: keys)
var bestMatch: (name: String, number: String)? = nil

do {
    try store.enumerateContacts(with: request) { (contact, stop) in
        let fullName = "\\(contact.givenName) \\(contact.familyName)".trimmingCharacters(in: .whitespaces)
        if fullName.lowercased().contains(searchTerm) {
            for phone in contact.phoneNumbers {
                bestMatch = (name: fullName, number: phone.value.stringValue)
                stop.pointee = true
                break
            }
        }
    }
} catch { exit(1) }

if let match = bestMatch {
    let nameEsc = match.name.replacingOccurrences(of: "\\"", with: "\\\\\\\"")
    let numEsc = match.number.replacingOccurrences(of: "\\"", with: "\\\\\\\"")
    print("{\\"name\\": \\"\\(nameEsc)\\", \\"number\\": \\"\\(numEsc)\\"}")
} else {
    print("NOT_FOUND")
}
`;

  // Write temporary swift script
  const tmpPath = path.join(os.tmpdir(), `jarvis_contact_${Date.now()}.swift`);
  await fs.promises.writeFile(tmpPath, swiftScript, 'utf8');

  let lookupOut = "";
  try {
    const { stdout, stderr } = await execFileAsync("swift", [tmpPath, contactName]);
    lookupOut = stdout.trim();
    if (stderr && !lookupOut) throw new Error(stderr);
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => { });
  }

  if (lookupOut === "NOT_FOUND" || !lookupOut) {
    throw new Error(`Could not find any contact matching '${contactName}' in your Contacts.`);
  }

  const contactInfo = JSON.parse(lookupOut);
  const safeName = contactInfo.name;

  // Normalize the number: keep only '+' and digits
  const rawNumber = contactInfo.number || "";
  const normalizedNumber = rawNumber.replace(/[^\\d+]/g, "");

  // Send the message using pure AppleScript, explicitly forcing the "iMessage" service
  const safeMessage = message.replace(/"/g, '\\"');
  const sendScript = `
    tell application "Messages"
      set targetService to 1st service whose service type = iMessage
      set targetBuddy to buddy "${normalizedNumber}" of targetService
      send "${safeMessage}" to targetBuddy
    end tell
  `;

  try {
    const { stderr: sendErr } = await execFileAsync("osascript", ["-e", sendScript]);
    if (sendErr) throw new Error(sendErr);
    return `Sent message to ${safeName}`;
  } catch (e: any) {
    throw new Error("Failed to send message to " + safeName + ": " + e.message);
  }
}
