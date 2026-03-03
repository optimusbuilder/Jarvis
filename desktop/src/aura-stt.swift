import Foundation
import Speech

// AURA Speech-to-Text using Apple's SFSpeechRecognizer
// Usage: aura-stt <audio_file_path>
// Outputs transcript to stdout

guard CommandLine.arguments.count >= 2 else {
    fputs("Usage: aura-stt <audio_file_path>\n", stderr)
    exit(1)
}

let audioPath = CommandLine.arguments[1]
let audioURL = URL(fileURLWithPath: audioPath)

guard FileManager.default.fileExists(atPath: audioPath) else {
    fputs("ERROR: File not found: \(audioPath)\n", stderr)
    exit(1)
}

let semaphore = DispatchSemaphore(value: 0)

SFSpeechRecognizer.requestAuthorization { status in
    switch status {
    case .authorized:
        break
    case .denied:
        fputs("ERROR: Speech recognition permission denied. Go to System Settings > Privacy & Security > Speech Recognition and enable it.\n", stderr)
        exit(2)
    case .restricted:
        fputs("ERROR: Speech recognition is restricted on this device.\n", stderr)
        exit(2)
    case .notDetermined:
        fputs("ERROR: Speech recognition authorization not determined.\n", stderr)
        exit(2)
    @unknown default:
        fputs("ERROR: Unknown authorization status.\n", stderr)
        exit(2)
    }

    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) else {
        fputs("ERROR: Could not create speech recognizer for en-US.\n", stderr)
        exit(1)
    }

    guard recognizer.isAvailable else {
        fputs("ERROR: Speech recognizer is not available.\n", stderr)
        exit(1)
    }

    let request = SFSpeechURLRecognitionRequest(url: audioURL)
    request.shouldReportPartialResults = false
    request.addsPunctuation = true

    // Use on-device recognition if available (faster, private)
    if #available(macOS 13.0, *) {
        request.requiresOnDeviceRecognition = false // allow cloud fallback for accuracy
    }

    recognizer.recognitionTask(with: request) { result, error in
        if let error = error {
            fputs("ERROR: \(error.localizedDescription)\n", stderr)
            semaphore.signal()
            return
        }

        guard let result = result else { return }

        if result.isFinal {
            let transcript = result.bestTranscription.formattedString
            print(transcript)
            semaphore.signal()
        }
    }
}

// Wait for recognition to complete (max 30 seconds)
let timeout = DispatchTime.now() + 30
if semaphore.wait(timeout: timeout) == .timedOut {
    fputs("ERROR: Speech recognition timed out after 30 seconds.\n", stderr)
    exit(1)
}

exit(0)
