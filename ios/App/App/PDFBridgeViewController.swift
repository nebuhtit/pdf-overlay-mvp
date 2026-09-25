import Capacitor

final class PDFBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(IncomingFilesPlugin())
    }
}
