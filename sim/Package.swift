// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TacticalFootball",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "TacticalFootball",
            path: "Sources/TacticalFootball"
        )
    ]
)
