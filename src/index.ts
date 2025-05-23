/**
 * Knowledge Plugin - Main Entry Point
 *
 * This file exports all the necessary functions and types for the Knowledge plugin.
 */
import type { Plugin, IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { validateModelConfig } from "./config.ts";
import { KnowledgeService } from "./service.ts";
import { knowledgeProvider } from "./provider.ts";
import knowledgeTestSuite from "./tests.ts";
import { knowledgeActions } from "./actions.ts";

/**
 * Knowledge Plugin - Provides Retrieval Augmented Generation capabilities
 */
export const knowledgePlugin: Plugin = {
  name: "knowledge",
  description:
    "Plugin for Retrieval Augmented Generation, including knowledge management and embedding.",
  config: {
    // Token limits
    MAX_INPUT_TOKENS: process.env.MAX_INPUT_TOKENS,
    MAX_OUTPUT_TOKENS: process.env.MAX_OUTPUT_TOKENS,

    // Contextual Knowledge settings
    CTX_KNOWLEDGE_ENABLED: process.env.CTX_KNOWLEDGE_ENABLED || "false",
  },
  async init(config: Record<string, string>, runtime?: IAgentRuntime) {
    logger.info("Initializing Knowledge Plugin...");
    try {
      // Validate the model configuration
      logger.info("Validating model configuration for Knowledge plugin...");
      const validatedConfig = validateModelConfig();

      // Log the operational mode
      if (validatedConfig.CTX_KNOWLEDGE_ENABLED) {
        logger.info(
          "Running in Contextual Knowledge mode with text generation capabilities."
        );
        logger.info(
          `Using ${validatedConfig.EMBEDDING_PROVIDER} for embeddings and ${validatedConfig.TEXT_PROVIDER} for text generation.`
        );
      } else {
        const usingPluginOpenAI = !process.env.EMBEDDING_PROVIDER;

        if (usingPluginOpenAI) {
          logger.info(
            "Running in Basic Embedding mode with auto-detected configuration from plugin-openai."
          );
        } else {
          logger.info(
            "Running in Basic Embedding mode (CTX_KNOWLEDGE_ENABLED=false). TEXT_PROVIDER and TEXT_MODEL not required."
          );
        }

        logger.info(
          `Using ${validatedConfig.EMBEDDING_PROVIDER} for embeddings with ${validatedConfig.TEXT_EMBEDDING_MODEL}.`
        );
      }

      logger.info("Model configuration validated successfully.");

      if (runtime) {
        logger.info(
          `Knowledge Plugin initialized for agent: ${runtime.agentId}`
        );

        // Check if docs should be loaded on startup
        const loadDocsOnStartup =
          config.LOAD_DOCS_ON_STARTUP !== "false" &&
          process.env.LOAD_DOCS_ON_STARTUP !== "false";

        if (loadDocsOnStartup) {
          // Schedule document loading after service initialization
          setTimeout(async () => {
            try {
              const service = runtime.getService(KnowledgeService.serviceType);
              if (service instanceof KnowledgeService) {
                const { loadDocsFromPath } = await import("./docs-loader");
                const result = await loadDocsFromPath(service, runtime.agentId);
                if (result.successful > 0) {
                  logger.info(
                    `Loaded ${result.successful} documents from docs folder on startup`
                  );
                }
              }
            } catch (error) {
              logger.error("Error loading documents on startup:", error);
            }
          }, 5000); // Delay to ensure services are fully initialized
        }
      }

      logger.info("Knowledge Plugin initialized.");
    } catch (error) {
      logger.error("Failed to initialize Knowledge plugin:", error);
      throw error;
    }
  },
  services: [KnowledgeService],
  providers: [knowledgeProvider],
  actions: knowledgeActions,
  tests: [knowledgeTestSuite],
};

export default knowledgePlugin;

export * from "./types.ts";