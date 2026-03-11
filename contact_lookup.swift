import Contacts
import Foundation

let args = CommandLine.arguments
if args.count < 2 {
    print("Error: Provide a name to search")
    exit(1)
}
let searchTerm = args[1].lowercased()

let store = CNContactStore()
let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactPhoneNumbersKey] as [CNKeyDescriptor]

let request = CNContactFetchRequest(keysToFetch: keys)

var bestMatch: (name: String, number: String)? = nil

do {
    try store.enumerateContacts(with: request) { (contact, stop) in
        let fullName = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
        if fullName.lowercased().contains(searchTerm) {
            for phone in contact.phoneNumbers {
                let num = phone.value.stringValue
                bestMatch = (name: fullName, number: num)
                stop.pointee = true
                break
            }
        }
    }
} catch {
    print("Error: \(error.localizedDescription)")
    exit(1)
}

if let match = bestMatch {
    // Print JSON
    let nameEscaped = match.name.replacingOccurrences(of: "\"", with: "\\\"")
    let numEscaped = match.number.replacingOccurrences(of: "\"", with: "\\\"")
    let json = "{\"name\": \"\(nameEscaped)\", \"number\": \"\(numEscaped)\"}"
    print(json)
} else {
    print("Error: No contact found matching '\(searchTerm)'")
    exit(1)
}
