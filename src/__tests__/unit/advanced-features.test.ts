import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import {
  advancedSearchAction,
  knowledgeAnalyticsAction,
  exportKnowledgeAction,
} from '../../actions';
import { KnowledgeService } from '../../service';
import type { IAgentRuntime, Memory, State, UUID, ActionResult } from '@elizaos/core';

// Mock @elizaos/core logger
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
  };
});

describe('Advanced Knowledge Features', () => {
  let mockRuntime: IAgentRuntime;
  let mockKnowledgeService: KnowledgeService;
  let mockCallback: Mock;
  let mockState: State;

  const generateMockUuid = (suffix: string | number): UUID =>
    `00000000-0000-0000-0000-00000000${suffix.toString().padStart(4, '0')}` as UUID;

  beforeEach(() => {
    mockKnowledgeService = {
      advancedSearch: vi.fn(),
      getAnalytics: vi.fn(),
      exportKnowledge: vi.fn(),
      importKnowledge: vi.fn(),
      batchOperation: vi.fn(),
    } as any;

    mockRuntime = {
      agentId: generateMockUuid(1),
      getService: vi.fn().mockReturnValue(mockKnowledgeService),
      getSetting: vi.fn(),
    } as any;

    mockCallback = vi.fn();
    mockState = {
      values: {},
      data: {},
      text: '',
    };
  });

  describe('advancedSearchAction', () => {
    it('should validate when advanced search keywords are present', async () => {
      const message: Memory = {
        id: generateMockUuid(10),
        content: {
          text: 'search for PDF documents from last week',
        },
        entityId: generateMockUuid(11),
        roomId: generateMockUuid(12),
      };

      const isValid = await advancedSearchAction.validate?.(mockRuntime, message);
      expect(isValid).toBe(true);
    });

    it('should extract filters from natural language', async () => {
      const mockResults = {
        results: [
          {
            id: generateMockUuid(20),
            content: { text: 'AI research paper content' },
            metadata: {
              originalFilename: 'ai-research.pdf',
              contentType: 'application/pdf',
            },
            similarity: 0.95,
          },
        ],
        totalCount: 1,
        hasMore: false,
      };

      (mockKnowledgeService.advancedSearch as Mock).mockResolvedValue(mockResults);

      const message: Memory = {
        id: generateMockUuid(21),
        content: {
          text: 'search for pdf documents about AI from last week sorted by relevant',
        },
        entityId: generateMockUuid(22),
        roomId: generateMockUuid(23),
      };

      const result = (await advancedSearchAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      // Check that advancedSearch was called
      expect(mockKnowledgeService.advancedSearch).toHaveBeenCalled();

      // Get the actual call arguments
      const callArgs = (mockKnowledgeService.advancedSearch as Mock).mock.calls[0][0];

      // Verify key properties
      expect(callArgs.query).toContain('AI');
      expect(callArgs.filters.contentType).toEqual(['application/pdf']);
      expect(callArgs.filters.dateRange).toBeDefined();
      expect(callArgs.filters.dateRange.start).toBeInstanceOf(Date);
      expect(callArgs.sort).toEqual({ field: 'similarity', order: 'desc' });

      expect(result.data).toEqual(mockResults);
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Found 1 documents'),
        })
      );
    });

    it('should handle empty search results', async () => {
      (mockKnowledgeService.advancedSearch as Mock).mockResolvedValue({
        results: [],
        totalCount: 0,
        hasMore: false,
      });

      const message: Memory = {
        id: generateMockUuid(30),
        content: {
          text: 'search for markdown files from today',
        },
        entityId: generateMockUuid(31),
        roomId: generateMockUuid(32),
      };

      const result = (await advancedSearchAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      expect(mockCallback).toHaveBeenCalledWith({
        text: 'No documents found matching your criteria.',
      });
    });
  });

  describe('knowledgeAnalyticsAction', () => {
    it('should validate when analytics keywords are present', async () => {
      const message: Memory = {
        id: generateMockUuid(40),
        content: {
          text: 'show me knowledge base analytics',
        },
        entityId: generateMockUuid(41),
        roomId: generateMockUuid(42),
      };

      const isValid = await knowledgeAnalyticsAction.validate?.(mockRuntime, message);
      expect(isValid).toBe(true);
    });

    it('should return formatted analytics', async () => {
      const mockAnalytics = {
        totalDocuments: 42,
        totalFragments: 156,
        storageSize: 5242880, // 5MB
        contentTypes: {
          'application/pdf': 20,
          'text/plain': 15,
          'text/markdown': 7,
        },
        queryStats: {
          totalQueries: 100,
          averageResponseTime: 250,
          topQueries: [
            { query: 'AI research', count: 25 },
            { query: 'machine learning', count: 18 },
          ],
        },
        usageByDate: [],
      };

      (mockKnowledgeService.getAnalytics as Mock).mockResolvedValue(mockAnalytics);

      const message: Memory = {
        id: generateMockUuid(43),
        content: {
          text: 'show analytics',
        },
        entityId: generateMockUuid(44),
        roomId: generateMockUuid(45),
      };

      const result = (await knowledgeAnalyticsAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      expect(result.data).toEqual(mockAnalytics);
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Total Documents: 42'),
        })
      );
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('5.00 MB'),
        })
      );
    });
  });

  describe('exportKnowledgeAction', () => {
    it('should validate when export keywords are present', async () => {
      const message: Memory = {
        id: generateMockUuid(50),
        content: {
          text: 'export my knowledge base',
        },
        entityId: generateMockUuid(51),
        roomId: generateMockUuid(52),
      };

      const isValid = await exportKnowledgeAction.validate?.(mockRuntime, message);
      expect(isValid).toBe(true);
    });

    it('should export to JSON format by default', async () => {
      const mockExportData = JSON.stringify(
        {
          exportDate: new Date().toISOString(),
          agentId: mockRuntime.agentId,
          documents: [
            {
              id: generateMockUuid(60),
              content: { text: 'Test document content' },
              metadata: { originalFilename: 'test.txt' },
            },
          ],
        },
        null,
        2
      );

      (mockKnowledgeService.exportKnowledge as Mock).mockResolvedValue(mockExportData);

      const message: Memory = {
        id: generateMockUuid(53),
        content: {
          text: 'export knowledge base',
        },
        entityId: generateMockUuid(54),
        roomId: generateMockUuid(55),
      };

      const result = (await exportKnowledgeAction.handler?.(
        mockRuntime,
        message,
        mockState,
        {},
        mockCallback
      )) as ActionResult;

      expect(mockKnowledgeService.exportKnowledge).toHaveBeenCalledWith({
        format: 'json',
        includeMetadata: true,
        includeFragments: false,
      });

      expect(result.data).toMatchObject({
        format: 'json',
        size: mockExportData.length,
        content: mockExportData,
      });
    });

    it('should detect CSV format from message', async () => {
      const mockCsvData =
        'ID,Title,Content,Type,Created\n1,test.txt,Test content,text/plain,2024-01-01';

      (mockKnowledgeService.exportKnowledge as Mock).mockResolvedValue(mockCsvData);

      const message: Memory = {
        id: generateMockUuid(56),
        content: {
          text: 'export knowledge as csv',
        },
        entityId: generateMockUuid(57),
        roomId: generateMockUuid(58),
      };

      await exportKnowledgeAction.handler?.(mockRuntime, message, mockState, {}, mockCallback);

      expect(mockKnowledgeService.exportKnowledge).toHaveBeenCalledWith({
        format: 'csv',
        includeMetadata: true,
        includeFragments: false,
      });
    });

    it('should detect Markdown format from message', async () => {
      const mockMarkdownData =
        '# Document 1\n\nContent here\n\n---\n\n# Document 2\n\nMore content';

      (mockKnowledgeService.exportKnowledge as Mock).mockResolvedValue(mockMarkdownData);

      const message: Memory = {
        id: generateMockUuid(59),
        content: {
          text: 'export knowledge as markdown',
        },
        entityId: generateMockUuid(60),
        roomId: generateMockUuid(61),
      };

      await exportKnowledgeAction.handler?.(mockRuntime, message, mockState, {}, mockCallback);

      expect(mockKnowledgeService.exportKnowledge).toHaveBeenCalledWith({
        format: 'markdown',
        includeMetadata: true,
        includeFragments: false,
      });
    });
  });

  describe('Batch Operations', () => {
    it('should handle batch add operations', async () => {
      const mockBatchResult = {
        successful: 3,
        failed: 0,
        results: [
          { id: '1', success: true, result: { fragmentCount: 5 } },
          { id: '2', success: true, result: { fragmentCount: 3 } },
          { id: '3', success: true, result: { fragmentCount: 4 } },
        ],
      };

      (mockKnowledgeService.batchOperation as Mock).mockResolvedValue(mockBatchResult);

      const batchOp = {
        operation: 'add' as const,
        items: [
          {
            data: {
              content: 'Doc 1',
              contentType: 'text/plain',
              clientDocumentId: generateMockUuid(71),
              originalFilename: 'doc1.txt',
              worldId: mockRuntime.agentId,
              roomId: mockRuntime.agentId,
              entityId: mockRuntime.agentId,
            },
          },
          {
            data: {
              content: 'Doc 2',
              contentType: 'text/plain',
              clientDocumentId: generateMockUuid(72),
              originalFilename: 'doc2.txt',
              worldId: mockRuntime.agentId,
              roomId: mockRuntime.agentId,
              entityId: mockRuntime.agentId,
            },
          },
          {
            data: {
              content: 'Doc 3',
              contentType: 'text/plain',
              clientDocumentId: generateMockUuid(73),
              originalFilename: 'doc3.txt',
              worldId: mockRuntime.agentId,
              roomId: mockRuntime.agentId,
              entityId: mockRuntime.agentId,
            },
          },
        ],
      };

      const result = await mockKnowledgeService.batchOperation(batchOp);

      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);
    });

    it('should handle mixed batch operations with failures', async () => {
      const mockBatchResult = {
        successful: 2,
        failed: 1,
        results: [
          { id: '1', success: true, result: { updated: true } },
          { id: '2', success: false, error: 'Document not found' },
          { id: '3', success: true, result: { deleted: true } },
        ],
      };

      (mockKnowledgeService.batchOperation as Mock).mockResolvedValue(mockBatchResult);

      const batchOp = {
        operation: 'update' as const,
        items: [
          { id: '1', metadata: { tags: ['updated'] } },
          { id: '2', metadata: { tags: ['missing'] } },
          { id: '3', metadata: { tags: ['deleted'] } },
        ],
      };

      const result = await mockKnowledgeService.batchOperation(batchOp);

      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.results[1].error).toBe('Document not found');
    });
  });

  describe('Import Operations', () => {
    it('should import JSON data', async () => {
      const jsonData = JSON.stringify({
        documents: [
          {
            id: generateMockUuid(70),
            content: { text: 'Imported document' },
            metadata: { contentType: 'text/plain' },
          },
        ],
      });

      const mockImportResult = {
        successful: 1,
        failed: 0,
        results: [{ id: generateMockUuid(70), success: true }],
      };

      (mockKnowledgeService.importKnowledge as Mock).mockResolvedValue(mockImportResult);

      const result = await mockKnowledgeService.importKnowledge(jsonData, {
        format: 'json',
        validateBeforeImport: true,
      });

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('should import CSV data', async () => {
      const csvData =
        'ID,Title,Content,Type,Created\n1,test.txt,Test content,text/plain,2024-01-01';

      const mockImportResult = {
        successful: 1,
        failed: 0,
        results: [{ id: '1', success: true }],
      };

      (mockKnowledgeService.importKnowledge as Mock).mockResolvedValue(mockImportResult);

      const result = await mockKnowledgeService.importKnowledge(csvData, {
        format: 'csv',
        overwriteExisting: false,
      });

      expect(result.successful).toBe(1);
    });
  });
});
