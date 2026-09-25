import Capacitor
import Foundation

@objc(IncomingFilesPlugin)
public class IncomingFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IncomingFilesPlugin"
    public let jsName = "IncomingFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private var observer: NSObjectProtocol?

    @objc override public func load() {
        observer = NotificationCenter.default.addObserver(
            forName: .incomingPDFsChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("incomingFiles", data: [:])
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    @objc func list(_ call: CAPPluginCall) {
        call.resolve(["files": FileInbox.list()])
    }

    @objc func clear(_ call: CAPPluginCall) {
        FileInbox.clear(names: call.getArray("names", String.self) ?? [])
        call.resolve()
    }
}
