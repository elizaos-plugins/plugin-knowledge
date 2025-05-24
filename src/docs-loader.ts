import { logger, UUID, createUniqueUuid } from "@elizaos/core";
import * as fs from "fs";
import * as path from "path";
import { KnowledgeService } from "./service.ts";
import { AddKnowledgeOptions } from "./types.ts";

/**
 * Get the knowledge path from environment or default to ./docs
 */
export function getKnowledgePath(): string {
  const envPath = process.env.KNOWLEDGE_PATH;

  if (envPath) {
    // Resolve relative paths from current working directory
    const resolvedPath = path.resolve(envPath);

    if (!fs.existsSync(resolvedPath)) {
      logger.warn(
        `Knowledge path from environment variable does not exist: ${resolvedPath}`
      );
      logger.warn(
        "Please create the directory or update KNOWLEDGE_PATH environment variable"
      );
    }

    return resolvedPath;
  }

  // Default to docs folder in current working directory
  const defaultPath = path.join(process.cwd(), "docs");

  if (!fs.existsSync(defaultPath)) {
    logger.info(`Default docs folder does not exist at: ${defaultPath}`);
    logger.info("To use the knowledge plugin, either:");
    logger.info('1. Create a "docs" folder in your project root');
    logger.info(
      "2. Set KNOWLEDGE_PATH environment variable to your documents folder"
    );
  }

  return defaultPath;
}

/**
 * Load documents from the knowledge path
 */
export async function loadDocsFromPath(
  service: KnowledgeService,
  agentId: UUID,
  worldId?: UUID
): Promise<{ total: number; successful: number; failed: number }> {
  const docsPath = getKnowledgePath();

  if (!fs.existsSync(docsPath)) {
    logger.warn(`Knowledge path does not exist: ${docsPath}`);
    return { total: 0, successful: 0, failed: 0 };
  }

  logger.info(`Loading documents from: ${docsPath}`);

  // Get all files recursively
  const files = getAllFiles(docsPath);

  if (files.length === 0) {
    logger.info("No files found in knowledge path");
    return { total: 0, successful: 0, failed: 0 };
  }

  logger.info(`Found ${files.length} files to process`);

  let successful = 0;
  let failed = 0;

  for (const filePath of files) {
    try {
      const fileName = path.basename(filePath);
      const fileExt = path.extname(filePath).toLowerCase();

      // Skip hidden files and directories
      if (fileName.startsWith(".")) {
        continue;
      }

      // Determine content type
      const contentType = getContentType(fileExt);

      // Skip unsupported file types
      if (!contentType) {
        logger.debug(`Skipping unsupported file type: ${filePath}`);
        continue;
      }

      // Read file
      const fileBuffer = fs.readFileSync(filePath);

      // For binary files, convert to base64
      const isBinary = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(contentType);

      const content = isBinary
        ? fileBuffer.toString("base64")
        : fileBuffer.toString("utf-8");

      // Create knowledge options
      const knowledgeOptions: AddKnowledgeOptions = {
        clientDocumentId: createUniqueUuid(agentId + fileName + Date.now(), fileName),
        contentType,
        originalFilename: fileName,
        worldId: worldId || agentId,
        content,
      };

      // Process the document
      logger.debug(`Processing document: ${fileName}`);
      const result = await service.addKnowledge(knowledgeOptions);

      logger.info(
        `Successfully processed ${fileName}: ${result.fragmentCount} fragments created`
      );
      successful++;
    } catch (error) {
      logger.error(`Failed to process file ${filePath}:`, error);
      failed++;
    }
  }

  logger.info(
    `Document loading complete: ${successful} successful, ${failed} failed out of ${files.length} total`
  );

  return {
    total: files.length,
    successful,
    failed,
  };
}

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dirPath: string, files: string[] = []): string[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and other common directories
        if (
          !["node_modules", ".git", ".vscode", "dist", "build"].includes(
            entry.name
          )
        ) {
          getAllFiles(fullPath, files);
        }
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    logger.error(`Error reading directory ${dirPath}:`, error);
  }

  return files;
}

/**
 * Get content type based on file extension
 */
function getContentType(extension: string): string | null {
  const contentTypes: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/plain",
    ".tson": "text/plain",
    ".xml": "text/plain",
    ".csv": "text/plain",
    ".html": "text/html",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };

  return contentTypes[extension] || null;
}
