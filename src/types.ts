import { UUID, KnowledgeItem } from '@elizaos/core';
import z from 'zod';

// Schema for validating model configuration
export const ModelConfigSchema = z.object({
  // Provider configuration
  // NOTE: If EMBEDDING_PROVIDER is not specified, the plugin automatically assumes
  // plugin-openai is being used and will use OPENAI_EMBEDDING_MODEL and
  // OPENAI_EMBEDDING_DIMENSIONS for configuration
  EMBEDDING_PROVIDER: z.enum(['openai', 'google']),
  TEXT_PROVIDER: z.enum(['openai', 'anthropic', 'openrouter', 'google']).optional(),

  // API keys
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),

  // Base URLs (optional for most providers)
  OPENAI_BASE_URL: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().optional(),
  GOOGLE_BASE_URL: z.string().optional(),

  // Model names
  TEXT_EMBEDDING_MODEL: z.string(),
  TEXT_MODEL: z.string().optional(),

  // Token limits
  MAX_INPUT_TOKENS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val)),
  MAX_OUTPUT_TOKENS: z
    .string()
    .or(z.number())
    .optional()
    .transform((val) => (val ? (typeof val === 'string' ? parseInt(val, 10) : val) : 4096)),

  // Embedding dimension
  // For OpenAI: Only applies to text-embedding-3-small and text-embedding-3-large models
  // Default: 1536 dimensions
  EMBEDDING_DIMENSION: z
    .string()
    .or(z.number())
    .optional()
    .transform((val) => (val ? (typeof val === 'string' ? parseInt(val, 10) : val) : 1536)),

  // Contextual Knowledge settings
  CTX_KNOWLEDGE_ENABLED: z.boolean().default(false),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/**
 * Interface for provider rate limits
 */
export interface ProviderRateLimits {
  // Maximum concurrent requests recommended for this provider
  maxConcurrentRequests: number;
  // Maximum requests per minute allowed
  requestsPerMinute: number;
  // Maximum tokens per minute allowed (if applicable)
  tokensPerMinute?: number;
  // Name of the provider
  provider: string;
}

/**
 * Options for text generation overrides
 */
export interface TextGenerationOptions {
  provider?: 'anthropic' | 'openai' | 'openrouter' | 'google';
  modelName?: string;
  maxTokens?: number;
  /**
   * Document to cache for contextual retrieval.
   * When provided (along with an Anthropic model via OpenRouter), this enables prompt caching.
   * The document is cached with the provider and subsequent requests will reuse the cached document,
   * significantly reducing costs for multiple operations on the same document.
   * Most effective with contextual retrieval for Knowledge applications.
   */
  cacheDocument?: string;

  /**
   * Options for controlling the cache behavior.
   * Currently supports { type: 'ephemeral' } which sets up a temporary cache.
   * Cache expires after approximately 5 minutes with Anthropic models.
   * This can reduce costs by up to 90% for reads after the initial cache write.
   */
  cacheOptions?: {
    type: 'ephemeral';
  };
  /**
   * Whether to automatically detect and enable caching for contextual retrieval.
   * Default is true for OpenRouter+Anthropic models with document-chunk prompts.
   * Set to false to disable automatic caching detection.
   */
  autoCacheContextualRetrieval?: boolean;
}

/**
 * Options for adding knowledge to the system
 */
export interface AddKnowledgeOptions {
  /** Agent ID from the frontend - if not provided, will use runtime.agentId */
  agentId?: UUID;
  worldId: UUID;
  roomId: UUID;
  entityId: UUID;
  /** Client-provided document ID */
  clientDocumentId: UUID;
  /** MIME type of the file */
  contentType: string;
  /** Original filename */
  originalFilename: string;
  /**
   * Content of the document. Should be:
   * - Base64 encoded string for binary files (PDFs, DOCXs, etc)
   * - Plain text for text files
   */
  content: string;
  /**
   * Optional metadata to associate with the knowledge
   * Used for storing additional information like source URL
   */
  metadata?: Record<string, unknown>;
}

// Extend the core service types with knowledge service
declare module '@elizaos/core' {
  interface ServiceTypeRegistry {
    KNOWLEDGE: 'knowledge';
  }
}

// Export service type constant
export const KnowledgeServiceType = {
  KNOWLEDGE: 'knowledge' as const,
} satisfies Partial<import('@elizaos/core').ServiceTypeRegistry>;

/**
 * Document represents a stored knowledge document
 */
export interface Document {
  id: UUID;
  agentId: UUID;
  worldId: UUID;
  roomId: UUID;
  entityId: UUID;
  originalFilename: string;
  contentType: string;
  content: string; // Base64 for PDFs, plain text for others
  fileSize: number;
  title?: string;
  sourceUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * KnowledgeFragment represents a chunk of a document with its embedding
 */
export interface KnowledgeFragment {
  id: UUID;
  documentId: UUID;
  agentId: UUID;
  worldId: UUID;
  roomId: UUID;
  entityId: UUID;
  content: string;
  embedding?: number[];
  position: number;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Input type for creating a new document
 */
export interface DocumentCreateInput {
  id: UUID;
  agentId: UUID;
  worldId?: UUID;
  roomId?: UUID;
  entityId?: UUID;
  originalFilename: string;
  contentType: string;
  content: string;
  fileSize: number;
  title?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Input type for creating a new fragment
 */
export interface FragmentCreateInput {
  id: UUID;
  documentId: UUID;
  agentId: UUID;
  worldId?: UUID;
  roomId?: UUID;
  entityId?: UUID;
  content: string;
  embedding?: number[];
  position: number;
  metadata?: Record<string, unknown>;
}

/**
 * Conversion utilities for backward compatibility
 */
export function documentToKnowledgeItem(doc: Document): KnowledgeItem {
  return {
    id: doc.id,
    content: {
      text: doc.content,
    },
    metadata: {
      type: 'document' as const,
      ...(doc.metadata || {}),
      originalFilename: doc.originalFilename,
      contentType: doc.contentType,
      fileSize: doc.fileSize,
      title: doc.title,
      sourceUrl: doc.sourceUrl,
    },
  };
}

export function knowledgeItemToDocument(
  item: KnowledgeItem,
  agentId: UUID,
  worldId: UUID,
  roomId: UUID,
  entityId: UUID
): Omit<Document, 'id' | 'createdAt' | 'updatedAt'> {
  const metadata = item.metadata || {};
  return {
    agentId,
    worldId,
    roomId,
    entityId,
    originalFilename: (metadata as any).originalFilename || 'unknown',
    contentType: (metadata as any).contentType || 'text/plain',
    content: item.content.text || '',
    fileSize: (metadata as any).fileSize || 0,
    title: (metadata as any).title as string | undefined,
    sourceUrl: (metadata as any).sourceUrl as string | undefined,
    metadata: metadata,
  };
}

export interface KnowledgeDocumentMetadata extends Record<string, any> {
  type: string; // e.g., 'document', 'website_content'
  source: string; // e.g., 'upload', 'web_scrape', path to file
  title?: string;
  filename?: string;
  fileExt?: string;
  fileType?: string; // MIME type
  fileSize?: number;
  url?: string; // if applicable
  timestamp: number; // creation/ingestion timestamp
  documentId?: string; // if from an external system
  // Add other relevant metadata fields
}

export interface KnowledgeConfig {
  CTX_KNOWLEDGE_ENABLED: boolean;
  LOAD_DOCS_ON_STARTUP: boolean;
  MAX_INPUT_TOKENS?: string | number;
  MAX_OUTPUT_TOKENS?: string | number;
  EMBEDDING_PROVIDER?: string;
  TEXT_PROVIDER?: string;
  TEXT_EMBEDDING_MODEL?: string;
  // Add any other plugin-specific configurations
}

export interface LoadResult {
  successful: number;
  failed: number;
  errors?: Array<{ filename: string; error: string }>;
}

/**
 * Extends the base MemoryMetadata from @elizaos/core with additional fields
 */
export interface ExtendedMemoryMetadata extends Record<string, any> {
  type?: string;
  title?: string;
  filename?: string;
  path?: string;
  description?: string;
  fileExt?: string;
  timestamp?: number;
  contentType?: string;
  documentId?: string;
  source?: string;
  fileType?: string;
  fileSize?: number;
  position?: number; // For fragments
  originalFilename?: string;
  url?: string; // For web content
}
