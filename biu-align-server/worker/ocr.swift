import AVFoundation
import Foundation
import Vision

// 用法：ocr <视频> <输出.jsonl>
// 每 0.5 秒取一帧、整帧放大 2 倍后用 Vision 识别文字，每行输出 {"t","text","conf","box":[x,y,w,h]}。
// 中文只返回 1 个候选，靠多帧投票纠错（见 screen_lyrics.py）；关掉语言纠正，否则会把填词改回常见词。
// 放大 2 倍是 480p 小字的实测最优，3 倍和裁底部都没有更好。

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("usage: ocr <video> <out.jsonl>\n".data(using: .utf8)!)
    exit(2)
}
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
FileManager.default.createFile(atPath: args[2], contents: nil)
guard let out = FileHandle(forWritingAtPath: args[2]) else { exit(2) }
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero

let sem = DispatchSemaphore(value: 0)
var duration = 0.0
Task {
    duration = (try? await asset.load(.duration).seconds) ?? 0
    sem.signal()
}
sem.wait()
if duration <= 0 {
    FileHandle.standardError.write("OCR_ERROR unreadable video\n".data(using: .utf8)!)
    exit(3)
}

func upscale(_ img: CGImage) -> CGImage {
    let w = img.width * 2, h = img.height * 2
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()!
}

var t = 0.0
while t < duration {
    autoreleasepool {
        guard let frame = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) else { return }
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.recognitionLanguages = ["zh-Hans", "en-US"]
        req.usesLanguageCorrection = false
        try? VNImageRequestHandler(cgImage: upscale(frame)).perform([req])
        for o in req.results ?? [] {
            guard let c = o.topCandidates(1).first else { continue }
            let b = o.boundingBox
            let row: [String: Any] = [
                "t": (t * 100).rounded() / 100, "text": c.string, "conf": c.confidence,
                "box": [b.origin.x, b.origin.y, b.width, b.height].map { ($0 * 1000).rounded() / 1000 },
            ]
            out.write(try! JSONSerialization.data(withJSONObject: row))
            out.write("\n".data(using: .utf8)!)
        }
    }
    t += 0.5
}
out.closeFile()
