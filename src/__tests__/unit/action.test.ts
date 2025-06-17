import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { processKnowledgeAction } from '../../actions';
import { KnowledgeService } from '../../service';
import type { IAgentRuntime, Memory, Content, State, UUID } from '@elizaos/core';
import * as fs from 'fs';
import * as path from 'path';

// Mock @elizaos/core logger and createUniqueUuid
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
    createUniqueUuid: vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (seed: string, name: string) => `mocked-uuid-${name}` as UUID
    ),
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

      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(Buffer.from('file content'));
      (path.basename as Mock).mockReturnValue('document.pdf');
      (path.extname as Mock).mockReturnValue('.pdf');
      (mockKnowledgeService.addKnowledge as Mock).mockResolvedValue({ fragmentCount: 5 });

      await processKnowledgeAction.handler?.(mockRuntime, message, mockState, {}, mockCallback);

      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/document.pdf');
      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/document.pdf');
      expect(mockKnowledgeService.addKnowledge).toHaveBeenCalledWith({
        clientDocumentId: 'mocked-uuid-document.pdf' as UUID,
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

      await processKnowledgeAction.handler?.(mockRuntime, message, mockState, {}, mockCallback);

      expect(fs.existsSync).toHaveBeenCalledWith('/non/existent/file.txt');
      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(mockKnowledgeService.addKnowledge).not.toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith({
        text: "I couldn't find the file at /non/existent/file.txt. Please check the path and try again.",
      });
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

      await processKnowledgeAction.handler?.(mockRuntime, message, mockState, {}, mockCallback);

      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(mockKnowledgeService.addKnowledge).toHaveBeenCalledWith({
        clientDocumentId: 'mocked-uuid-user-knowledge' as UUID,
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

      await processKnowledgeAction.handler?.(mockRuntime, message, mockState, {}, mockCallback);

      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(mockKnowledgeService.addKnowledge).not.toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I need some content to add to my knowledge base. Please provide text or a file path.',
      });
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

      await processKnowledgeAction.handler?.(mockRuntime, message, mockState, {}, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I encountered an error while processing the knowledge: Service error',
      });
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
