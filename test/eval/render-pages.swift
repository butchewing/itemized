// Renders each page of a PDF to an 8-bit grayscale PNG with PDFKit, outside the Worker, because the
// open-weights provider takes images, not PDFs. Existing PNGs are left alone: reuse and the extraction
// cache key on the bytes, so a re-render could cost a fresh model call.
//   swift test/eval/render-pages.swift <in.pdf> <out-dir> [dpi=150]
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("usage: render-pages.swift <in.pdf> <out-dir> [dpi]\n".data(using: .utf8)!)
  exit(2)
}
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
let scale = (args.count > 3 ? Double(args[3])! : 150) / 72
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

for i in 0..<doc.pageCount {
  let out = outDir.appendingPathComponent(String(format: "p%02d.png", i + 1))
  if FileManager.default.fileExists(atPath: out.path) { continue }
  let page = doc.page(at: i)!
  let box = page.bounds(for: .mediaBox)
  let w = Int((box.width * scale).rounded()), h = Int((box.height * scale).rounded())
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  ctx.setFillColor(gray: 1, alpha: 1)
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx)
  let dest = CGImageDestinationCreateWithURL(out as CFURL, "public.png" as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
  guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(out.path)") }
}
print(doc.pageCount)
