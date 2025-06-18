import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { searchKnowledgeAction } from '../../actions';
import { KnowledgeService } from '../../service';
import type { IAgentRuntime, Memory, Content, State, UUID, ActionResult, Action, Handler } from '@elizaos/core';

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

describe('Action Chaining with Knowledge Plugin', () => {
  let mockRuntime: IAgentRuntime;
  let mockKnowledgeService: KnowledgeService;
  let mockCallback: Mock;
  let mockState: State;

  const generateMockUuid = (suffix: string | number): UUID =>
    `00000000-0000-0000-0000-${String(suffix).padStart(12, '0')}` as UUID;

  // Mock actions that can consume search results
  const mockAnalyzeAction: Action = {
    name: 'ANALYZE_KNOWLEDGE',
    description: 'Analyze knowledge search results',
    similes: ['analyze', 'examine', 'study'],
    validate: vi.fn().mockResolvedValue(true),
    handler: vi.fn() as Handler,
  };

  const mockSummarizeAction: Action = {
    name: 'SUMMARIZE_KNOWLEDGE',
    description: 'Summarize knowledge search results',
    similes: ['summarize', 'condense', 'brief'],
    validate: vi.fn().mockResolvedValue(true),
    handler: vi.fn() as Handler,
  };

  beforeEach(() => {
    mockKnowledgeService = {
      addKnowledge: vi.fn(),
      getKnowledge: vi.fn(),
      serviceType: 'knowledge-service',
    } as unknown as KnowledgeService;

    mockRuntime = {
      agentId: 'test-agent' as UUID,
      getService: vi.fn().mockReturnValue(mockKnowledgeService),
      actions: [searchKnowledgeAction, mockAnalyzeAction, mockSummarizeAction],
      getSetting: vi.fn(),
    } as unknown as IAgentRuntime;

    mockCallback = vi.fn();
    mockState = {
      values: {},
      data: {},
      text: '',
    };
    vi.clearAllMocks();
  });

  describe('Search Knowledge Action Chaining', () => {
    it('should return ActionResult with data that can be used by other actions', async () => {
      // Setup mock search results
      const mockSearchResults = [
        {
          id: generateMockUuid(1),
          content: { text: 'Quantum computing uses qubits instead of classical bits.' },
          metadata: { source: 'quantum-basics.pdf' },
        },
        {
          id: generateMockUuid(2),
          content: { text: 'Quantum superposition allows qubits to exist in multiple states simultaneously.' },
          metadata: { source: 'quantum-theory.pdf' },
        },
        {
          id: generateMockUuid(3),
          content: { text: 'Quantum entanglement enables instant correlation between particles.' },
          metadata: { source: 'quantum-phenomena.pdf' },
        },
      ];

      (mockKnowledgeService.getKnowledge as Mock).mockResolvedValue(mockSearchResults);

      const searchMessage: Memory = {
        id: generateMockUuid(4),
        content: {
          text: 'Search your knowledge for information about quantum computing',
        },
        entityId: generateMockUuid(5),
        roomId: generateMockUuid(6),
      };

      // Execute search action
      const searchResult = await searchKnowledgeAction.handler?.(
        mockRuntime,
        searchMessage,
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      // Verify search action returns proper ActionResult
      expect(searchResult).toBeDefined();
      expect(searchResult.data).toBeDefined();
      expect(searchResult.data?.query).toBe('information about quantum computing');
      expect(searchResult.data?.results).toEqual(mockSearchResults);
      expect(searchResult.data?.count).toBe(3);
      expect(searchResult.text).toContain("Here's what I found");

      // Verify callback was called with response
      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('quantum computing'),
      });
    });

    it('should enable ANALYZE_KNOWLEDGE action to process search results', async () => {
      // Setup search results
      const mockSearchResults = [
        {
          id: generateMockUuid(7),
          content: { text: 'Machine learning models can be trained using supervised learning.' },
          metadata: { source: 'ml-basics.pdf', timestamp: '2024-01-15' },
        },
        {
          id: generateMockUuid(8),
          content: { text: 'Deep learning uses neural networks with multiple hidden layers.' },
          metadata: { source: 'dl-intro.pdf', timestamp: '2024-01-20' },
        },
      ];

      (mockKnowledgeService.getKnowledge as Mock).mockResolvedValue(mockSearchResults);

      // First, execute search
      const searchMessage: Memory = {
        id: generateMockUuid(9),
        content: { text: 'Search knowledge for machine learning concepts' },
        entityId: generateMockUuid(10),
        roomId: generateMockUuid(11),
      };

      const searchResult = await searchKnowledgeAction.handler?.(
        mockRuntime,
        searchMessage,
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      // Now use search results in analyze action
      const analyzeMessage: Memory = {
        id: generateMockUuid(12),
        content: {
          text: 'Analyze the search results',
          data: searchResult.data, // Pass search results data
        },
        entityId: generateMockUuid(13),
        roomId: generateMockUuid(14),
      };

      // Mock analyze action handler to process search results
      (mockAnalyzeAction.handler as Mock).mockImplementation(
        async (runtime, message, state, options, callback) => {
          const searchData = message.content.data;
          expect(searchData).toBeDefined();
          expect(searchData.results).toHaveLength(2);
          
          // Perform analysis on search results
          const analysis = {
            totalResults: searchData.count,
            sources: searchData.results.map((r: any) => r.metadata.source),
            topics: ['supervised learning', 'neural networks', 'deep learning'],
            dateRange: {
              earliest: '2024-01-15',
              latest: '2024-01-20',
            },
            summary: 'Knowledge base contains foundational ML and DL concepts from 2 documents.',
          };

          const response: Content = {
            text: `Analysis complete: Found ${analysis.totalResults} results covering ${analysis.topics.join(', ')}.`,
          };

          if (callback) {
            await callback(response);
          }

          return {
            data: { analysis },
            text: response.text,
          };
        }
      );

      // Execute analyze action with search results
      const analyzeResult = await mockAnalyzeAction.handler(
        mockRuntime,
        analyzeMessage,
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      // Verify analysis results
      expect(analyzeResult).toBeDefined();
      expect(analyzeResult.data?.analysis).toBeDefined();
      expect(analyzeResult.data?.analysis.totalResults).toBe(2);
      expect(analyzeResult.data?.analysis.sources).toEqual(['ml-basics.pdf', 'dl-intro.pdf']);
      expect(analyzeResult.text).toContain('Analysis complete');
    });

    it('should enable SUMMARIZE_KNOWLEDGE action to condense search results', async () => {
      // Setup extensive search results
      const mockSearchResults = [
        {
          id: generateMockUuid(15),
          content: { text: 'Climate change is primarily driven by greenhouse gas emissions from human activities.' },
          metadata: { source: 'climate-causes.pdf' },
        },
        {
          id: generateMockUuid(16),
          content: { text: 'Rising global temperatures lead to melting ice caps and rising sea levels.' },
          metadata: { source: 'climate-effects.pdf' },
        },
        {
          id: generateMockUuid(17),
          content: { text: 'Renewable energy sources like solar and wind can help mitigate climate change.' },
          metadata: { source: 'climate-solutions.pdf' },
        },
        {
          id: generateMockUuid(18),
          content: { text: 'International cooperation through agreements like the Paris Climate Accord is essential.' },
          metadata: { source: 'climate-policy.pdf' },
        },
      ];

      (mockKnowledgeService.getKnowledge as Mock).mockResolvedValue(mockSearchResults);

      // Execute search
      const searchMessage: Memory = {
        id: generateMockUuid(19),
        content: { text: 'Search knowledge about climate change' },
        entityId: generateMockUuid(20),
        roomId: generateMockUuid(21),
      };

      const searchResult = await searchKnowledgeAction.handler?.(
        mockRuntime,
        searchMessage,
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      // Use search results in summarize action
      const summarizeMessage: Memory = {
        id: generateMockUuid(22),
        content: {
          text: 'Summarize these climate change findings',
          data: searchResult.data,
        },
        entityId: generateMockUuid(23),
        roomId: generateMockUuid(24),
      };

      // Mock summarize action handler
      (mockSummarizeAction.handler as Mock).mockImplementation(
        async (runtime, message, state, options, callback) => {
          const searchData = message.content.data;
          expect(searchData).toBeDefined();
          expect(searchData.results).toHaveLength(4);
          
          // Create summary from search results
          const summary = {
            mainPoints: [
              'Human activities cause greenhouse gas emissions',
              'Effects include melting ice and rising seas',
              'Renewable energy offers solutions',
              'International cooperation is key',
            ],
            sources: searchData.results.length,
            condensedText: 'Climate change, driven by human emissions, causes rising temperatures and sea levels. Solutions include renewable energy and international cooperation.',
          };

          const response: Content = {
            text: `Summary: ${summary.condensedText}`,
          };

          if (callback) {
            await callback(response);
          }

          return {
            data: { summary },
            text: response.text,
          };
        }
      );

      // Execute summarize action
      const summarizeResult = await mockSummarizeAction.handler(
        mockRuntime,
        summarizeMessage,
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      // Verify summary results
      expect(summarizeResult).toBeDefined();
      expect(summarizeResult.data?.summary).toBeDefined();
      expect(summarizeResult.data?.summary.mainPoints).toHaveLength(4);
      expect(summarizeResult.data?.summary.sources).toBe(4);
      expect(summarizeResult.text).toContain('Climate change');
    });

    it('should handle empty search results in chained actions', async () => {
      // Mock empty search results
      (mockKnowledgeService.getKnowledge as Mock).mockResolvedValue([]);

      const searchMessage: Memory = {
        id: generateMockUuid(25),
        content: { text: 'Search for non-existent topic' },
        entityId: generateMockUuid(26),
        roomId: generateMockUuid(27),
      };

      const searchResult = await searchKnowledgeAction.handler?.(
        mockRuntime,
        searchMessage,
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      // Verify empty results
      expect(searchResult.data?.results).toEqual([]);
      expect(searchResult.data?.count).toBe(0);

      // Try to analyze empty results
      const analyzeMessage: Memory = {
        id: generateMockUuid(28),
        content: {
          text: 'Analyze the search results',
          data: searchResult.data,
        },
        entityId: generateMockUuid(29),
        roomId: generateMockUuid(30),
      };

      (mockAnalyzeAction.handler as Mock).mockImplementation(
        async (runtime, message, state, options, callback) => {
          const searchData = message.content.data;
          
          if (searchData.count === 0) {
            const response: Content = {
              text: 'No results to analyze.',
            };
            
            if (callback) {
              await callback(response);
            }
            
            return {
              data: { analysis: { message: 'No data available for analysis' } },
              text: response.text,
            };
          }
        }
      );

      const analyzeResult = await mockAnalyzeAction.handler(
        mockRuntime,
        analyzeMessage,
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      expect(analyzeResult.data?.analysis.message).toBe('No data available for analysis');
    });

    it('should support multi-step action chains with progressive refinement', async () => {
      // Initial broad search
      const broadSearchResults = Array.from({ length: 10 }, (_, i) => ({
        id: generateMockUuid(100 + i),
        content: { text: `AI concept ${i + 1}: Various aspects of artificial intelligence.` },
        metadata: { 
          source: `ai-doc-${i + 1}.pdf`,
          relevance: Math.random(),
          category: i < 5 ? 'machine-learning' : 'neural-networks',
        },
      }));

      (mockKnowledgeService.getKnowledge as Mock).mockResolvedValue(broadSearchResults);

      // Step 1: Initial search
      const searchResult = await searchKnowledgeAction.handler?.(
        mockRuntime,
        {
          id: generateMockUuid(31),
          content: { text: 'Search knowledge about AI' },
          entityId: generateMockUuid(32),
          roomId: generateMockUuid(33),
        },
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      expect(searchResult.data?.count).toBe(10);

      // Step 2: Filter action (mock)
      const mockFilterAction: Action = {
        name: 'FILTER_KNOWLEDGE',
        description: 'Filter knowledge results',
        validate: vi.fn().mockResolvedValue(true),
        handler: vi.fn().mockImplementation(async (runtime, message, state, options, callback) => {
          const searchData = message.content.data;
          const filtered = searchData.results.filter((r: any) => 
            r.metadata.category === 'machine-learning'
          );
          
          return {
            data: {
              results: filtered,
              count: filtered.length,
              filterCriteria: 'category=machine-learning',
            },
            text: `Filtered to ${filtered.length} machine learning results.`,
          };
        }) as Handler,
      };

      // Step 3: Apply filter
      const filterResult = await mockFilterAction.handler(
        mockRuntime,
        {
          id: generateMockUuid(34),
          content: {
            text: 'Filter for machine learning only',
            data: searchResult.data,
          },
          entityId: generateMockUuid(35),
          roomId: generateMockUuid(36),
        },
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      expect(filterResult.data?.count).toBe(5);
      expect(filterResult.data?.filterCriteria).toBe('category=machine-learning');

      // Step 4: Rank action (mock)
      const mockRankAction: Action = {
        name: 'RANK_KNOWLEDGE',
        description: 'Rank knowledge by relevance',
        validate: vi.fn().mockResolvedValue(true),
        handler: vi.fn().mockImplementation(async (runtime, message, state, options, callback) => {
          const data = message.content.data;
          const ranked = [...data.results].sort((a: any, b: any) => 
            b.metadata.relevance - a.metadata.relevance
          );
          
          return {
            data: {
              results: ranked.slice(0, 3), // Top 3
              count: 3,
              ranking: 'relevance-descending',
            },
            text: `Top 3 most relevant results selected.`,
          };
        }) as Handler,
      };

      // Step 5: Apply ranking
      const rankResult = await mockRankAction.handler(
        mockRuntime,
        {
          id: generateMockUuid(37),
          content: {
            text: 'Rank by relevance and get top 3',
            data: filterResult.data,
          },
          entityId: generateMockUuid(38),
          roomId: generateMockUuid(39),
        },
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      expect(rankResult.data?.count).toBe(3);
      expect(rankResult.data?.ranking).toBe('relevance-descending');

      // Verify the chain maintained data integrity
      expect(searchResult.data?.count).toBe(10); // Original
      expect(filterResult.data?.count).toBe(5);  // After filter
      expect(rankResult.data?.count).toBe(3);    // After ranking
    });
  });

  describe('Error Handling in Action Chains', () => {
    it('should handle errors gracefully when search fails', async () => {
      (mockKnowledgeService.getKnowledge as Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const searchMessage: Memory = {
        id: generateMockUuid(40),
        content: { text: 'Search for something' },
        entityId: generateMockUuid(41),
        roomId: generateMockUuid(42),
      };

      const searchResult = await searchKnowledgeAction.handler?.(
        mockRuntime,
        searchMessage,
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      // Verify error is captured in ActionResult
      expect(searchResult.data?.error).toBe('Database connection failed');
      expect(searchResult.text).toContain('encountered an error');

      // Downstream action should handle error gracefully
      (mockAnalyzeAction.handler as Mock).mockImplementation(
        async (runtime, message, state, options, callback) => {
          const data = message.content.data;
          
          if (data?.error) {
            return {
              data: { 
                analysis: { 
                  error: `Cannot analyze due to upstream error: ${data.error}` 
                } 
              },
              text: 'Analysis failed due to search error.',
            };
          }
        }
      );

      const analyzeResult = await mockAnalyzeAction.handler(
        mockRuntime,
        {
          id: generateMockUuid(43),
          content: {
            text: 'Analyze results',
            data: searchResult.data,
          },
          entityId: generateMockUuid(44),
          roomId: generateMockUuid(45),
        },
        mockState,
        {},
        mockCallback
      ) as ActionResult;

      expect(analyzeResult.data?.analysis.error).toContain('Cannot analyze due to upstream error');
    });
  });
}); 