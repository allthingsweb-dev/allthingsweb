import { getImgMetadata, getImgPlaceholder } from "openimg/node";
import sharp from "sharp";
import convert from "heic-convert";

// Types for our image processing utility
export interface ProcessedImage {
  buffer: Uint8Array;
  metadata: {
    width: number;
    height: number;
    format: string;
  };
  placeholder: string;
  originalFormat: string;
  wasConverted: boolean;
}

export interface ImageProcessorOptions {
  /**
   * Whether to convert unsupported formats (HEIC, HEIF, WebP, AVIF) to PNG
   * @default true
   */
  convertUnsupportedFormats?: boolean;

  /**
   * Target format for conversion. Only used if convertUnsupportedFormats is true
   * @default 'PNG'
   */
  conversionFormat?: "PNG" | "JPEG";

  /**
   * JPEG quality for conversion (0-1). Only used if conversionFormat is 'JPEG'
   * @default 0.9
   */
  jpegQuality?: number;
}

/**
 * Detects if an image format needs conversion for openimg compatibility
 */
function needsConversion(
  fileName: string | null,
  detectedFormat?: string,
): boolean {
  // Check by file extension first
  if (fileName) {
    const extension = fileName.toLowerCase().split(".").pop();
    if (extension && ["heic", "heif", "webp", "avif"].includes(extension)) {
      return true;
    }
  }

  // Check by detected format as fallback
  if (detectedFormat) {
    return ["heic", "heif", "webp", "avif"].includes(
      detectedFormat.toLowerCase(),
    );
  }

  return false;
}

/**
 * Gets the file extension from a filename
 */
function getFileExtension(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() || "";
}

/**
 * Converts image buffer to PNG or JPEG using appropriate conversion method
 */
async function convertImage(
  buffer: Buffer,
  originalFormat: string,
  options: Required<ImageProcessorOptions>,
): Promise<{ buffer: Uint8Array; format: string }> {
  const { conversionFormat, jpegQuality } = options;

  // Use heic-convert for HEIC/HEIF files
  if (["heic", "heif"].includes(originalFormat.toLowerCase())) {
    console.log(
      `Converting ${originalFormat.toUpperCase()} using heic-convert...`,
    );
    const outputBuffer = await convert({
      buffer: buffer as any as ArrayBufferLike,
      format: conversionFormat,
      quality: conversionFormat === "JPEG" ? jpegQuality : 1,
    });
    return {
      buffer: new Uint8Array(outputBuffer),
      format: conversionFormat.toLowerCase(),
    };
  }

  // Use Sharp for other formats (WebP, AVIF, etc.)
  console.log(`Converting ${originalFormat.toUpperCase()} using Sharp...`);
  let sharpInstance = sharp(buffer);

  if (conversionFormat === "JPEG") {
    const jpegBuffer = await sharpInstance
      .jpeg({ quality: Math.round(jpegQuality * 100) })
      .toBuffer();
    return {
      buffer: new Uint8Array(jpegBuffer),
      format: "jpeg",
    };
  } else {
    const pngBuffer = await sharpInstance.png().toBuffer();
    return {
      buffer: new Uint8Array(pngBuffer),
      format: "png",
    };
  }
}

/**
 * Detects the original format of an image buffer
 */
async function detectImageFormat(
  buffer: Buffer,
  fileName?: string,
): Promise<string> {
  try {
    // Try to get format from Sharp first
    const metadata = await sharp(buffer).metadata();
    if (metadata.format) {
      return metadata.format;
    }
  } catch (error) {
    // If Sharp fails, fall back to file extension
    console.log("Sharp metadata detection failed, using file extension");
  }

  // Fall back to file extension
  if (fileName) {
    return getFileExtension(fileName);
  }

  return "unknown";
}

/**
 * Main image processing function that handles format conversion, metadata extraction, and placeholder generation
 */
export async function processImage(
  input: Buffer | Uint8Array | File,
  fileName?: string,
  options: ImageProcessorOptions = {},
): Promise<ProcessedImage> {
  // Set default options
  const opts: Required<ImageProcessorOptions> = {
    convertUnsupportedFormats: true,
    conversionFormat: "PNG",
    jpegQuality: 0.9,
    ...options,
  };

  try {
    // Convert input to Buffer
    let buffer: Buffer;
    let detectedFileName = fileName;

    if (input instanceof File) {
      const arrayBuffer = await input.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      detectedFileName = detectedFileName || input.name;
    } else if (input instanceof Uint8Array) {
      buffer = Buffer.from(input);
    } else {
      buffer = input;
    }

    // Detect original format
    const originalFormat = await detectImageFormat(buffer, detectedFileName);
    console.log(`Detected format: ${originalFormat}`);

    let processedBuffer = new Uint8Array(buffer);
    let wasConverted = false;
    let finalFormat = originalFormat;

    // Convert if needed and enabled
    if (
      opts.convertUnsupportedFormats &&
      needsConversion(detectedFileName || null, originalFormat)
    ) {
      console.log("🔄 Format needs conversion...");
      const converted = await convertImage(buffer, originalFormat, opts);
      processedBuffer = new Uint8Array(converted.buffer);
      finalFormat = converted.format;
      wasConverted = true;
      console.log(`✅ Converted from ${originalFormat} to ${finalFormat}`);
      console.log(
        `Size change: ${buffer.length} -> ${processedBuffer.length} bytes`,
      );
    }

    // Extract metadata from processed buffer
    console.log("📊 Extracting metadata...");
    const metadata = await getImgMetadata(processedBuffer);
    if (!metadata) {
      throw new Error("Failed to extract image metadata");
    }

    const { width, height, format } = metadata;
    console.log(`✅ Metadata: ${width}x${height}, format: ${format}`);

    // Generate placeholder
    console.log("🖼️ Generating placeholder...");
    const placeholder = await getImgPlaceholder(processedBuffer);
    console.log(`✅ Placeholder generated (${placeholder.length} chars)`);

    return {
      buffer: processedBuffer,
      metadata: {
        width,
        height,
        format: finalFormat,
      },
      placeholder,
      originalFormat,
      wasConverted,
    };
  } catch (error) {
    console.error("❌ Error processing image:", error);
    throw new Error(
      `Image processing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Convenience function for processing images from file paths (for scripts)
 */
export async function processImageFromPath(
  filePath: string,
  options?: ImageProcessorOptions,
): Promise<ProcessedImage> {
  const fs = await import("fs");
  const path = await import("path");

  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  return processImage(buffer, fileName, options);
}

/**
 * Convenience function for processing images from Bun files (for scripts using Bun)
 */
export async function processImageFromBunFile(
  filePath: string,
  options?: ImageProcessorOptions,
): Promise<ProcessedImage> {
  const path = await import("path");

  const file = Bun.file(filePath);
  const buffer = await file.bytes();
  const fileName = path.basename(filePath);

  return processImage(Buffer.from(buffer), fileName, options);
}
