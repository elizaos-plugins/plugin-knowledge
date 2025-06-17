import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FragmentRepository } from '../../repositories/fragment-repository';
import type { KnowledgeFragment } from '../../types';
import type { UUID } from '@elizaos/core';

// Mock the schema
vi.mock('../../schema', () => ({
  knowledgeFragmentsTable: 'knowledge_fragments_table_mock',
}));

// Mock drizzle
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value })),
  sql: vi.fn((strings, ...values) => ({ query: strings.join(''), values })),
  asc: vi.fn((field) => ({ field, order: 'asc' })),
  desc: vi.fn((field) => ({ field, order: 'desc' })),
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  or: vi.fn((...conditions) => ({ type: 'or', conditions })),
  relations: vi.fn((table, callback) => ({
    table,
    relations: callback({ many: vi.fn(), one: vi.fn() }),
  })),
  cosineDistance: vi.fn((field, embedding) => ({ field, embedding })),
}));

describe('FragmentRepository', () => {
  let mockDb: any;
  let repository: FragmentRepository;

  const mockFragment: KnowledgeFragment = {
    id: 'fragment-123' as UUID,
    documentId: 'doc-123' as UUID,
    agentId: 'agent-123' as UUID,
    worldId: 'world-123' as UUID,
    roomId: 'room-123' as UUID,
    entityId: 'entity-123' as UUID,
    content: 'This is test fragment content',
    embedding: Array(1536).fill(0.1),
    position: 0,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    metadata: { custom: 'data' },
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock database with proper chaining
    const mockChain: any = {
      insert: vi.fn(),
      values: vi.fn(),
      returning: vi.fn(),
      select: vi.fn(),
      from: vi.fn(),
      where: vi.fn(),
      update: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      execute: vi.fn(),
      as: vi.fn(),
      $with: vi.fn(),
    };

    // Setup method chaining - each method returns mockChain
    Object.keys(mockChain).forEach((key) => {
      mockChain[key].mockReturnValue(mockChain);
    });

    // Override returning() to return promise-like chain
    mockChain.returning.mockImplementation(() => {
      // returning() should return a promise when awaited
      return Promise.resolve(mockChain._returnValue || []);
    });

    mockDb = mockChain;
    repository = new FragmentRepository(mockDb as any);
  });

  describe('create', () => {
    it('should create a fragment successfully', async () => {
      const expectedFragment = { ...mockFragment };
      mockDb._returnValue = [expectedFragment];

      const result = await repository.create(mockFragment);

      expect(mockDb.insert).toHaveBeenCalledWith('knowledge_fragments_table_mock');
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();
      expect(result).toMatchObject({
        id: mockFragment.id,
        content: mockFragment.content,
        documentId: mockFragment.documentId,
      });
    });

    it('should handle creation errors', async () => {
      // Simulate a database error by throwing when returning is called
      mockDb.returning.mockImplementation(() => {
        return Promise.reject(new Error('Database constraint violation'));
      });

      await expect(repository.create(mockFragment)).rejects.toThrow(
        'Database constraint violation'
      );
    });
  });

  describe('createBatch', () => {
    it('should create multiple fragments in batch', async () => {
      const fragments = [
        { ...mockFragment, id: 'fragment-1' as UUID, position: 0 },
        { ...mockFragment, id: 'fragment-2' as UUID, position: 1 },
        { ...mockFragment, id: 'fragment-3' as UUID, position: 2 },
      ];

      mockDb._returnValue = fragments;

      const result = await repository.createBatch(fragments);

      expect(mockDb.insert).toHaveBeenCalledWith('knowledge_fragments_table_mock');
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('fragment-1');
      expect(result[2].position).toBe(2);
    });

    it('should handle empty batch', async () => {
      const result = await repository.createBatch([]);

      expect(mockDb.insert).toHaveBeenCalledWith('knowledge_fragments_table_mock');
      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should find fragment by id', async () => {
      // For select queries, we need to override the chain differently
      const selectChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve([mockFragment])),
      };

      mockDb.select.mockReturnValue(selectChain);

      const result = await repository.findById(mockFragment.id);

      expect(mockDb.select).toHaveBeenCalled();
      expect(selectChain.where).toHaveBeenCalled();
      expect(selectChain.limit).toHaveBeenCalledWith(1);
      expect(result).toMatchObject({
        id: mockFragment.id,
        content: mockFragment.content,
      });
    });

    it('should return null when fragment not found', async () => {
      const selectChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve([])),
      };

      mockDb.select.mockReturnValue(selectChain);

      const result = await repository.findById('non-existent' as UUID);

      expect(result).toBeNull();
    });
  });

  describe('findByDocument', () => {
    it('should find fragments by document ID', async () => {
      const fragments = [
        { ...mockFragment, position: 0 },
        { ...mockFragment, position: 1 },
        { ...mockFragment, position: 2 },
      ];

      const selectChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve(fragments)),
      };

      mockDb.select.mockReturnValue(selectChain);

      const result = await repository.findByDocument(mockFragment.documentId);

      expect(mockDb.select).toHaveBeenCalled();
      expect(selectChain.where).toHaveBeenCalled();
      expect(selectChain.orderBy).toHaveBeenCalled();
      expect(result).toHaveLength(3);
      expect(result[0].position).toBe(0);
      expect(result[2].position).toBe(2);
    });

    it('should return empty array when no fragments found', async () => {
      const selectChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve([])),
      };

      mockDb.select.mockReturnValue(selectChain);

      const result = await repository.findByDocument('non-existent' as UUID);

      expect(result).toEqual([]);
    });
  });

  describe('searchByEmbedding', () => {
    it('should search fragments by embedding similarity', async () => {
      const embedding = Array(1536).fill(0.5);
      const searchResults = [
        { ...mockFragment, embedding: Array(1536).fill(0.9) },
        { ...mockFragment, id: 'fragment-2' as UUID, embedding: Array(1536).fill(0.7) },
        { ...mockFragment, id: 'fragment-3' as UUID, embedding: Array(1536).fill(0.5) },
      ];

      const selectChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve(searchResults)),
      };

      mockDb.select.mockReturnValue(selectChain);

      const result = await repository.searchByEmbedding(embedding, {
        agentId: mockFragment.agentId,
        limit: 10,
        threshold: 0.7,
      });

      expect(mockDb.select).toHaveBeenCalled();
      expect(selectChain.where).toHaveBeenCalled();
      expect(selectChain.orderBy).toHaveBeenCalled();
      expect(selectChain.limit).toHaveBeenCalledWith(10);
      expect(result).toHaveLength(3);
      // The similarity should be calculated by the repository
      expect(result[0]).toHaveProperty('similarity');
      expect(result[0].similarity).toBeGreaterThan(0);
    });

    it('should apply optional filters', async () => {
      const embedding = Array(1536).fill(0.5);

      const selectChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve([])),
      };

      mockDb.select.mockReturnValue(selectChain);

      await repository.searchByEmbedding(embedding, {
        agentId: mockFragment.agentId,
        roomId: 'room-456' as UUID,
        worldId: 'world-456' as UUID,
        entityId: 'entity-456' as UUID,
        limit: 5,
        threshold: 0.8,
      });

      expect(selectChain.where).toHaveBeenCalled();
      expect(selectChain.limit).toHaveBeenCalledWith(5);
    });
  });

  describe('updateEmbedding', () => {
    it('should update fragment embedding', async () => {
      const newEmbedding = Array(1536).fill(0.8);
      const updatedFragment = { ...mockFragment, embedding: newEmbedding };

      mockDb._returnValue = [updatedFragment];

      const result = await repository.updateEmbedding(mockFragment.id, newEmbedding);

      expect(mockDb.update).toHaveBeenCalledWith('knowledge_fragments_table_mock');
      expect(mockDb.set).toHaveBeenCalledWith({ embedding: newEmbedding });
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();
      expect(result?.embedding).toEqual(newEmbedding);
    });

    it('should return null when fragment not found', async () => {
      mockDb._returnValue = [];

      const result = await repository.updateEmbedding('non-existent' as UUID, Array(1536).fill(0));

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete fragment by id', async () => {
      mockDb._returnValue = [{ id: mockFragment.id }];

      const result = await repository.delete(mockFragment.id);

      expect(mockDb.delete).toHaveBeenCalledWith('knowledge_fragments_table_mock');
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when fragment not found', async () => {
      mockDb._returnValue = [];

      const result = await repository.delete(mockFragment.id);

      expect(result).toBe(false);
    });
  });

  describe('deleteByDocument', () => {
    it('should delete all fragments for a document', async () => {
      mockDb._returnValue = [{ id: '1' }, { id: '2' }, { id: '3' }];

      const result = await repository.deleteByDocument(mockFragment.documentId);

      expect(mockDb.delete).toHaveBeenCalledWith('knowledge_fragments_table_mock');
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();
      expect(result).toBe(3);
    });

    it('should return 0 when no fragments deleted', async () => {
      mockDb._returnValue = [];

      const result = await repository.deleteByDocument(mockFragment.documentId);

      expect(result).toBe(0);
    });
  });

  describe('countByDocument', () => {
    it('should count fragments for a document', async () => {
      const selectChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve([{ count: 5 }])),
      };

      mockDb.select.mockReturnValue(selectChain);

      const result = await repository.countByDocument(mockFragment.documentId);

      expect(mockDb.select).toHaveBeenCalled();
      expect(selectChain.where).toHaveBeenCalled();
      expect(result).toBe(5);
    });

    it('should return 0 when no fragments exist', async () => {
      const selectChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve([{ count: 0 }])),
      };

      mockDb.select.mockReturnValue(selectChain);

      const result = await repository.countByDocument('non-existent' as UUID);

      expect(result).toBe(0);
    });

    it('should handle null count result', async () => {
      const selectChain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve([{ count: null }])),
      };

      mockDb.select.mockReturnValue(selectChain);

      const result = await repository.countByDocument(mockFragment.documentId);

      expect(result).toBe(0);
    });
  });
});
