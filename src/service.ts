import {
  Content,
  createLogger,
  createUniqueUuid,
  FragmentMetadata,
  IAgentRuntime,
  KnowledgeItem,
  Memory,
  MemoryMetadata,
  MemoryType,
  Metadata,
  ModelType,
  Semaphore,
  Service,
  splitChunks,
  UUID,
} from '@elizaos/core';
import { loadDocsFromPath } from './docs-loader.ts';
import {
  createDocumentMemory,
  extractTextFromDocument,
  processFragmentsSynchronously,
} from './document-processor.ts';
import { DocumentRepository, FragmentRepository } from './repositories/index.ts';
import type { KnowledgeConfig, LoadResult } from './types.ts';
import { AddKnowledgeOptions } from './types.ts';
import { isBinaryContentType, looksLikeBase64 } from './utils.ts';

const logger = createLogger('KnowledgeService');

/**
 * Knowledge Service - Provides retrieval augmented generation capabilities
 */
export class KnowledgeService extends Service {
  static readonly serviceType = 'knowledge';
  public override config: Metadata;
  private knowledgeConfig: KnowledgeConfig;
  capabilityDescription =
    'Provides Retrieval Augmented Generation capabilities, including knowledge upload and querying.';

  private knowledgeProcessingSemaphore: Semaphore;
  private documentRepo?: DocumentRepository;
  private fragmentRepo?: FragmentRepository;
  private useNewTables: boolean = false; // Feature flag for new implementation

  /**
   * Create a new Knowledge service
   * @param runtime Agent runtime
   */
  constructor(runtime: IAgentRuntime, config?: Partial<KnowledgeConfig>) {
    super(runtime);
    this.knowledgeProcessingSemaphore = new Semaphore(10);

    const parseBooleanEnv = (value: any): boolean => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return value.toLowerCase() === 'true';
      return false; // Default to false if undefined or other type
    };

    this.knowledgeConfig = {
      CTX_KNOWLEDGE_ENABLED: parseBooleanEnv(config?.CTX_KNOWLEDGE_ENABLED),
      LOAD_DOCS_ON_STARTUP: parseBooleanEnv(config?.LOAD_DOCS_ON_STARTUP),
      MAX_INPUT_TOKENS: config?.MAX_INPUT_TOKENS,
      MAX_OUTPUT_TOKENS: config?.MAX_OUTPUT_TOKENS,
      EMBEDDING_PROVIDER: config?.EMBEDDING_PROVIDER,
      TEXT_PROVIDER: config?.TEXT_PROVIDER,
      TEXT_EMBEDDING_MODEL: config?.TEXT_EMBEDDING_MODEL,
    };

    // Store config as Metadata for base class compatibility
    this.config = { ...this.knowledgeConfig } as Metadata;

    // Check if we should use new tables (feature flag)
    this.useNewTables = parseBooleanEnv(runtime.getSetting('KNOWLEDGE_USE_NEW_TABLES'));

    logger.info(
      `KnowledgeService initialized for agent ${this.runtime.agentId} with config:`,
      this.knowledgeConfig,
      `useNewTables: ${this.useNewTables}`
    );

    if (this.knowledgeConfig.LOAD_DOCS_ON_STARTUP) {
      this.loadInitialDocuments().catch((error) => {
        logger.error('Error during initial document loading in KnowledgeService:', error);
      });
    }
  }

  private async loadInitialDocuments(): Promise<void> {
    logger.info(
      `KnowledgeService: Checking for documents to load on startup for agent ${this.runtime.agentId}`
    );
    try {
      // Use a small delay to ensure runtime is fully ready if needed, though constructor implies it should be.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result: LoadResult = await loadDocsFromPath(this as any, this.runtime.agentId);
      if (result.successful > 0) {
        logger.info(
          `KnowledgeService: Loaded ${result.successful} documents from docs folder on startup for agent ${this.runtime.agentId}`
        );
      } else {
        logger.info(
          `KnowledgeService: No new documents found to load on startup for agent ${this.runtime.agentId}`
        );
      }
    } catch (error) {
      logger.error(
        `KnowledgeService: Error loading documents on startup for agent ${this.runtime.agentId}:`,
        error
      );
    }
  }

  /**
   * Start the Knowledge service
   * @param runtime Agent runtime
   * @returns Initialized Knowledge service
   */
  static async start(runtime: IAgentRuntime): Promise<KnowledgeService> {
    logger.info(`Starting Knowledge service for agent: ${runtime.agentId}`);
    const service = new KnowledgeService(runtime);

    // Process character knowledge AFTER service is initialized
    if (service.runtime.character?.knowledge && service.runtime.character.knowledge.length > 0) {
      logger.info(
        `KnowledgeService: Processing ${service.runtime.character.knowledge.length} character knowledge items.`
      );
      const stringKnowledge = service.runtime.character.knowledge.filter(
        (item): item is string => typeof item === 'string'
      );
      // Run in background, don't await here to prevent blocking startup
      await service.processCharacterKnowledge(stringKnowledge).catch((err) => {
        logger.error(
          `KnowledgeService: Error processing character knowledge during startup: ${err.message}`,
          err
        );
      });
    } else {
      logger.info(
        `KnowledgeService: No character knowledge to process for agent ${runtime.agentId}.`
      );
    }
    return service;
  }

  /**
   * Stop the Knowledge service
   * @param runtime Agent runtime
   */
  static async stop(runtime: IAgentRuntime): Promise<void> {
    logger.info(`Stopping Knowledge service for agent: ${runtime.agentId}`);
    const service = runtime.getService(KnowledgeService.serviceType);
    if (!service) {
      logger.warn(`KnowledgeService not found for agent ${runtime.agentId} during stop.`);
    }
    // If we need to perform specific cleanup on the KnowledgeService instance
    if (service instanceof KnowledgeService) {
      await service.stop();
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    logger.info(`Knowledge service stopping for agent: ${this.runtime.agentId}`);
  }

  /**
   * Add knowledge to the system
   * @param options Knowledge options
   * @returns Promise with document processing result
   */
  async addKnowledge(options: AddKnowledgeOptions): Promise<{
    clientDocumentId: string;
    storedDocumentMemoryId: UUID;
    fragmentCount: number;
  }> {
    // Use agentId from options if provided (from frontend), otherwise fall back to runtime
    const agentId = options.agentId || (this.runtime.agentId as UUID);
    logger.info(
      `KnowledgeService processing document for agent: ${agentId}, file: ${options.originalFilename}, type: ${options.contentType}`
    );

    // Check if document already exists in database using clientDocumentId as the primary key for "documents" table
    try {
      // The `getMemoryById` in runtime usually searches generic memories.
      // We need a way to specifically query the 'documents' table or ensure clientDocumentId is unique across all memories if used as ID.
      // For now, assuming clientDocumentId is the ID used when creating document memory.
      const existingDocument = await this.runtime.getMemoryById(options.clientDocumentId);
      if (existingDocument && existingDocument.metadata?.type === MemoryType.DOCUMENT) {
        logger.info(
          `Document ${options.originalFilename} with ID ${options.clientDocumentId} already exists. Skipping processing.`
        );

        // Count existing fragments for this document
        const fragments = await this.runtime.getMemories({
          tableName: 'knowledge',
          // Assuming fragments store original documentId in metadata.documentId
          // This query might need adjustment based on actual fragment metadata structure.
          // A more robust way would be to query where metadata.documentId === options.clientDocumentId
        });

        // Filter fragments related to this specific document
        const relatedFragments = fragments.filter(
          (f) =>
            f.metadata?.type === MemoryType.FRAGMENT &&
            (f.metadata as FragmentMetadata).documentId === options.clientDocumentId
        );

        return {
          clientDocumentId: options.clientDocumentId,
          storedDocumentMemoryId: existingDocument.id as UUID,
          fragmentCount: relatedFragments.length,
        };
      }
    } catch (error) {
      // Document doesn't exist or other error, continue with processing
      logger.debug(
        `Document ${options.clientDocumentId} not found or error checking existence, proceeding with processing: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return this.processDocument(options);
  }

  /**
   * Process a document regardless of type - Called by public addKnowledge
   * @param options Document options
   * @returns Promise with document processing result
   */
  private async processDocument({
    agentId: passedAgentId,
    clientDocumentId,
    contentType,
    originalFilename,
    worldId,
    content,
    roomId,
    entityId,
    metadata,
  }: AddKnowledgeOptions): Promise<{
    clientDocumentId: string;
    storedDocumentMemoryId: UUID;
    fragmentCount: number;
  }> {
    // Use agentId from options if provided (from frontend), otherwise fall back to runtime
    const agentId = passedAgentId || (this.runtime.agentId as UUID);

    try {
      logger.debug(
        `KnowledgeService: Processing document ${originalFilename} (type: ${contentType}) via processDocument for agent: ${agentId}`
      );

      let fileBuffer: Buffer | null = null;
      let extractedText: string;
      let documentContentToStore: string;
      const isPdfFile =
        contentType === 'application/pdf' || originalFilename.toLowerCase().endsWith('.pdf');

      if (isPdfFile) {
        // For PDFs: extract text for fragments but store original base64 in main document
        try {
          fileBuffer = Buffer.from(content, 'base64');
        } catch (e: any) {
          logger.error(
            `KnowledgeService: Failed to convert base64 to buffer for ${originalFilename}: ${e.message}`
          );
          throw new Error(`Invalid base64 content for PDF file ${originalFilename}`);
        }
        extractedText = await extractTextFromDocument(fileBuffer, contentType, originalFilename);
        documentContentToStore = content; // Store base64 for PDFs
      } else if (isBinaryContentType(contentType, originalFilename)) {
        // For other binary files: extract text and store as plain text
        try {
          fileBuffer = Buffer.from(content, 'base64');
        } catch (e: any) {
          logger.error(
            `KnowledgeService: Failed to convert base64 to buffer for ${originalFilename}: ${e.message}`
          );
          throw new Error(`Invalid base64 content for binary file ${originalFilename}`);
        }
        extractedText = await extractTextFromDocument(fileBuffer, contentType, originalFilename);
        documentContentToStore = extractedText; // Store extracted text for non-PDF binary files
      } else {
        // For text files (including markdown): content is already plain text or needs decoding from base64
        // Routes always send base64, but docs-loader sends plain text

        // First, check if this looks like base64
        if (looksLikeBase64(content)) {
          try {
            // Try to decode from base64
            const decodedBuffer = Buffer.from(content, 'base64');
            // Check if it's valid UTF-8
            const decodedText = decodedBuffer.toString('utf8');

            // Verify the decoded text doesn't contain too many invalid characters
            const invalidCharCount = (decodedText.match(/\ufffd/g) || []).length;
            const textLength = decodedText.length;

            if (invalidCharCount > 0 && invalidCharCount / textLength > 0.1) {
              // More than 10% invalid characters, probably not a text file
              throw new Error('Decoded content contains too many invalid characters');
            }

            logger.debug(`Successfully decoded base64 content for text file: ${originalFilename}`);
            extractedText = decodedText;
            documentContentToStore = decodedText;
          } catch (e) {
            logger.error(
              `Failed to decode base64 for ${originalFilename}: ${e instanceof Error ? e.message : String(e)}`
            );
            // If it looked like base64 but failed to decode properly, this is an error
            throw new Error(
              `File ${originalFilename} appears to be corrupted or incorrectly encoded`
            );
          }
        } else {
          // Content doesn't look like base64, treat as plain text
          logger.debug(`Treating content as plain text for file: ${originalFilename}`);
          extractedText = content;
          documentContentToStore = content;
        }
      }

      if (!extractedText || extractedText.trim() === '') {
        const noTextError = new Error(
          `KnowledgeService: No text content extracted from ${originalFilename} (type: ${contentType}).`
        );
        logger.warn(noTextError.message);
        throw noTextError;
      }

      // Create document memory using the clientDocumentId as the memory ID
      const documentMemory = createDocumentMemory({
        text: documentContentToStore, // Store base64 only for PDFs, plain text for everything else
        agentId,
        clientDocumentId, // This becomes the memory.id
        originalFilename,
        contentType,
        worldId,
        fileSize: fileBuffer ? fileBuffer.length : extractedText.length,
        documentId: clientDocumentId, // Explicitly set documentId in metadata as well
        customMetadata: metadata, // Pass the custom metadata
      });

      const memoryWithScope = {
        ...documentMemory,
        id: clientDocumentId, // Ensure the ID of the memory is the clientDocumentId
        agentId: agentId,
        roomId: roomId || agentId,
        entityId: entityId || agentId,
      };

      logger.debug(
        `KnowledgeService: Creating memory with agentId=${agentId}, entityId=${entityId}, roomId=${roomId}, this.runtime.agentId=${this.runtime.agentId}`
      );
      logger.debug(
        `KnowledgeService: memoryWithScope agentId=${memoryWithScope.agentId}, entityId=${memoryWithScope.entityId}`
      );

      await this.runtime.createMemory(memoryWithScope, 'documents');

      logger.debug(
        `KnowledgeService: Stored document ${originalFilename} (Memory ID: ${memoryWithScope.id})`
      );

      const fragmentCount = await processFragmentsSynchronously({
        runtime: this.runtime,
        documentId: clientDocumentId, // Pass clientDocumentId to link fragments
        fullDocumentText: extractedText,
        agentId,
        contentType,
        roomId: roomId || agentId,
        entityId: entityId || agentId,
        worldId: worldId || agentId,
      });

      logger.info(
        `KnowledgeService: Document ${originalFilename} processed with ${fragmentCount} fragments for agent ${agentId}`
      );

      return {
        clientDocumentId,
        storedDocumentMemoryId: memoryWithScope.id as UUID,
        fragmentCount,
      };
    } catch (error: any) {
      logger.error(
        `KnowledgeService: Error processing document ${originalFilename}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  // --- Knowledge methods moved from AgentRuntime ---

  private async handleProcessingError(error: any, context: string) {
    logger.error(`KnowledgeService: Error ${context}:`, error?.message || error || 'Unknown error');
    throw error;
  }

  async checkExistingKnowledge(knowledgeId: UUID): Promise<boolean> {
    // This checks if a specific memory (fragment or document) ID exists.
    // In the context of processCharacterKnowledge, knowledgeId is a UUID derived from the content.
    const existingDocument = await this.runtime.getMemoryById(knowledgeId);
    return !!existingDocument;
  }

  async getKnowledge(
    message: Memory,
    scope?: { roomId?: UUID; worldId?: UUID; entityId?: UUID }
  ): Promise<KnowledgeItem[]> {
    logger.debug('KnowledgeService: getKnowledge called for message id: ' + message.id);
    if (!message?.content?.text || message?.content?.text.trim().length === 0) {
      logger.warn('KnowledgeService: Invalid or empty message content for knowledge query.');
      return [];
    }

    const embedding = await this.runtime.useModel(ModelType.TEXT_EMBEDDING, {
      text: message.content.text,
    });

    const filterScope: { roomId?: UUID; worldId?: UUID; entityId?: UUID } = {};
    if (scope?.roomId) filterScope.roomId = scope.roomId;
    if (scope?.worldId) filterScope.worldId = scope.worldId;
    if (scope?.entityId) filterScope.entityId = scope.entityId;

    const fragments = await this.runtime.searchMemories({
      tableName: 'knowledge',
      embedding,
      query: message.content.text,
      ...filterScope,
      count: 20,
      match_threshold: 0.1, // TODO: Make configurable
    });

    return fragments
      .filter((fragment) => fragment.id !== undefined) // Ensure fragment.id is defined
      .map((fragment) => ({
        id: fragment.id as UUID, // Cast as UUID after filtering
        content: fragment.content as Content, // Cast if necessary, ensure Content type matches
        similarity: fragment.similarity,
        metadata: fragment.metadata,
        worldId: fragment.worldId,
      }));
  }

  async processCharacterKnowledge(items: string[]): Promise<void> {
    // Wait briefly to allow services to initialize fully
    await new Promise((resolve) => setTimeout(resolve, 1000));
    logger.info(
      `KnowledgeService: Processing ${items.length} character knowledge items for agent ${this.runtime.agentId}`
    );

    const processingPromises = items.map(async (item) => {
      await this.knowledgeProcessingSemaphore.acquire();
      try {
        // For character knowledge, the item itself (string) is the source.
        // A unique ID is generated from this string content.
        const knowledgeId = createUniqueUuid(this.runtime, this.runtime.agentId + item); // Use agentId in seed for uniqueness

        if (await this.checkExistingKnowledge(knowledgeId)) {
          logger.debug(
            `KnowledgeService: Character knowledge item with ID ${knowledgeId} already exists. Skipping.`
          );
          return;
        }

        logger.debug(
          `KnowledgeService: Processing character knowledge for ${this.runtime.character?.name} - ${item.slice(0, 100)}`
        );

        let metadata: MemoryMetadata = {
          type: MemoryType.DOCUMENT, // Character knowledge often represents a doc/fact.
          timestamp: Date.now(),
          source: 'character', // Indicate the source
        };

        const pathMatch = item.match(/^Path: (.+?)(?:\n|\r\n)/);
        if (pathMatch) {
          const filePath = pathMatch[1].trim();
          const extension = filePath.split('.').pop() || '';
          const filename = filePath.split('/').pop() || '';
          const title = filename.replace(`.${extension}`, '');
          metadata = {
            ...metadata,
            path: filePath,
            filename: filename,
            fileExt: extension,
            title: title,
            fileType: `text/${extension || 'plain'}`, // Assume text if not specified
            fileSize: item.length,
          };
        }

        // Using _internalAddKnowledge for character knowledge
        await this._internalAddKnowledge(
          {
            id: knowledgeId, // Use the content-derived ID
            content: {
              text: item,
            },
            metadata,
          },
          undefined,
          {
            // Scope to the agent itself for character knowledge
            roomId: this.runtime.agentId,
            entityId: this.runtime.agentId,
            worldId: this.runtime.agentId,
          }
        );
      } catch (error) {
        await this.handleProcessingError(error, 'processing character knowledge');
      } finally {
        this.knowledgeProcessingSemaphore.release();
      }
    });

    await Promise.all(processingPromises);
    logger.info(
      `KnowledgeService: Finished processing character knowledge for agent ${this.runtime.agentId}.`
    );
  }

  async _internalAddKnowledge(
    item: KnowledgeItem, // item.id here is expected to be the ID of the "document"
    options = {
      targetTokens: 1500, // TODO: Make these configurable, perhaps from plugin config
      overlap: 200,
      modelContextSize: 4096,
    },
    scope = {
      // Default scope for internal additions (like character knowledge)
      roomId: this.runtime.agentId,
      entityId: this.runtime.agentId,
      worldId: this.runtime.agentId,
    }
  ): Promise<void> {
    const finalScope = {
      roomId: scope?.roomId ?? this.runtime.agentId,
      worldId: scope?.worldId ?? this.runtime.agentId,
      entityId: scope?.entityId ?? this.runtime.agentId,
    };

    logger.debug(`KnowledgeService: _internalAddKnowledge called for item ID ${item.id}`);

    // For _internalAddKnowledge, we assume item.content.text is always present
    // and it's not a binary file needing Knowledge plugin's special handling for extraction.
    // This path is for already-textual content like character knowledge or direct text additions.

    const documentMemory: Memory = {
      id: item.id, // This ID should be the unique ID for the document being added.
      agentId: this.runtime.agentId,
      roomId: finalScope.roomId,
      worldId: finalScope.worldId,
      entityId: finalScope.entityId,
      content: item.content,
      metadata: {
        ...(item.metadata || {}), // Spread existing metadata
        type: MemoryType.DOCUMENT, // Ensure it's marked as a document
        documentId: item.id, // Ensure metadata.documentId is set to the item's ID
        timestamp: item.metadata?.timestamp || Date.now(),
      },
      createdAt: Date.now(),
    };

    const existingDocument = await this.runtime.getMemoryById(item.id);
    if (existingDocument) {
      logger.debug(
        `KnowledgeService: Document ${item.id} already exists in _internalAddKnowledge, updating...`
      );
      await this.runtime.updateMemory({
        ...documentMemory,
        id: item.id, // Ensure ID is passed for update
      });
    } else {
      await this.runtime.createMemory(documentMemory, 'documents');
    }

    const fragments = await this.splitAndCreateFragments(
      item, // item.id is the documentId
      options.targetTokens,
      options.overlap,
      finalScope
    );

    let fragmentsProcessed = 0;
    for (const fragment of fragments) {
      try {
        await this.processDocumentFragment(fragment); // fragment already has metadata.documentId from splitAndCreateFragments
        fragmentsProcessed++;
      } catch (error) {
        logger.error(
          `KnowledgeService: Error processing fragment ${fragment.id} for document ${item.id}:`,
          error
        );
      }
    }
    logger.debug(
      `KnowledgeService: Processed ${fragmentsProcessed}/${fragments.length} fragments for document ${item.id}.`
    );
  }

  private async processDocumentFragment(fragment: Memory): Promise<void> {
    try {
      // Add embedding to the fragment
      // Runtime's addEmbeddingToMemory will use runtime.useModel(ModelType.TEXT_EMBEDDING, ...)
      await this.runtime.addEmbeddingToMemory(fragment);

      // Store the fragment in the knowledge table
      await this.runtime.createMemory(fragment, 'knowledge');
    } catch (error) {
      logger.error(
        `KnowledgeService: Error processing fragment ${fragment.id}:`,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  private async splitAndCreateFragments(
    document: KnowledgeItem, // document.id is the ID of the parent document
    targetTokens: number,
    overlap: number,
    scope: { roomId: UUID; worldId: UUID; entityId: UUID }
  ): Promise<Memory[]> {
    if (!document.content.text) {
      return [];
    }

    const text = document.content.text;
    // TODO: Consider using DEFAULT_CHUNK_TOKEN_SIZE and DEFAULT_CHUNK_OVERLAP_TOKENS from ctx-embeddings
    // For now, using passed in values or defaults from _internalAddKnowledge.
    const chunks = await splitChunks(text, targetTokens, overlap);

    return chunks.map((chunk: string, index: number) => {
      // Create a unique ID for the fragment based on document ID, index, and timestamp
      const fragmentIdContent = `${document.id}-fragment-${index}-${Date.now()}`;
      const fragmentId = createUniqueUuid(
        this.runtime,
        this.runtime.agentId + fragmentIdContent
      );

      return {
        id: fragmentId,
        entityId: scope.entityId,
        agentId: this.runtime.agentId,
        roomId: scope.roomId,
        worldId: scope.worldId,
        content: {
          text: chunk,
        },
        metadata: {
          ...(document.metadata || {}), // Spread metadata from parent document
          type: MemoryType.FRAGMENT,
          documentId: document.id, // Link fragment to parent document
          position: index,
          timestamp: Date.now(), // Fragment's own creation timestamp
          // Ensure we don't overwrite essential fragment metadata with document's
          // For example, source might be different or more specific for the fragment.
          // Here, we primarily inherit and then set fragment-specifics.
        },
        createdAt: Date.now(),
      };
    });
  }

  // ADDED METHODS START
  /**
   * Retrieves memories, typically documents, for the agent.
   * Corresponds to GET /plugins/knowledge/documents
   */
  async getMemories(params: {
    tableName: string; // Should be 'documents' or 'knowledge' for this service
    roomId?: UUID;
    count?: number;
    end?: number; // timestamp for "before"
  }): Promise<Memory[]> {
    return this.runtime.getMemories({
      ...params, // includes tableName, roomId, count, end
      agentId: this.runtime.agentId,
    });
  }

  /**
   * Deletes a specific memory item (knowledge document) by its ID.
   * Corresponds to DELETE /plugins/knowledge/documents/:knowledgeId
   * Assumes the memoryId corresponds to an item in the 'documents' table or that
   * runtime.deleteMemory can correctly identify it.
   */
  async deleteMemory(memoryId: UUID): Promise<void> {
    // The core runtime.deleteMemory is expected to handle deletion.
    // If it needs a tableName, and we are sure it's 'documents', it could be passed.
    // However, the previous error indicated runtime.deleteMemory takes 1 argument.
    await this.runtime.deleteMemory(memoryId);
    logger.info(
      `KnowledgeService: Deleted memory ${memoryId} for agent ${this.runtime.agentId}. Assumed it was a document or related fragment.`
    );
  }
  // ADDED METHODS END
}
