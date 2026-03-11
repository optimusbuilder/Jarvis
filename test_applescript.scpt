tell application "Contacts"
    set foundPeople to every person whose first name contains "Moyin"
    if (count of foundPeople) is 0 then
        return "Not found"
    end if
    
    set targetPerson to item 1 of foundPeople
    set targetName to name of targetPerson
    
    if (count of phones of targetPerson) is 0 then
        return "No phone number"
    end if
    
    set targetNumber to value of phone 1 of targetPerson
    return targetName & "|" & targetNumber
end tell
