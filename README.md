# Knowledge Plugin for ElizaOS

This plugin gives your agent the ability to learn from documents and answer questions based on that knowledge.

## 🚀 Quick Start (No Configuration Needed!)

If you already have **plugin-openai** configured in your agent, this plugin works automatically! Just add it to your agent and you're done.

```typescript
import { knowledgePlugin } from '@elizaos/plugin-knowledge';

// Add to your agent's plugins
plugins: [
  '@elizaos/plugin-knowledge',
  // ... other plugins
];
```

That's it! Your agent can now process and learn from documents.

## 📁 Auto-Load Documents on Startup

Want your agent to automatically learn from documents when it starts? Just:

1. **Add this to your `.env` file:**

   ```env
   LOAD_DOCS_ON_STARTUP=true
   ```

2. **Create a `knowledge` or `docs` folder in your project root and add your documents:**

   ```
   your-project/
   ├── .env
   ├── knowledge/      <-- Create this folder (or docs/)
   │   ├── guide.pdf
   │   ├── manual.txt
   │   └── notes.md
   └── ... other files
   ```

3. **Start your agent** - it will automatically load all documents from the `knowledge` folder (or `docs` if `knowledge` doesn't exist)!

### Supported File Types

- 📄 **Documents:** PDF, TXT, MD, DOC, DOCX
- 💻 **Code:** JS, TS, PY, and many more
- 📊 **Data:** JSON, CSV, XML, YAML

## 💬 How to Use

Once documents are loaded, just ask your agent questions naturally:

- "What does the guide say about setup?"
- "Search your knowledge for information about configuration"
- "What do you know about [topic]?"

Your agent will search through all loaded documents and provide relevant answers!

## 🎯 Actions Available

The plugin provides these actions that your agent can use:

1. **PROCESS_KNOWLEDGE** - Add new documents or text to the knowledge base

   - "Process the document at /path/to/file.pdf"
   - "Remember this: The sky is blue"

2. **SEARCH_KNOWLEDGE** - Search the knowledge base
   - "Search your knowledge for quantum computing"

## 🌐 Web Interface

The plugin includes a web interface for managing documents! Access it at:

```
http://localhost:3000/api/agents/[your-agent-id]/plugins/knowledge/display
```

---

## ⚠️ Advanced Configuration (Developers Only)

**Note: If you're not a developer, don't use the settings below! The plugin works great with just the quick start setup above.**

<details>
<summary>Click to show advanced configuration options</summary>

### Custom Document Path

Change where documents are loaded from:

```env
KNOWLEDGE_PATH=/path/to/your/documents
```

### Enhanced Contextual Knowledge

For better understanding of complex documents:

```env
CTX_KNOWLEDGE_ENABLED=true
TEXT_PROVIDER=openrouter
TEXT_MODEL=anthropic/claude-3.5-sonnet
OPENROUTER_API_KEY=your-api-key
```

### Custom Embedding Configuration

If not using plugin-openai:

```env
EMBEDDING_PROVIDER=openai
TEXT_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=your-api-key
```

### All Configuration Options

```env
# Document Loading
LOAD_DOCS_ON_STARTUP=true          # Auto-load from knowledge/docs folder
KNOWLEDGE_PATH=/custom/path        # Custom document path

# Contextual Enhancement (improves understanding)
CTX_KNOWLEDGE_ENABLED=true         # Enable contextual embeddings

# Embedding Provider (if not using plugin-openai)
EMBEDDING_PROVIDER=openai          # or google
TEXT_EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1536

# Text Generation Provider (for contextual mode)
TEXT_PROVIDER=openai               # or anthropic, openrouter, google
TEXT_MODEL=gpt-4o                  # Model name for your provider

# API Keys (based on providers used)
OPENAI_API_KEY=your-key
ANTHROPIC_API_KEY=your-key
OPENROUTER_API_KEY=your-key
GOOGLE_API_KEY=your-key

# Rate Limiting
MAX_CONCURRENT_REQUESTS=30
REQUESTS_PER_MINUTE=60
TOKENS_PER_MINUTE=150000

# Token Limits
MAX_INPUT_TOKENS=4000
MAX_OUTPUT_TOKENS=4096
```

### API Routes Reference

- `POST /api/agents/{agentId}/plugins/knowledge/documents` - Upload documents
- `GET /api/agents/{agentId}/plugins/knowledge/documents` - List documents
- `GET /api/agents/{agentId}/plugins/knowledge/documents/{id}` - Get specific document
- `DELETE /api/agents/{agentId}/plugins/knowledge/documents/{id}` - Delete document
- `GET /api/agents/{agentId}/plugins/knowledge/display` - Web interface

### Programmatic Usage

```typescript
import { KnowledgeService } from '@elizaos/plugin-knowledge';

// Add knowledge programmatically
const result = await knowledgeService.addKnowledge({
  clientDocumentId: 'unique-id',
  content: documentContent,
  contentType: 'application/pdf',
  originalFilename: 'document.pdf',
  worldId: 'world-id',
  roomId: 'room-id',
  entityId: 'entity-id',
});
```

</details>

## 📝 License

See the ElizaOS license for details.
