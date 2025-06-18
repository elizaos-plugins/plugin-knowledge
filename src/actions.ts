import type {
  Action,
  Content,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  UUID,
  ActionResult,
} from "@elizaos/core";
import { logger, stringToUuid } from "@elizaos/core";
import * as fs from "fs";
import * as path from "path";
import { KnowledgeService } from "./service.ts";
import { AddKnowledgeOptions } from "./types.ts";
import { fetchUrlContent } from "./utils.ts";

/**
 * Action to process knowledge from files or text
 */
export const processKnowledgeAction: Action = {
  name: 'PROCESS_KNOWLEDGE',
  description:
    'Process and store knowledge from a file path or text content into the knowledge base',

  similes: [],

  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Process the document at /path/to/document.pdf',
        },
      },
      {
        name: 'assistant',
        content: {
          text: "I'll process the document at /path/to/document.pdf and add it to my knowledge base.",
          actions: ['PROCESS_KNOWLEDGE'],
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: 'Add this to your knowledge: The capital of France is Paris.',
        },
      },
      {
        name: 'assistant',
        content: {
          text: "I'll add that information to my knowledge base.",
          actions: ['PROCESS_KNOWLEDGE'],
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';

    // Check if the message contains knowledge-related keywords
    const knowledgeKeywords = [
      'process',
      'add',
      'upload',
      'document',
      'knowledge',
      'learn',
      'remember',
      'store',
      'ingest',
      'file',
      'save this',
      'save that',
      'keep this',
      'keep that',
    ];

    const hasKeyword = knowledgeKeywords.some((keyword) => text.includes(keyword));

    // Check if there's a file path mentioned
    const pathPattern = /(?:\/[\w.-]+)+|(?:[a-zA-Z]:[\\/][\w\s.-]+(?:[\\/][\w\s.-]+)*)/;
    const hasPath = pathPattern.test(text);

    // Check if there are attachments in the message
    const hasAttachments = !!(message.content.attachments && message.content.attachments.length > 0);

    // Check if service is available
    const service = runtime.getService(KnowledgeService.serviceType);
    if (!service) {
      logger.warn('Knowledge service not available for PROCESS_KNOWLEDGE action');
      return false;
    }

    return hasKeyword || hasPath || hasAttachments;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const service = runtime.getService<KnowledgeService>(KnowledgeService.serviceType);
      if (!service) {
        throw new Error('Knowledge service not available');
      }

      const text = message.content.text || '';
      const attachments = message.content.attachments || [];
      
      let response: Content;
      let processedCount = 0;
      const results: Array<{ filename: string; success: boolean; fragmentCount?: number; error?: string }> = [];

      // Process attachments first if they exist
      if (attachments.length > 0) {
        logger.info(`Processing ${attachments.length} attachments from message`);
        
        for (const attachment of attachments) {
          try {
            // Handle different attachment types
            let content: string;
            let contentType: string;
            let filename: string;

            if (attachment.url) {
              // Fetch content from URL
              const { content: fetchedContent, contentType: fetchedType } = await fetchUrlContent(attachment.url);
              content = fetchedContent;
              contentType = fetchedType;
              filename = attachment.title || attachment.url.split('/').pop() || 'attachment';
            } else if ('data' in attachment && attachment.data) {
              // Direct data attachment - handle base64 or direct content
              content = attachment.data as string;
              contentType = attachment.contentType || 'application/octet-stream';
              filename = attachment.title || 'attachment';
            } else {
              throw new Error('Attachment has no URL or data');
            }

            const knowledgeOptions: AddKnowledgeOptions = {
              clientDocumentId: stringToUuid(runtime.agentId + filename + Date.now()),
              contentType,
              originalFilename: filename,
              worldId: runtime.agentId,
              content,
              roomId: message.roomId,
              entityId: message.entityId,
              metadata: {
                source: 'message-attachment',
                messageId: message.id,
                attachmentType: ('type' in attachment ? attachment.type : undefined) || 'unknown',
              },
            };

            const result = await service.addKnowledge(knowledgeOptions);
            processedCount++;
            results.push({
              filename,
              success: true,
              fragmentCount: result.fragmentCount,
            });
          } catch (error: any) {
            logger.error(`Error processing attachment:`, error);
            results.push({
              filename: attachment.title || 'unknown',
              success: false,
              error: error.message,
            });
          }
        }

        // Generate response for attachments
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        if (successCount > 0 && failCount === 0) {
          response = {
            text: `I've successfully processed ${successCount} attachment${successCount > 1 ? 's' : ''} and added ${successCount > 1 ? 'them' : 'it'} to my knowledge base.`,
          };
        } else if (successCount > 0 && failCount > 0) {
          response = {
            text: `I processed ${successCount} attachment${successCount > 1 ? 's' : ''} successfully, but ${failCount} failed. The successful ones have been added to my knowledge base.`,
          };
        } else {
          response = {
            text: `I couldn't process any of the attachments. Please check the files and try again.`,
          };
        }
      } else {
        // Original file path and text processing logic
        // Extract file path from message
        const pathPattern = /(?:\/[\w.-]+)+|(?:[a-zA-Z]:[\\/][\w\s.-]+(?:[\\/][\w\s.-]+)*)/;
        const pathMatch = text.match(pathPattern);

        if (pathMatch) {
          // Process file from path
          const filePath = pathMatch[0];

          // Check if file exists
          if (!fs.existsSync(filePath)) {
            response = {
              text: `I couldn't find the file at ${filePath}. Please check the path and try again.`,
            };
            
            if (callback) {
              await callback(response);
            }
            return {};
          }

          // Read file
          const fileBuffer = fs.readFileSync(filePath);
          const fileName = path.basename(filePath);
          const fileExt = path.extname(filePath).toLowerCase();

          // Determine content type
          let contentType = 'text/plain';
          if (fileExt === '.pdf') contentType = 'application/pdf';
          else if (fileExt === '.docx')
            contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          else if (fileExt === '.doc') contentType = 'application/msword';
          else if (['.txt', '.md', '.tson', '.xml', '.csv'].includes(fileExt))
            contentType = 'text/plain';

          // Prepare knowledge options
          const knowledgeOptions: AddKnowledgeOptions = {
            clientDocumentId: stringToUuid(runtime.agentId + fileName + Date.now()),
            contentType,
            originalFilename: fileName,
            worldId: runtime.agentId,
            content: fileBuffer.toString('base64'),
            roomId: message.roomId,
            entityId: message.entityId,
          };

          // Process the document
          const result = await service.addKnowledge(knowledgeOptions);

          response = {
            text: `I've successfully processed the document "${fileName}". It has been split into ${result.fragmentCount} searchable fragments and added to my knowledge base.`,
          };
        } else {
          // Process direct text content
          const knowledgeContent = text
            .replace(/^(add|store|remember|process|learn)\s+(this|that|the following)?:?\s*/i, '')
            .trim();

          if (!knowledgeContent) {
            response = {
              text: 'I need some content to add to my knowledge base. Please provide text or a file path.',
            };
            
            if (callback) {
              await callback(response);
            }
            return {};
          }

          // Prepare knowledge options for text
          const knowledgeOptions: AddKnowledgeOptions = {
            clientDocumentId: stringToUuid(runtime.agentId + "text" + Date.now() + "user-knowledge"),
            contentType: "text/plain",
            originalFilename: "user-knowledge.txt",
            worldId: runtime.agentId,
            content: knowledgeContent,
            roomId: message.roomId,
            entityId: message.entityId,
          };

          // Process the text
          const result = await service.addKnowledge(knowledgeOptions);

          response = {
            text: `I've added that information to my knowledge base. It has been stored and indexed for future reference.`,
          };
        }
      }

      if (callback) {
        await callback(response);
      }
      
      return {};
    } catch (error) {
      logger.error('Error in PROCESS_KNOWLEDGE action:', error);

      const errorResponse: Content = {
        text: `I encountered an error while processing the knowledge: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };

      if (callback) {
        await callback(errorResponse);
      }
      
      return {};
    }
  },
};

/**
 * Action to search the knowledge base
 */
export const searchKnowledgeAction: Action = {
  name: 'SEARCH_KNOWLEDGE',
  description: 'Search the knowledge base for specific information',

  similes: [
    'search knowledge',
    'find information',
    'look up',
    'query knowledge base',
    'search documents',
    'find in knowledge',
  ],

  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Search your knowledge for information about quantum computing',
        },
      },
      {
        name: 'assistant',
        content: {
          text: "I'll search my knowledge base for information about quantum computing.",
          actions: ['SEARCH_KNOWLEDGE'],
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    const text = message.content.text?.toLowerCase() || '';

    // Check if the message contains search-related keywords
    const searchKeywords = ['search', 'find', 'look up', 'query', 'what do you know about'];
    const knowledgeKeywords = ['knowledge', 'information', 'document', 'database'];

    const hasSearchKeyword = searchKeywords.some((keyword) => text.includes(keyword));
    const hasKnowledgeKeyword = knowledgeKeywords.some((keyword) => text.includes(keyword));

    // Check if service is available
    const service = runtime.getService(KnowledgeService.serviceType);
    if (!service) {
      return false;
    }

    return hasSearchKeyword && hasKnowledgeKeyword;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const service = runtime.getService<KnowledgeService>(KnowledgeService.serviceType);
      if (!service) {
        throw new Error('Knowledge service not available');
      }

      const text = message.content.text || '';

      // Extract search query
      const query = text
        .replace(/^(search|find|look up|query)\s+(your\s+)?knowledge\s+(base\s+)?(for\s+)?/i, '')
        .trim();

      let response: Content;
      let success = true;

      if (!query) {
        response = {
          text: 'What would you like me to search for in my knowledge base?',
        };
        success = false;

        if (callback) {
          await callback(response);
        }
        return {};
      }

      // Create search message
      const searchMessage: Memory = {
        ...message,
        content: {
          text: query,
        },
      };

      // Search knowledge
      const results = await service.getKnowledge(searchMessage);

      if (results.length === 0) {
        response = {
          text: `I couldn't find any information about "${query}" in my knowledge base.`,
        };
      } else {
        // Format results
        const formattedResults = results
          .slice(0, 3) // Top 3 results
          .map((item, index) => `${index + 1}. ${item.content.text}`)
          .join('\n\n');

        response = {
          text: `Here's what I found about "${query}":\n\n${formattedResults}`,
        };
      }

      if (callback) {
        await callback(response);
      }
      
      return {};
    } catch (error) {
      logger.error('Error in SEARCH_KNOWLEDGE action:', error);

      const errorResponse: Content = {
        text: `I encountered an error while searching the knowledge base: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };

      if (callback) {
        await callback(errorResponse);
      }
      
      return {};
    }
  },
};

// Export all actions
export const knowledgeActions = [processKnowledgeAction, searchKnowledgeAction];
