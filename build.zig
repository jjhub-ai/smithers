const std = @import("std");

pub fn build(b: *std.Build) void {
    const dev_step = b.step("dev", "Build and launch the Smithers macOS app");

    const xcodebuild = b.addSystemCommand(&.{
        "xcodebuild",
        "-project",
        "apps/desktop/Smithers.xcodeproj",
        "-scheme",
        "Smithers",
        "-configuration",
        "Debug",
        "-derivedDataPath",
        "apps/desktop/build",
        "build",
    });

    const open_app = b.addSystemCommand(&.{
        "open",
        "apps/desktop/build/Build/Products/Debug/Smithers.app",
    });
    open_app.step.dependOn(&xcodebuild.step);

    dev_step.dependOn(&open_app.step);
}
