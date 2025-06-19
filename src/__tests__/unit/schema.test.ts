import { describe, it, expect } from 'vitest';
import { documentsTable, knowledgeFragmentsTable, knowledgeSchema } from '../../schema';
import { v4 as uuidv4 } from 'uuid';
import type { UUID } from '@elizaos/core';

describe('Knowledge Schema', () => {
  describe('Schema Structure', () => {
    it('should export documents table', () => {
      expect(documentsTable).toBeDefined();
      expect(documentsTable.id).toBeDefined();
      expect(documentsTable.agentId).toBeDefined();
      expect(documentsTable.originalFilename).toBeDefined();
      expect(documentsTable.content).toBeDefined();
    });

    it('should export knowledge fragments table', () => {
      expect(knowledgeFragmentsTable).toBeDefined();
      expect(knowledgeFragmentsTable.id).toBeDefined();
      expect(knowledgeFragmentsTable.documentId).toBeDefined();
      expect(knowledgeFragmentsTable.content).toBeDefined();
      expect(knowledgeFragmentsTable.embedding).toBeDefined();
    });

    it('should export complete schema', () => {
      expect(knowledgeSchema).toBeDefined();
      expect(knowledgeSchema.documentsTable).toBe(documentsTable);
      expect(knowledgeSchema.knowledgeFragmentsTable).toBe(knowledgeFragmentsTable);
    });
  });

  describe('Table Columns', () => {
    it('documents table should have all required columns', () => {
      // Check that columns exist
      expect(documentsTable.id).toBeDefined();
      expect(documentsTable.agentId).toBeDefined();
      expect(documentsTable.worldId).toBeDefined();
      expect(documentsTable.roomId).toBeDefined();
      expect(documentsTable.entityId).toBeDefined();
      expect(documentsTable.originalFilename).toBeDefined();
      expect(documentsTable.contentType).toBeDefined();
      expect(documentsTable.content).toBeDefined();
      expect(documentsTable.fileSize).toBeDefined();
      expect(documentsTable.title).toBeDefined();
      expect(documentsTable.sourceUrl).toBeDefined();
      expect(documentsTable.createdAt).toBeDefined();
      expect(documentsTable.updatedAt).toBeDefined();
      expect(documentsTable.metadata).toBeDefined();
    });

    it('knowledge_fragments table should have all required columns', () => {
      // Check that columns exist
      expect(knowledgeFragmentsTable.id).toBeDefined();
      expect(knowledgeFragmentsTable.documentId).toBeDefined();
      expect(knowledgeFragmentsTable.agentId).toBeDefined();
      expect(knowledgeFragmentsTable.worldId).toBeDefined();
      expect(knowledgeFragmentsTable.roomId).toBeDefined();
      expect(knowledgeFragmentsTable.entityId).toBeDefined();
      expect(knowledgeFragmentsTable.content).toBeDefined();
      expect(knowledgeFragmentsTable.embedding).toBeDefined();
      expect(knowledgeFragmentsTable.position).toBeDefined();
      expect(knowledgeFragmentsTable.createdAt).toBeDefined();
      expect(knowledgeFragmentsTable.metadata).toBeDefined();
    });
  });

  describe('Foreign Key Relationships', () => {
    it('knowledge_fragments should have documentId column', () => {
      // Just check that the column exists
      expect(knowledgeFragmentsTable.documentId).toBeDefined();
    });
  });

  describe('Table Structure', () => {
    it('should define valid document structure', () => {
      // Test that all fields map to columns
      expect(documentsTable.id).toBeDefined();
      expect(documentsTable.agentId).toBeDefined();
      expect(documentsTable.worldId).toBeDefined();
      expect(documentsTable.roomId).toBeDefined();
      expect(documentsTable.entityId).toBeDefined();
      expect(documentsTable.originalFilename).toBeDefined();
      expect(documentsTable.contentType).toBeDefined();
      expect(documentsTable.content).toBeDefined();
      expect(documentsTable.fileSize).toBeDefined();
      expect(documentsTable.title).toBeDefined();
      expect(documentsTable.createdAt).toBeDefined();
      expect(documentsTable.updatedAt).toBeDefined();
    });

    it('should define valid fragment structure', () => {
      // Test that all fields map to columns
      expect(knowledgeFragmentsTable.id).toBeDefined();
      expect(knowledgeFragmentsTable.documentId).toBeDefined();
      expect(knowledgeFragmentsTable.agentId).toBeDefined();
      expect(knowledgeFragmentsTable.worldId).toBeDefined();
      expect(knowledgeFragmentsTable.roomId).toBeDefined();
      expect(knowledgeFragmentsTable.entityId).toBeDefined();
      expect(knowledgeFragmentsTable.content).toBeDefined();
      expect(knowledgeFragmentsTable.embedding).toBeDefined();
      expect(knowledgeFragmentsTable.position).toBeDefined();
      expect(knowledgeFragmentsTable.createdAt).toBeDefined();
    });

    it('should have documentId foreign key column', () => {
      // Just verify the column exists
      expect(knowledgeFragmentsTable.documentId).toBeDefined();
    });
  });
});
