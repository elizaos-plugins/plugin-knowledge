/**
 * Knowledge Plugin - Main Entry Point
 *
 * This file exports all the necessary functions and types for the Knowledge plugin.
 */
import type { Plugin, IAgentRuntime } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { validateModelConfig } from './config.ts';
import { KnowledgeService } from './service.ts';
import { knowledgeProvider } from './provider.ts';
import knowledgeTestSuite from './tests.ts';
import { knowledgeActions } from './actions.ts';
import { knowledgeRoutes } from './routes.ts';
import { knowledgeSchema } from './schema.ts';
import knowledgeE2ETest from './__tests__/e2e/knowledge-e2e.test.ts';
import startupLoadingTest from './__tests__/e2e/startup-loading.test.ts';

/**
 * Knowledge Plugin - Provides Retrieval Augmented Generation capabilities
 */
export const knowledgePlugin: Plugin = {
  name: 'knowledge',
  description: 'Plugin for managing and searching knowledge',
  actions: knowledgeActions,
  providers: [knowledgeProvider],
  services: [KnowledgeService],
  routes: knowledgeRoutes,
  tests: [knowledgeTestSuite],
  schema: knowledgeSchema,
  init: async (config: Record<string, string>, runtime: IAgentRuntime) => {
    logger.info('Initializing Knowledge Plugin...');
    
    // Validate model configuration at plugin initialization
    try {
      await validateModelConfig(runtime);
      logger.info('Model configuration validated successfully.');
    } catch (error) {
      logger.error('Model configuration validation failed:', error);
      throw error;
    }
    
    logger.info(`Knowledge Plugin initialized for agent: ${runtime.agentId}`);
    logger.info('Knowledge Plugin initialized. Frontend panel should be discoverable via its public route.');
  },
};

export default knowledgePlugin;

export * from './types.ts';
