tell application "Messages"
    set iMessageService to 1st service whose service type = iMessage
    
    -- When using the explicit service, the 'buddy' string format usually expects
    -- adding the explicit '+1' prefix to guarantee property resolution
    set theBuddy to buddy "+17712330390" of iMessageService
    
    send "Explicit iMsg test" to theBuddy
end tell
