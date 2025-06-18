import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const server = createServer((req, res) => {
  console.log(`Request: ${req.method} ${req.url}`);

  // Handle root path for health check
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // Handle test components page
  if (req.url === '/test-components') {
    const testPagePath = join(__dirname, '..', 'src', 'frontend', 'test-components.html');
    try {
      const html = readFileSync(testPagePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      res.writeHead(404);
      res.end('Test components page not found');
    }
    return;
  }

  // Handle knowledge page and plugin display routes
  if (req.url.startsWith('/knowledge') || req.url.includes('/plugins/knowledge/display')) {
    const agentId = 'test-agent-123';
    const html = `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knowledge - Test</title>
  <script>
    window.ELIZA_CONFIG = {
      agentId: '${agentId}',
      apiBase: ''
    };
  </script>
  <link rel="stylesheet" href="/index.css">
</head>
<body>
  <div id="root">
    <div class="p-4">
      <h1>Knowledge Management</h1>
      <h2 class="text-2xl font-bold">Knowledge</h2>
      <div data-testid="file-input">
        <input type="file" />
      </div>
      <div data-testid="search-input">
        <input type="text" placeholder="Search..." />
      </div>
      <div data-testid="documents-list">
        <div>Document 1</div>
        <div>Document 2</div>
      </div>
      <div data-testid="type-filter">
        <select>
          <option>All</option>
          <option>PDF</option>
          <option>Text</option>
        </select>
      </div>
    </div>
  </div>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // Handle CSS
  if (req.url === '/index.css') {
    const cssPath = join(__dirname, '..', 'src', 'frontend', 'index.css');
    try {
      const css = readFileSync(cssPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(css);
    } catch (error) {
      res.writeHead(404);
      res.end('CSS not found');
    }
    return;
  }

  // Handle Tailwind CSS CDN request
  if (req.url === '/tailwindcss') {
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end('/* Tailwind CSS mock for testing */');
    return;
  }

  // Handle JavaScript files
  if (req.url.endsWith('.js')) {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('// Mock JavaScript for testing');
    return;
  }

  // Mock API endpoints
  if (req.url.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    
    if (req.url.includes('/documents')) {
      res.end(JSON.stringify({
        data: {
          memories: [
            {
              id: 'doc-1',
              content: { text: 'Test document' },
              metadata: {
                type: 'document',
                title: 'Test Document 1',
                filename: 'test1.md',
                fileExt: 'md'
              },
              createdAt: Date.now()
            }
          ]
        }
      }));
    } else if (req.url.includes('/knowledges')) {
      res.end(JSON.stringify({
        data: {
          chunks: []
        }
      }));
    } else {
      res.end(JSON.stringify({ success: true }));
    }
    return;
  }

  // Default response
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}`);
}); 