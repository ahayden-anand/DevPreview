const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

function getAvailablePort(preferredPort = 5173) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();

        server.on('error', () => {
            // Port in use, get free random port
            const fallbackServer = net.createServer();
            fallbackServer.unref();
            fallbackServer.on('error', reject);
            fallbackServer.listen(0, '127.0.0.1', () => {
                const port = fallbackServer.address().port;
                fallbackServer.close(() => resolve(port));
            });
        });

        server.listen(preferredPort, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

function generateInitialProps(componentProps) {
    const props = {};
    if (!Array.isArray(componentProps)) return props;

    for (const prop of componentProps) {
        if (prop.defaultValue !== undefined) {
            props[prop.name] = prop.defaultValue;
        } else if (prop.type === 'string') {
            props[prop.name] = prop.name;
        } else if (prop.type === 'number') {
            props[prop.name] = 0;
        } else if (prop.type === 'boolean') {
            props[prop.name] = false;
        } else if (prop.type === 'union' && Array.isArray(prop.options) && prop.options.length > 0) {
            props[prop.name] = prop.options[0];
        }
    }
    return props;
}

class PreviewServer {
    constructor(projectInfo, componentInfo, options = {}) {
        this.projectInfo = projectInfo;
        this.componentInfo = componentInfo;
        this.options = options;
        this.sessionId = `devpreview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        this.tempDir = null;
        this.port = null;
        this.serverUrl = null;
        this.childProcess = null;
        this.isDisposed = false;
        this.logger = options.logger || console.log;
    }

    log(message) {
        this.logger(`[PreviewServer ${this.sessionId}] ${message}`);
    }

    async start() {
        if (this.isDisposed) {
            throw new Error('PreviewServer has already been disposed.');
        }

        this.port = await getAvailablePort(this.options.preferredPort || 5173);
        this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpreview-session-'));
        this.log(`Created temp directory: ${this.tempDir}`);
        this.log(`Allocated loopback port: ${this.port}`);

        const projectRoot = this.projectInfo.projectRoot;
        const componentPath = this.projectInfo.componentPath;
        const initialProps = generateInitialProps(this.componentInfo.props);

        const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DevPreview - ${this.componentInfo.name}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background-color: transparent;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      #root {
        min-height: 100%;
        display: flex;
        flex-direction: column;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/entry.tsx"></script>
  </body>
</html>`;

        const exportName = this.componentInfo.exportName || 'default';

        const entryTsx = `import React, { useState, useEffect, Component } from 'react';
import { createRoot } from 'react-dom/client';
import * as ComponentModule from '@devpreview/target-component';

const exportName = ${JSON.stringify(exportName)};
let TargetComponent = exportName === 'default'
  ? (ComponentModule.default || Object.values(ComponentModule)[0])
  : (ComponentModule[exportName] || ComponentModule.default || Object.values(ComponentModule)[0]);

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[DevPreview Component Error]', error, info);
    try {
      window.parent.postMessage({
        type: 'DEVPREVIEW_RENDER_ERROR',
        error: error.message || String(error),
        stack: error.stack || ''
      }, '*');
    } catch (e) {
      // ignore
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '24px',
          margin: '20px',
          borderRadius: '8px',
          backgroundColor: '#1e1e24',
          border: '1px solid #ef4444',
          color: '#f87171',
          fontFamily: 'monospace'
        }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#fca5a5' }}>
            React Render Error
          </h3>
          <div style={{ marginBottom: '12px', fontSize: '14px', wordBreak: 'break-word' }}>
            {this.state.error?.message}
          </div>
          <pre style={{
            margin: 0,
            padding: '12px',
            backgroundColor: '#121214',
            borderRadius: '4px',
            overflow: 'auto',
            maxHeight: '250px',
            fontSize: '12px',
            color: '#d4d4d8'
          }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function PreviewWrapper() {
  const [props, setProps] = useState(${JSON.stringify(initialProps)});

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data && event.data.type === 'DEVPREVIEW_SET_PROPS') {
        setProps(event.data.props || {});
      }
    };
    window.addEventListener('message', handleMessage);

    try {
      window.parent.postMessage({ type: 'DEVPREVIEW_RENDER_SUCCESS' }, '*');
    } catch (e) {
      // ignore
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (!TargetComponent) {
    return (
      <div style={{ padding: '24px', color: '#f87171', fontFamily: 'monospace' }}>
        Export '{exportName}' was not found in component module.
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div id="devpreview-root-wrapper" style={{ padding: '24px', boxSizing: 'border-box' }}>
        <TargetComponent {...props} />
      </div>
    </ErrorBoundary>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<PreviewWrapper />);
}
`;

        const runnerScript = `
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';

const projectRoot = ${JSON.stringify(projectRoot)};
const tempDir = ${JSON.stringify(this.tempDir)};
const componentPath = ${JSON.stringify(componentPath)};
const port = ${this.port};
const configFile = ${JSON.stringify(this.projectInfo.viteConfigPath || null)};

const require = createRequire(path.join(projectRoot, 'package.json'));

let viteEntry;
try {
  viteEntry = path.join(projectRoot, 'node_modules/vite/dist/node/index.js');
} catch (e) {
  viteEntry = require.resolve('vite');
}

const viteModule = await import(pathToFileURL(viteEntry).href);
const createServer = viteModule.createServer || (viteModule.default && viteModule.default.createServer);

async function run() {
  const serverConfig = {
    configFile: configFile || false,
    root: tempDir,
    server: {
      port: port,
      strictPort: true,
      host: '127.0.0.1',
      fs: {
        allow: [tempDir, projectRoot]
      }
    },
    resolve: {
      alias: {
        '@devpreview/target-component': componentPath,
        'react': path.resolve(projectRoot, 'node_modules/react'),
        'react-dom': path.resolve(projectRoot, 'node_modules/react-dom')
      }
    }
  };

  const server = await createServer(serverConfig);

  server.watcher.on('change', (file) => {
    console.log('[DEVPREVIEW_CHANGE]', file);
  });

  await server.listen();
  console.log('DEVPREVIEW_SERVER_READY:http://127.0.0.1:' + server.config.server.port);
}

run().catch((err) => {
  console.error('DEVPREVIEW_SERVER_ERROR:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
`;

        fs.writeFileSync(path.join(this.tempDir, 'index.html'), indexHtml);
        fs.writeFileSync(path.join(this.tempDir, 'entry.tsx'), entryTsx);
        const runnerPath = path.join(this.tempDir, 'runner.mjs');
        fs.writeFileSync(runnerPath, runnerScript);

        this.log(`Spawning Vite runner process...`);

        return new Promise((resolve, reject) => {
            let isResolved = false;

            const child = spawn(process.execPath, [runnerPath], {
                cwd: projectRoot,
                env: { ...process.env, NODE_ENV: 'development' },
                stdio: ['ignore', 'pipe', 'pipe']
            });

            this.childProcess = child;

            const timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    reject(new Error(`Timed out waiting for DevPreview server on port ${this.port}.`));
                }
            }, 15000);

            child.stdout.on('data', (chunk) => {
                const text = chunk.toString();
                this.log(`[stdout] ${text.trim()}`);

                if (text.includes('DEVPREVIEW_SERVER_READY:')) {
                    const match = text.match(/DEVPREVIEW_SERVER_READY:(http:\/\/[^\s]+)/);
                    if (match && !isResolved) {
                        isResolved = true;
                        clearTimeout(timeout);
                        this.serverUrl = match[1];
                        resolve(this.serverUrl);
                    }
                }
            });

            child.stderr.on('data', (chunk) => {
                const text = chunk.toString();
                this.log(`[stderr] ${text.trim()}`);
                if (text.includes('DEVPREVIEW_SERVER_ERROR:') && !isResolved) {
                    isResolved = true;
                    clearTimeout(timeout);
                    reject(new Error(text.trim()));
                }
            });

            child.on('error', (err) => {
                this.log(`Process error: ${err.message}`);
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timeout);
                    reject(err);
                }
            });

            child.on('exit', (code, signal) => {
                this.log(`Process exited with code ${code}, signal ${signal}`);
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timeout);
                    reject(new Error(`Preview server exited prematurely with code ${code}.`));
                }
                if (!this.isDisposed && this.options.onExit) {
                    this.options.onExit(code, signal);
                }
            });
        });
    }

    dispose() {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.log('Disposing preview server and cleaning up resources...');

        if (this.childProcess && !this.childProcess.killed) {
            try {
                if (process.platform === 'win32') {
                    try {
                        spawnSync('taskkill', ['/pid', String(this.childProcess.pid), '/f', '/t'], {
                            stdio: 'ignore'
                        });
                    } catch {
                        this.childProcess.kill('SIGKILL');
                    }
                } else {
                    this.childProcess.kill('SIGTERM');
                }
            } catch (err) {
                this.log(`Error terminating child process: ${err.message}`);
            }
        }

        if (this.tempDir && fs.existsSync(this.tempDir)) {
            try {
                fs.rmSync(this.tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
                this.log(`Cleaned up temp directory: ${this.tempDir}`);
            } catch (err) {
                this.log(`Error removing temp directory: ${err.message}`);
            }
        }
    }
}

module.exports = {
    PreviewServer,
    getAvailablePort,
    generateInitialProps
};
