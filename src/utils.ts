import { Buffer } from 'node:buffer';
import * as mammoth from 'mammoth';
import { logger } from '@elizaos/core';
import { getDocument, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';

const PLAIN_TEXT_CONTENT_TYPES = [
  'application/typescript',
  'text/typescript',
  'text/x-python',
  'application/x-python-code',
  'application/yaml',
  'text/yaml',
  'application/x-yaml',
  'application/json',
  'text/markdown',
  'text/csv',
];

const MAX_FALLBACK_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const BINARY_CHECK_BYTES = 1024; // Check first 1KB for binary indicators

/**
 * Extracts text content from a file buffer based on its content type.
 * Supports DOCX, plain text, and provides a fallback for unknown types.
 * PDF should be handled by `convertPdfToTextFromBuffer`.
 */
export async function extractTextFromFileBuffer(
  fileBuffer: Buffer,
  contentType: string,
  originalFilename: string // For logging and context
): Promise<string> {
  const lowerContentType = contentType.toLowerCase();
  logger.debug(
    `[TextUtil] Attempting to extract text from ${originalFilename} (type: ${contentType})`
  );

  if (
    lowerContentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    logger.debug(`[TextUtil] Extracting text from DOCX ${originalFilename} via mammoth.`);
    try {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      logger.debug(
        `[TextUtil] DOCX text extraction complete for ${originalFilename}. Text length: ${result.value.length}`
      );
      return result.value;
    } catch (docxError: any) {
      const errorMsg = `[TextUtil] Failed to parse DOCX file ${originalFilename}: ${docxError.message}`;
      logger.error(errorMsg, docxError.stack);
      throw new Error(errorMsg);
    }
  } else if (
    lowerContentType === 'application/msword' ||
    originalFilename.toLowerCase().endsWith('.doc')
  ) {
    // For .doc files, we'll store the content as-is, and just add a message
    // The frontend will handle the display appropriately
    logger.debug(`[TextUtil] Handling Microsoft Word .doc file: ${originalFilename}`);

    // We'll add a descriptive message as a placeholder
    return `[Microsoft Word Document: ${originalFilename}]\n\nThis document was indexed for search but cannot be displayed directly in the browser. The original document content is preserved for retrieval purposes.`;
  } else if (
    lowerContentType.startsWith('text/') ||
    PLAIN_TEXT_CONTENT_TYPES.includes(lowerContentType)
  ) {
    logger.debug(
      `[TextUtil] Extracting text from plain text compatible file ${originalFilename} (type: ${contentType})`
    );
    return fileBuffer.toString('utf-8');
  } else {
    logger.warn(
      `[TextUtil] Unsupported content type: "${contentType}" for ${originalFilename}. Attempting fallback to plain text.`
    );

    if (fileBuffer.length > MAX_FALLBACK_SIZE_BYTES) {
      const sizeErrorMsg = `[TextUtil] File ${originalFilename} (type: ${contentType}) exceeds maximum size for fallback (${MAX_FALLBACK_SIZE_BYTES} bytes). Cannot process as plain text.`;
      logger.error(sizeErrorMsg);
      throw new Error(sizeErrorMsg);
    }

    // Simple binary detection: check for null bytes in the first N bytes
    const initialBytes = fileBuffer.subarray(0, Math.min(fileBuffer.length, BINARY_CHECK_BYTES));
    if (initialBytes.includes(0)) {
      // Check for NUL byte
      const binaryHeuristicMsg = `[TextUtil] File ${originalFilename} (type: ${contentType}) appears to be binary based on initial byte check. Cannot process as plain text.`;
      logger.error(binaryHeuristicMsg);
      throw new Error(binaryHeuristicMsg);
    }

    try {
      const textContent = fileBuffer.toString('utf-8');
      if (textContent.includes('\ufffd')) {
        // Replacement character, indicating potential binary or wrong encoding
        const binaryErrorMsg = `[TextUtil] File ${originalFilename} (type: ${contentType}) seems to be binary or has encoding issues after fallback to plain text (detected \ufffd).`;
        logger.error(binaryErrorMsg);
        throw new Error(binaryErrorMsg); // Throw error for likely binary content
      }
      logger.debug(
        `[TextUtil] Successfully processed unknown type ${contentType} as plain text after fallback for ${originalFilename}.`
      );
      return textContent;
    } catch (fallbackError: any) {
      // If the initial toString failed or if we threw due to \ufffd
      const finalErrorMsg = `[TextUtil] Unsupported content type: ${contentType} for ${originalFilename}. Fallback to plain text also failed or indicated binary content.`;
      logger.error(finalErrorMsg, fallbackError.message ? fallbackError.stack : undefined);
      throw new Error(finalErrorMsg);
    }
  }
}

/**
 * Converts a PDF file buffer to text content.
 * Requires pdfjs-dist to be properly configured, especially its worker.
 */
/**
 * Converts a PDF Buffer to text with enhanced formatting preservation.
 *
 * @param {Buffer} pdfBuffer - The PDF Buffer to convert to text
 * @param {string} [filename] - Optional filename for logging purposes
 * @returns {Promise<string>} Text content of the PDF
 */
export async function convertPdfToTextFromBuffer(
  pdfBuffer: Buffer,
  filename?: string
): Promise<string> {
  const docName = filename || 'unnamed-document';
  logger.debug(`[PdfService] Starting conversion for ${docName}`);

  try {
    const uint8Array = new Uint8Array(pdfBuffer);
    const pdf: PDFDocumentProxy = await getDocument({ data: uint8Array }).promise;
    const numPages = pdf.numPages;
    const textPages: string[] = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      logger.debug(`[PdfService] Processing page ${pageNum}/${numPages}`);
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Group text items by their y-position to maintain line structure
      const lineMap = new Map<number, TextItem[]>();

      textContent.items.filter(isTextItem).forEach((item) => {
        // Round y-position to account for small variations in the same line
        const yPos = Math.round(item.transform[5]);
        if (!lineMap.has(yPos)) {
          lineMap.set(yPos, []);
        }
        lineMap.get(yPos)!.push(item);
      });

      // Sort lines by y-position (top to bottom) and items within lines by x-position (left to right)
      const sortedLines = Array.from(lineMap.entries())
        .sort((a, b) => b[0] - a[0]) // Reverse sort for top-to-bottom
        .map(([_, items]) =>
          items
            .sort((a, b) => a.transform[4] - b.transform[4])
            .map((item) => item.str)
            .join(' ')
        );

      textPages.push(sortedLines.join('\n'));
    }

    const fullText = textPages.join('\n\n').replace(/\s+/g, ' ').trim();
    logger.debug(`[PdfService] Conversion complete for ${docName}, length: ${fullText.length}`);
    return fullText;
  } catch (error: any) {
    logger.error(`[PdfService] Error converting PDF ${docName}:`, error.message);
    throw new Error(`Failed to convert PDF to text: ${error.message}`);
  }
}

/**
 * Determines if a file should be treated as binary based on its content type and filename
 * @param contentType MIME type of the file
 * @param filename Original filename
 * @returns True if the file should be treated as binary (base64 encoded)
 */
export function isBinaryContentType(contentType: string, filename: string): boolean {
  // Text-based content types that should NOT be treated as binary
  const textContentTypes = [
    'text/',
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/x-yaml',
    'application/x-sh',
  ];

  // Check if it's a text-based MIME type
  const isTextMimeType = textContentTypes.some((type) => contentType.includes(type));
  if (isTextMimeType) {
    return false;
  }

  // Binary content types
  const binaryContentTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
    'image/',
    'audio/',
    'video/',
  ];

  // Check MIME type
  const isBinaryMimeType = binaryContentTypes.some((type) => contentType.includes(type));

  if (isBinaryMimeType) {
    return true;
  }

  // Check file extension as fallback
  const fileExt = filename.split('.').pop()?.toLowerCase() || '';

  // Text file extensions that should NOT be treated as binary
  const textExtensions = [
    'txt',
    'md',
    'markdown',
    'json',
    'xml',
    'html',
    'htm',
    'css',
    'js',
    'ts',
    'jsx',
    'tsx',
    'yaml',
    'yml',
    'toml',
    'ini',
    'cfg',
    'conf',
    'sh',
    'bash',
    'zsh',
    'fish',
    'py',
    'rb',
    'go',
    'rs',
    'java',
    'c',
    'cpp',
    'h',
    'hpp',
    'cs',
    'php',
    'sql',
    'r',
    'swift',
    'kt',
    'scala',
    'clj',
    'ex',
    'exs',
    'vim',
    'env',
    'gitignore',
    'dockerignore',
    'editorconfig',
    'log',
    'csv',
    'tsv',
    'properties',
    'gradle',
    'sbt',
    'makefile',
    'dockerfile',
    'vagrantfile',
    'gemfile',
    'rakefile',
    'podfile',
    'csproj',
    'vbproj',
    'fsproj',
    'sln',
    'pom',
  ];

  // If it's a known text extension, it's not binary
  if (textExtensions.includes(fileExt)) {
    return false;
  }

  // Binary file extensions
  const binaryExtensions = [
    'pdf',
    'docx',
    'doc',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'zip',
    'rar',
    '7z',
    'tar',
    'gz',
    'bz2',
    'xz',
    'jpg',
    'jpeg',
    'png',
    'gif',
    'bmp',
    'svg',
    'ico',
    'webp',
    'mp3',
    'mp4',
    'avi',
    'mov',
    'wmv',
    'flv',
    'wav',
    'flac',
    'ogg',
    'exe',
    'dll',
    'so',
    'dylib',
    'bin',
    'dat',
    'db',
    'sqlite',
  ];

  return binaryExtensions.includes(fileExt);
}

/**
 * Check if the input is a TextItem.
 *
 * @param item - The input item to check.
 * @returns A boolean indicating if the input is a TextItem.
 */
function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item;
}

/**
 * Fetches content from a URL and returns it as base64 encoded string
 * @param url URL to fetch content from
 * @returns Object containing base64 encoded content and content type
 */
export async function fetchUrlContent(url: string): Promise<{ content: string; contentType: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Knowledge-Plugin/1.0',
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Content = buffer.toString('base64');
    
    logger.debug(`[TextUtil] Successfully fetched URL: ${url} (${contentType}), size: ${buffer.length} bytes`);
    return { content: base64Content, contentType };
  } catch (error: any) {
    logger.error(`[TextUtil] Error fetching URL ${url}: ${error.message}`);
    throw new Error(`Failed to fetch content from URL: ${error.message}`);
  }
}
