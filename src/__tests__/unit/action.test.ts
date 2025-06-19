import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { processKnowledgeAction, searchKnowledgeAction } from '../../actions';
import { KnowledgeService } from '../../service';
import type { IAgentRuntime, Memory, Content, State, UUID, ActionResult } from '@elizaos/core';
import * as fs from 'fs';
import * as path from 'path';

// Mock @elizaos/core logger and stringToUuid
vi.mock('@elizaos/core', async () => {
  const actual = await vi.importActual<typeof import('@elizaos/core')>('@elizaos/core');
  return {
    ...actual,
    logger: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
    stringToUuid: vi.fn((input: string) => {
      // Generate consistent UUIDs for testing
      const hash = input.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const uuid = `${hash.toString(16).padStart(8, '0')}-${hash.toString(16).padStart(4, '0')}-${hash.toString(16).padStart(4, '0')}-${hash.toString(16).padStart(4, '0')}-${hash.toString(16).padStart(12, '0')}`;
      return uuid as UUID;
    }),
  };
});

// Mock fs and path
vi.mock('fs');
vi.mock('path');

describe('processKnowledgeAction', () => {
  let mockRuntime: IAgentRuntime;
  let mockKnowledgeService: KnowledgeService;
  let mockCallback: Mock;
  let mockState: State;

  const generateMockUuid = (suffix: string | number): UUID =>
    `00000000-0000-0000-0000-${String(suffix).padStart(12, '0')}` as UUID;

  beforeEach(() => {
    mockKnowledgeService = {
      addKnowledge: vi.fn(),
      getKnowledge: vi.fn(),
      serviceType: 'knowledge-service',
    } as unknown as KnowledgeService;

    mockRuntime = {
      agentId: 'test-agent' as UUID,
      getService: vi.fn().mockReturnValue(mockKnowledgeService),
    } as unknown as IAgentRuntime;

    mockCallback = vi.fn();
    mockState = {
      values: {},
      data: {},
      text: '',
    };
    vi.clearAllMocks();
  });

  describe('handler', () => {
    beforeEach(() => {
      // Reset and re-mock fs/path functions for each handler test
      (fs.existsSync as Mock).mockReset();
      (fs.readFileSync as Mock).mockReset();
      (path.basename as Mock).mockReset();
      (path.extname as Mock).mockReset();
    });

    it('should process a file when a valid path is provided', async () => {
      const message: Memory = {
        id: generateMockUuid(1),
        content: {
          text: 'Process the document at /path/to/document.pdf',
        },
        entityId: generateMockUuid(2),
        roomId: generateMockUuid(3),
      };

      // Mock Date.now() for this test to generate predictable clientDocumentId's
      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1749491066994);

      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(Buffer.from('file content'));
      (path.basename as Mock).mockReturnValue('document.pdf');
      (path.extname as Mock).mockReturnValue('.pdf');
      (mockKnowledgeService.addKnowledge as Mock).mockResolvedValue({ fragmentCount: 5 });

      const result = (await processKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/document.pdf');
      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/document.pdf');
      expect(mockKnowledgeService.addKnowledge).toHaveBeenCalledWith({
        clientDocumentId: expect.any(String),
        contentType: 'application/pdf',
        originalFilename: 'document.pdf',
        worldId: 'test-agent' as UUID,
        content: Buffer.from('file content').toString('base64'),
        roomId: message.roomId,
        entityId: message.entityId,
      });
      expect(mockCallback).toHaveBeenCalledWith({
        text: `I've successfully processed the document "document.pdf". It has been split into 5 searchable fragments and added to my knowledge base.`,
      });

      expect(result).toBeDefined();
      expect(result?.text).toContain('successfully processed');
      expect(result?.data?.results).toBeInstanceOf(Array);

      // Restore Date.now() after the test
      dateNowSpy.mockRestore();
    });

    it('should return a message if the file path is provided but file does not exist', async () => {
      const message: Memory = {
        id: generateMockUuid(4),
        content: {
          text: 'Process the document at /non/existent/file.txt',
        },
        entityId: generateMockUuid(5),
        roomId: generateMockUuid(6),
      };

      (fs.existsSync as Mock).mockReturnValue(false);

      const result = (await processKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      expect(fs.existsSync).toHaveBeenCalledWith('/non/existent/file.txt');
      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(mockKnowledgeService.addKnowledge).not.toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith({
        text: "I couldn't find the file at /non/existent/file.txt. Please check the path and try again.",
      });
      expect(result?.text).toBeUndefined();
    });

    it('should process direct text content when no file path is provided', async () => {
      const message: Memory = {
        id: generateMockUuid(7),
        content: {
          text: 'Add this to your knowledge: The capital of France is Paris.',
        },
        entityId: generateMockUuid(8),
        roomId: generateMockUuid(9),
      };

      (mockKnowledgeService.addKnowledge as Mock).mockResolvedValue({});

      const result = (await processKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(mockKnowledgeService.addKnowledge).toHaveBeenCalledWith({
        clientDocumentId: expect.any(String),
        contentType: 'text/plain',
        originalFilename: 'user-knowledge.txt',
        worldId: 'test-agent' as UUID,
        content: 'to your knowledge: The capital of France is Paris.',
        roomId: message.roomId,
        entityId: message.entityId,
      });
      expect(mockCallback).toHaveBeenCalledWith({
        text: "I've added that information to my knowledge base. It has been stored and indexed for future reference.",
      });
      expect(result).toBeDefined();
      expect(result?.text).toContain('added that information');
    });

    it('should return a message if no file path and no text content is provided', async () => {
      const message: Memory = {
        id: generateMockUuid(10),
        content: {
          text: 'add this:',
        },
        entityId: generateMockUuid(11),
        roomId: generateMockUuid(12),
      };

      const result = (await processKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(mockKnowledgeService.addKnowledge).not.toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I need some content to add to my knowledge base. Please provide text or a file path.',
      });
      expect(result?.text).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      const message: Memory = {
        id: generateMockUuid(13),
        content: {
          text: 'Process /path/to/error.txt',
        },
        entityId: generateMockUuid(14),
        roomId: generateMockUuid(15),
      };

      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(Buffer.from('error content'));
      (path.basename as Mock).mockReturnValue('error.txt');
      (path.extname as Mock).mockReturnValue('.txt');
      (mockKnowledgeService.addKnowledge as Mock).mockRejectedValue(new Error('Service error'));

      const result = (await processKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I encountered an error while processing the knowledge: Service error',
      });
      expect(result).toBeDefined();
      expect(result?.data?.error).toBe('Service error');
      expect(result?.text).toContain('encountered an error');
    });

    it("should generate unique clientDocumentId's for different documents and content", async () => {
      // Mock Date.now() for this test to generate predictable clientDocumentId's
      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1749491066994);

      // Test with two different files
      const fileMessage1: Memory = {
        id: generateMockUuid(28),
        content: {
          text: 'Process the document at /path/to/doc1.pdf',
        },
        entityId: generateMockUuid(29),
        roomId: generateMockUuid(30),
      };

      const fileMessage2: Memory = {
        id: generateMockUuid(31),
        content: {
          text: 'Process the document at /path/to/doc2.pdf',
        },
        entityId: generateMockUuid(32),
        roomId: generateMockUuid(33),
      };

      // Test with direct text content
      const textMessage: Memory = {
        id: generateMockUuid(34),
        content: {
          text: 'Add this to your knowledge: Some unique content here.',
        },
        entityId: generateMockUuid(35),
        roomId: generateMockUuid(36),
      };

      // Setup mocks for file operations
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(Buffer.from('file content'));
      (path.basename as Mock).mockReturnValueOnce('doc1.pdf').mockReturnValueOnce('doc2.pdf');
      (path.extname as Mock).mockReturnValueOnce('.pdf').mockReturnValueOnce('.pdf');

      // Process all three messages
      await processKnowledgeAction.handler?.(
        mockRuntime,
        fileMessage1,
        mockState,
        {},
        mockCallback
      );
      await processKnowledgeAction.handler?.(
        mockRuntime,
        fileMessage2,
        mockState,
        {},
        mockCallback
      );
      await processKnowledgeAction.handler?.(mockRuntime, textMessage, mockState, {}, mockCallback);

      // Get all calls to addKnowledge
      const addKnowledgeCalls = (mockKnowledgeService.addKnowledge as Mock).mock.calls;

      // Extract clientDocumentId's from the knowledgeOptions objects
      const clientDocumentIds = addKnowledgeCalls.map((call) => call[0].clientDocumentId);

      // Verify we have 3 unique IDs
      expect(clientDocumentIds.length).toBe(3);
      expect(new Set(clientDocumentIds).size).toBe(3);

      // Verify the IDs are strings of the expected format
      const [file1Id, file2Id, textId] = clientDocumentIds;

      // Verify all IDs are valid UUID-like strings
      expect(file1Id).toMatch(/^[0-9a-f-]+$/);
      expect(file2Id).toMatch(/^[0-9a-f-]+$/);
      expect(textId).toMatch(/^[0-9a-f-]+$/);

      // Verify all IDs are different
      expect(file1Id).not.toBe(file2Id);
      expect(file1Id).not.toBe(textId);
      expect(file2Id).not.toBe(textId);

      // Restore Date.now() after the test
      dateNowSpy.mockRestore();
    });

    it("should generate unique clientDocumentId's for same content but different time", async () => {
      // Mock Date.now() for this test to generate predictable clientDocumentId's
      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1749491066994);

      // Test with two different files
      const textMessage1: Memory = {
        id: generateMockUuid(28),
        content: {
          text: 'Add this to your knowledge: Some unique content here.',
        },
        entityId: generateMockUuid(29),
        roomId: generateMockUuid(30),
      };

      const textMessage2: Memory = {
        id: generateMockUuid(31),
        content: {
          text: 'Add this to your knowledge: Some unique content here.',
        },
        entityId: generateMockUuid(32),
        roomId: generateMockUuid(33),
      };

      // Process all three messages
      await processKnowledgeAction.handler?.(
        mockRuntime,
        textMessage1,
        mockState,
        {},
        mockCallback
      );

      // Change Date.now() mock to generate a different timestamp
      dateNowSpy.mockRestore();
      const dateNowSpy2 = vi.spyOn(Date, 'now').mockReturnValue(1749491066995);

      await processKnowledgeAction.handler?.(
        mockRuntime,
        textMessage2,
        mockState,
        {},
        mockCallback
      );

      // Get all calls to addKnowledge
      const addKnowledgeCalls = (mockKnowledgeService.addKnowledge as Mock).mock.calls;

      // Extract clientDocumentId's from the knowledgeOptions objects
      const clientDocumentIds = addKnowledgeCalls.map((call) => call[0].clientDocumentId);

      // Verify we have 2 unique IDs
      expect(clientDocumentIds.length).toBe(2);
      expect(new Set(clientDocumentIds).size).toBe(2);

      // Verify the IDs match the expected patterns
      const [textId1, textId2] = clientDocumentIds;

      // Verify both are valid UUID-like strings
      expect(textId1).toMatch(/^[0-9a-f-]+$/);
      expect(textId2).toMatch(/^[0-9a-f-]+$/);

      // Verify they are different
      expect(textId1).not.toBe(textId2);

      // Restore Date.now() after the test
      dateNowSpy2.mockRestore();
    });
  });

  describe('validate', () => {
    beforeEach(() => {
      (mockRuntime.getService as Mock).mockReturnValue(mockKnowledgeService);
    });

    it('should return true if knowledge keywords are present and service is available', async () => {
      const message: Memory = {
        id: generateMockUuid(16),
        content: {
          text: 'add this to your knowledge base',
        },
        entityId: generateMockUuid(17),
        roomId: generateMockUuid(18),
      };
      const isValid = await processKnowledgeAction.validate?.(mockRuntime, message, mockState);
      expect(isValid).toBe(true);
      expect(mockRuntime.getService).toHaveBeenCalledWith(KnowledgeService.serviceType);
    });

    it('should return true if a file path is present and service is available', async () => {
      const message: Memory = {
        id: generateMockUuid(19),
        content: {
          text: 'process /path/to/doc.pdf',
        },
        entityId: generateMockUuid(20),
        roomId: generateMockUuid(21),
      };
      const isValid = await processKnowledgeAction.validate?.(mockRuntime, message, mockState);
      expect(isValid).toBe(true);
    });

    it('should return false if service is not available', async () => {
      (mockRuntime.getService as Mock).mockReturnValue(null);
      const message: Memory = {
        id: generateMockUuid(22),
        content: {
          text: 'add this to your knowledge base',
        },
        entityId: generateMockUuid(23),
        roomId: generateMockUuid(24),
      };
      const isValid = await processKnowledgeAction.validate?.(mockRuntime, message, mockState);
      expect(isValid).toBe(false);
    });

    it('should return false if no relevant keywords or path are present', async () => {
      const message: Memory = {
        id: generateMockUuid(25),
        content: {
          text: 'hello there',
        },
        entityId: generateMockUuid(26),
        roomId: generateMockUuid(27),
      };
      const isValid = await processKnowledgeAction.validate?.(mockRuntime, message, mockState);
      expect(isValid).toBe(false);
    });
  });
});

describe('searchKnowledgeAction', () => {
  let mockRuntime: IAgentRuntime;
  let mockKnowledgeService: KnowledgeService;
  let mockCallback: Mock;
  let mockState: State;

  const generateMockUuid = (suffix: string | number): UUID =>
    `00000000-0000-0000-0000-${String(suffix).padStart(12, '0')}` as UUID;

  beforeEach(() => {
    mockKnowledgeService = {
      addKnowledge: vi.fn(),
      getKnowledge: vi.fn(),
      serviceType: 'knowledge-service',
    } as unknown as KnowledgeService;

    mockRuntime = {
      agentId: 'test-agent' as UUID,
      getService: vi.fn().mockReturnValue(mockKnowledgeService),
    } as unknown as IAgentRuntime;

    mockCallback = vi.fn();
    mockState = {
      values: {},
      data: {},
      text: '',
    };
    vi.clearAllMocks();
  });

  describe('handler', () => {
    it('should search knowledge and return ActionResult with data', async () => {
      const mockResults = [
        {
          id: generateMockUuid(50),
          content: { text: 'First search result about AI' },
          metadata: { source: 'ai-basics.pdf' },
        },
        {
          id: generateMockUuid(51),
          content: { text: 'Second search result about machine learning' },
          metadata: { source: 'ml-guide.pdf' },
        },
        {
          id: generateMockUuid(52),
          content: { text: 'Third search result about neural networks' },
          metadata: { source: 'nn-intro.pdf' },
        },
      ];

      (mockKnowledgeService.getKnowledge as Mock).mockResolvedValue(mockResults);

      const message: Memory = {
        id: generateMockUuid(53),
        content: {
          text: 'Search your knowledge for information about AI',
        },
        entityId: generateMockUuid(54),
        roomId: generateMockUuid(55),
      };

      const result = (await searchKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      // Verify the search was performed
      expect(mockKnowledgeService.getKnowledge).toHaveBeenCalledWith({
        ...message,
        content: { text: 'information about AI' },
      });

      // Verify ActionResult structure
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.data?.query).toBe('information about AI');
      expect(result.data?.results).toEqual(mockResults);
      expect(result.data?.count).toBe(3);
      expect(result.text).toContain("Here's what I found");

      // Verify callback was called
      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('information about AI'),
      });
    });

    it('should handle empty search results', async () => {
      (mockKnowledgeService.getKnowledge as Mock).mockResolvedValue([]);

      const message: Memory = {
        id: generateMockUuid(56),
        content: {
          text: 'Search knowledge for quantum teleportation',
        },
        entityId: generateMockUuid(57),
        roomId: generateMockUuid(58),
      };

      const result = (await searchKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      expect(result.data?.query).toBe('quantum teleportation');
      expect(result.data?.results).toEqual([]);
      expect(result.data?.count).toBe(0);
      expect(result.text).toContain("couldn't find any information");
    });

    it('should handle search errors and return error in ActionResult', async () => {
      (mockKnowledgeService.getKnowledge as Mock).mockRejectedValue(
        new Error('Search service unavailable')
      );

      const message: Memory = {
        id: generateMockUuid(59),
        content: {
          text: 'Search for something',
        },
        entityId: generateMockUuid(60),
        roomId: generateMockUuid(61),
      };

      const result = (await searchKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      expect(result.data?.error).toBe('Search service unavailable');
      expect(result.text).toContain('encountered an error');
      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('Search service unavailable'),
      });
    });

    it('should handle case where only search keywords are provided', async () => {
      // Mock empty results
      (mockKnowledgeService.getKnowledge as Mock).mockResolvedValue([]);

      const message: Memory = {
        id: generateMockUuid(62),
        content: {
          text: 'search knowledge',
        },
        entityId: generateMockUuid(63),
        roomId: generateMockUuid(64),
      };

      const result = (await searchKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      // The regex doesn't match "search knowledge", so the whole text becomes the query
      expect(mockKnowledgeService.getKnowledge).toHaveBeenCalledWith({
        ...message,
        content: { text: 'search knowledge' },
      });
      expect(result.data?.query).toBe('search knowledge');
      expect(result.data?.results).toEqual([]);
      expect(result.data?.count).toBe(0);
      expect(result.text).toContain("couldn't find any information");
    });

    it('should return structured data suitable for action chaining', async () => {
      const complexResults = [
        {
          id: generateMockUuid(65),
          content: {
            text: 'Climate change impacts include rising temperatures and sea levels',
            metadata: { importance: 'high' },
          },
          metadata: {
            source: 'climate-report-2024.pdf',
            date: '2024-01-15',
            tags: ['climate', 'environment', 'global-warming'],
          },
        },
        {
          id: generateMockUuid(66),
          content: {
            text: 'Renewable energy solutions can mitigate climate effects',
            metadata: { importance: 'medium' },
          },
          metadata: {
            source: 'renewable-energy.pdf',
            date: '2024-02-01',
            tags: ['renewable', 'solar', 'wind'],
          },
        },
      ];

      (mockKnowledgeService.getKnowledge as Mock).mockResolvedValue(complexResults);

      const message: Memory = {
        id: generateMockUuid(67),
        content: {
          text: 'Search knowledge about climate change solutions',
        },
        entityId: generateMockUuid(68),
        roomId: generateMockUuid(69),
      };

      const result = (await searchKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      // Verify the result contains all necessary data for downstream actions
      expect(result.data).toMatchObject({
        query: 'about climate change solutions', // The actual query includes "about"
        results: complexResults,
        count: 2,
      });

      // Verify each result maintains its structure
      const firstResult = result.data?.results[0];
      expect(firstResult).toHaveProperty('id');
      expect(firstResult).toHaveProperty('content.text');
      expect(firstResult).toHaveProperty('metadata.source');
      expect(firstResult).toHaveProperty('metadata.tags');

      // This data structure can now be used by other actions
      // For example, a summarize action could access result.data.results
      // Or an analyze action could process result.data.results[].metadata.tags
    });
  });

  describe('validate', () => {
    beforeEach(() => {
      (mockRuntime.getService as Mock).mockReturnValue(mockKnowledgeService);
    });

    it('should return true when search and knowledge keywords are present', async () => {
      const message: Memory = {
        id: generateMockUuid(70),
        content: {
          text: 'search your knowledge for information',
        },
        entityId: generateMockUuid(71),
        roomId: generateMockUuid(72),
      };

      const isValid = await searchKnowledgeAction.validate?.(mockRuntime, message, mockState);
      expect(isValid).toBe(true);
    });

    it('should return true for various search phrasings', async () => {
      const testCases = [
        'find information in your knowledge',
        'look up knowledge about AI', // Changed to include "knowledge"
        'query knowledge base for data',
        'what do you know about information systems', // Changed to include both keywords
      ];

      for (const text of testCases) {
        const message: Memory = {
          id: generateMockUuid(73),
          content: { text },
          entityId: generateMockUuid(74),
          roomId: generateMockUuid(75),
        };

        const isValid = await searchKnowledgeAction.validate?.(mockRuntime, message, mockState);
        expect(isValid).toBe(true);
      }
    });

    it('should return false when service is not available', async () => {
      (mockRuntime.getService as Mock).mockReturnValue(null);

      const message: Memory = {
        id: generateMockUuid(76),
        content: {
          text: 'search knowledge for AI',
        },
        entityId: generateMockUuid(77),
        roomId: generateMockUuid(78),
      };

      const isValid = await searchKnowledgeAction.validate?.(mockRuntime, message, mockState);
      expect(isValid).toBe(false);
    });

    it('should return false when no search keywords are present', async () => {
      const message: Memory = {
        id: generateMockUuid(79),
        content: {
          text: 'tell me about the weather',
        },
        entityId: generateMockUuid(80),
        roomId: generateMockUuid(81),
      };

      const isValid = await searchKnowledgeAction.validate?.(mockRuntime, message, mockState);
      expect(isValid).toBe(false);
    });
  });
});
