import { TestCase, IAgentRuntime, UUID } from '@elizaos/core';
import { KnowledgeService } from '../../service';
import path from 'path';
import fs from 'fs/promises';
import { DocumentRepository, FragmentRepository } from '../../repositories';
import { v4 as uuidv4 } from 'uuid';

const testCase: TestCase = {
  name: 'Knowledge Service Startup Loading',

  async fn(runtime: IAgentRuntime): Promise<void> {
    // Test 1: Service initialization
    const service = runtime.getService('knowledge') as KnowledgeService;
    if (!service) {
      throw new Error('Knowledge service not found');
    }
    console.log('✓ Knowledge service initialized');

    // Test 2: Check if new tables are being used
    const useNewTables = runtime.getSetting('KNOWLEDGE_USE_NEW_TABLES') === 'true';
    console.log(`✓ Using new tables: ${useNewTables}`);

    // Test 3: Create test documents directory
    const docsPath = path.join(process.cwd(), 'docs');
    await fs.mkdir(docsPath, { recursive: true });
    console.log('✓ Created docs directory');

    // Test 4: Create test documents
    const testDocs = [
      {
        filename: 'test-document-1.md',
        content: `# Test Document 1
        
This is a test document for the knowledge service.
It contains multiple paragraphs to test chunking.

## Section 1
This section tests how the system handles markdown headers.
It should properly extract and chunk this content.

## Section 2  
Another section with different content.
This helps test the fragment creation process.`,
      },
      {
        filename: 'test-document-2.txt',
        content: `Plain text document for testing.
        
This document doesn't have markdown formatting.
It should still be processed correctly by the knowledge service.

The system should handle both markdown and plain text files.`,
      },
    ];

    for (const doc of testDocs) {
      await fs.writeFile(path.join(docsPath, doc.filename), doc.content);
    }
    console.log('✓ Created test documents');

    // Test 5: Wait for initial document loading (if enabled)
    const loadDocsOnStartup = runtime.getSetting('LOAD_DOCS_ON_STARTUP') !== 'false';
    if (loadDocsOnStartup) {
      // Give the service time to load documents
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log('✓ Waited for startup document loading');
    }

    // Test 6: Manually trigger document loading
    const { loadDocsFromPath } = await import('../../docs-loader');
    const loadResult = await loadDocsFromPath(service, runtime.agentId);

    if (loadResult.successful !== testDocs.length) {
      throw new Error(
        `Expected ${testDocs.length} documents to be loaded, but got ${loadResult.successful}`
      );
    }
    console.log(`✓ Loaded ${loadResult.successful} documents`);

    // Test 7: Verify documents in database
    const documents = await service.getMemories({
      tableName: 'documents',
      count: 100,
    });

    const loadedDocs = documents.filter((d) =>
      testDocs.some((td) => (d.metadata as any)?.originalFilename === td.filename)
    );

    if (loadedDocs.length !== testDocs.length) {
      throw new Error(
        `Expected ${testDocs.length} documents in database, but found ${loadedDocs.length}`
      );
    }
    console.log(`✓ Found ${loadedDocs.length} documents in database`);

    // Test 8: Verify fragments were created
    const fragments = await service.getMemories({
      tableName: 'knowledge',
      count: 100,
    });

    const relatedFragments = fragments.filter((f) =>
      loadedDocs.some((d) => (f.metadata as any)?.documentId === d.id)
    );

    if (relatedFragments.length === 0) {
      throw new Error('No fragments found for loaded documents');
    }
    console.log(`✓ Found ${relatedFragments.length} fragments for documents`);

    // Test 9: Test knowledge retrieval
    const testMessage = {
      id: 'test-message-1',
      content: { text: 'Tell me about markdown headers' },
      agentId: runtime.agentId,
      roomId: runtime.agentId,
      createdAt: Date.now(),
    };

    const knowledgeItems = await service.getKnowledge(testMessage as any);

    if (knowledgeItems.length === 0) {
      throw new Error('No knowledge items retrieved for test query');
    }
    console.log(`✓ Retrieved ${knowledgeItems.length} knowledge items`);

    // Test 10: Verify relevance - should find content about markdown headers
    const relevantItems = knowledgeItems.filter(
      (item) =>
        item.content.text?.toLowerCase().includes('markdown') ||
        item.content.text?.toLowerCase().includes('header')
    );

    if (relevantItems.length === 0) {
      throw new Error('Retrieved knowledge items are not relevant to the query');
    }
    console.log(`✓ Found ${relevantItems.length} relevant knowledge items`);

    // Test 11: Test document deletion
    const docToDelete = loadedDocs[0];
    await service.deleteMemory(docToDelete.id as UUID);

    const remainingDocs = await service.getMemories({
      tableName: 'documents',
      count: 100,
    });

    const deletedDoc = remainingDocs.find((d) => d.id === docToDelete.id);
    if (deletedDoc) {
      throw new Error('Document was not deleted');
    }
    console.log('✓ Successfully deleted document');

    // Test 12: Verify cascade delete - fragments should be deleted too
    const remainingFragments = await service.getMemories({
      tableName: 'knowledge',
      count: 100,
    });

    const orphanedFragments = remainingFragments.filter(
      (f) => (f.metadata as any)?.documentId === docToDelete.id
    );

    if (orphanedFragments.length > 0) {
      throw new Error('Fragments were not cascade deleted with document');
    }
    console.log('✓ Fragments were cascade deleted');

    // Test 13: Test adding knowledge via API
    const apiKnowledge = {
      clientDocumentId: uuidv4() as UUID,
      contentType: 'text/plain',
      originalFilename: 'api-test.txt',
      worldId: runtime.agentId as UUID,
      roomId: runtime.agentId as UUID,
      entityId: runtime.agentId as UUID,
      content: 'This is content added via the API. It should be processed and stored correctly.',
      metadata: { source: 'api' },
    };

    const apiResult = await service.addKnowledge(apiKnowledge);

    if (!apiResult.storedDocumentMemoryId) {
      throw new Error('Failed to add knowledge via API');
    }
    console.log(`✓ Added knowledge via API, ${apiResult.fragmentCount} fragments created`);

    // Test 14: Verify API-added document exists
    const apiDoc = await runtime.getMemoryById(apiResult.storedDocumentMemoryId);
    if (!apiDoc) {
      throw new Error('API-added document not found in database');
    }
    console.log('✓ API-added document verified in database');

    // Test 15: Test duplicate prevention
    const duplicateResult = await service.addKnowledge(apiKnowledge);

    if (duplicateResult.storedDocumentMemoryId !== apiResult.storedDocumentMemoryId) {
      throw new Error('Duplicate document was created instead of returning existing');
    }
    console.log('✓ Duplicate prevention working correctly');

    // Cleanup
    await fs.rm(docsPath, { recursive: true, force: true });
    console.log('✓ Cleaned up test documents');
    console.log('All knowledge service startup loading tests passed!');
  },
};

export default testCase;
