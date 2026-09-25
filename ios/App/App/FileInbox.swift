import Foundation
import UniformTypeIdentifiers

extension Notification.Name {
    static let incomingPDFsChanged = Notification.Name("IncomingPDFsChanged")
}

enum FileInbox {
    private static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("IncomingPDFs", isDirectory: true)
    }

    static func stage(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        for source in urls where source.pathExtension.lowercased() == "pdf" {
            let accessing = source.startAccessingSecurityScopedResource()
            defer {
                if accessing { source.stopAccessingSecurityScopedResource() }
            }

            let safeName = source.lastPathComponent.replacingOccurrences(of: "/", with: "-")
            var destination = directory.appendingPathComponent(safeName)
            if FileManager.default.fileExists(atPath: destination.path) {
                let stem = destination.deletingPathExtension().lastPathComponent
                destination = directory.appendingPathComponent("\(stem)-\(UUID().uuidString.prefix(8)).pdf")
            }

            let coordinator = NSFileCoordinator()
            var coordinationError: NSError?
            coordinator.coordinate(readingItemAt: source, options: [], error: &coordinationError) { readableURL in
                try? FileManager.default.copyItem(at: readableURL, to: destination)
            }
        }

        NotificationCenter.default.post(name: .incomingPDFsChanged, object: nil)
    }

    static func list() -> [[String: String]] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .contentTypeKey]
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        )) ?? []

        return urls
            .filter { $0.pathExtension.lowercased() == "pdf" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
            .map { ["name": $0.lastPathComponent, "uri": $0.absoluteString] }
    }

    static func clear(names: [String]) {
        for name in names {
            let safeName = URL(fileURLWithPath: name).lastPathComponent
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(safeName))
        }
    }
}
