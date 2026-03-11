tell application "Messages"
    set theService to 1st service whose service type = iMessage
    set theBuddy to buddy "+17712330390" of theService
    send "Test from AppleScript buddy" to theBuddy
end tell
