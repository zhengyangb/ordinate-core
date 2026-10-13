import AppKit
import Foundation

let source = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: source), image.size.width > 0, image.size.height > 0 else {
  fatalError("Cannot render the DMG background SVG: \(source.path)")
}

for scale in [1, 2] {
  let width = Int(image.size.width) * scale
  let height = Int(image.size.height) * scale
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: width,
    pixelsHigh: height,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    fatalError("Cannot allocate a \(width)×\(height) DMG background")
  }
  bitmap.size = image.size
  guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("Cannot create the DMG background graphics context")
  }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.imageInterpolation = .high
  image.draw(in: NSRect(origin: .zero, size: image.size), from: .zero, operation: .copy, fraction: 1)
  context.flushGraphics()
  NSGraphicsContext.restoreGraphicsState()

  guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Cannot encode the DMG background PNG")
  }
  let suffix = scale == 1 ? "" : "@2x"
  let output = source.deletingPathExtension().appendingPathExtension("png")
  let destination = output.deletingLastPathComponent().appendingPathComponent(output.deletingPathExtension().lastPathComponent + suffix + ".png")
  try png.write(to: destination, options: .atomic)
  print("Rendered \(destination.path) (\(width)×\(height))")
}
