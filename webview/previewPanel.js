const vscode = require('vscode');

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

class PreviewPanel {
    constructor(panel, projectInfo, componentInfo, previewServer, outputChannel) {
        this.panel = panel;
        this.projectInfo = projectInfo;
        this.componentInfo = componentInfo;
        this.previewServer = previewServer;
        this.outputChannel = outputChannel;
        this.disposables = [];
        this.currentProps = {};

        // Initialize current props with defaults
        if (Array.isArray(componentInfo.props)) {
            for (const prop of componentInfo.props) {
                if (prop.defaultValue !== undefined) {
                    this.currentProps[prop.name] = prop.defaultValue;
                } else if (prop.type === 'string') {
                    this.currentProps[prop.name] = prop.name;
                } else if (prop.type === 'number') {
                    this.currentProps[prop.name] = 0;
                } else if (prop.type === 'boolean') {
                    this.currentProps[prop.name] = false;
                } else if (prop.type === 'union' && Array.isArray(prop.options) && prop.options.length > 0) {
                    this.currentProps[prop.name] = prop.options[0];
                }
            }
        }

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage((message) => {
            switch (message.type) {
                case 'REFRESH_PREVIEW':
                    this.refresh();
                    break;
                case 'PROP_CHANGE':
                    this.handlePropChange(message.name, message.value);
                    break;
                case 'LOG_ERROR':
                    this.outputChannel.appendLine(`[DevPreview Webview Error] ${message.error}`);
                    break;
            }
        }, null, this.disposables);
    }

    static async create(projectInfo, componentInfo, previewServer, outputChannel) {
        const title = `DevPreview: ${componentInfo.name}`;
        const panel = vscode.window.createWebviewPanel(
            'devpreview.panel',
            title,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const instance = new PreviewPanel(panel, projectInfo, componentInfo, previewServer, outputChannel);
        await instance.render();
        return instance;
    }

    handlePropChange(name, value) {
        this.currentProps[name] = value;
        this.outputChannel.appendLine(`[DevPreview] Prop updated: ${name} = ${JSON.stringify(value)}`);
        this.panel.webview.postMessage({
            type: 'UPDATE_IFRAME_PROPS',
            props: this.currentProps
        });
    }

    refresh() {
        this.outputChannel.appendLine(`[DevPreview] Manually refreshing preview iframe...`);
        this.panel.webview.postMessage({
            type: 'RELOAD_IFRAME'
        });
    }

    showError(errorMessage) {
        this.outputChannel.appendLine(`[DevPreview Error] ${errorMessage}`);
        this.panel.webview.postMessage({
            type: 'SERVER_ERROR',
            error: errorMessage
        });
    }

    async render() {
        const webview = this.panel.webview;
        const nonce = getNonce();

        let externalUriString = '';
        if (this.previewServer.serverUrl) {
            try {
                const parsed = vscode.Uri.parse(this.previewServer.serverUrl);
                const externalUri = await vscode.env.asExternalUri(parsed);
                externalUriString = externalUri.toString();
            } catch (err) {
                this.outputChannel.appendLine(`[DevPreview] asExternalUri error: ${err.message}`);
                externalUriString = this.previewServer.serverUrl;
            }
        }

        const componentName = this.componentInfo.name;
        const relativePath = this.projectInfo.componentRelativePath;
        const props = this.componentInfo.props || [];

        webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${externalUriString} http://127.0.0.1:* http://localhost:*; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevPreview: ${componentName}</title>
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background, #1e1e24);
      --bg-secondary: var(--vscode-sideBar-background, #18181b);
      --text-primary: var(--vscode-editor-foreground, #f4f4f5);
      --text-muted: var(--vscode-descriptionForeground, #a1a1aa);
      --border-color: var(--vscode-panel-border, #27272a);
      --accent-color: var(--vscode-button-background, #6366f1);
      --accent-hover: var(--vscode-button-hoverBackground, #4f46e5);
      --badge-success: #10b981;
      --badge-error: #ef4444;
      --badge-compiling: #f59e0b;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg-primary);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      background-color: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 10px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      user-select: none;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
      overflow: hidden;
    }
    .component-title {
      font-weight: 600;
      font-size: 14px;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 999px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .badge-live {
      background: rgba(16, 185, 129, 0.15);
      color: var(--badge-success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-live::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--badge-success);
      animation: pulse 2s infinite;
    }
    .badge-error {
      background: rgba(239, 68, 68, 0.15);
      color: var(--badge-error);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.4; }
      100% { opacity: 1; }
    }
    .file-path {
      font-size: 12px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    button.btn {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }
    button.btn:hover {
      background-color: var(--accent-hover);
      border-color: var(--accent-hover);
      color: #fff;
    }
    button.btn.active {
      background-color: var(--accent-color);
      border-color: var(--accent-color);
      color: #fff;
    }
    .props-panel {
      background-color: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 12px 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      font-size: 12px;
      max-height: 140px;
      overflow-y: auto;
    }
    .prop-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 140px;
    }
    .prop-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .prop-input {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
      outline: none;
    }
    .prop-input:focus {
      border-color: var(--accent-color);
    }
    .prop-checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      margin-top: 4px;
    }
    .content-area {
      flex: 1;
      position: relative;
      background: var(--bg-primary);
    }
    iframe#preview-frame {
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
    }
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: var(--bg-primary);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      z-index: 10;
      transition: opacity 0.2s ease;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: var(--accent-color);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .error-container {
      display: none;
      position: absolute;
      inset: 0;
      background: var(--bg-primary);
      padding: 24px;
      overflow-y: auto;
      z-index: 20;
    }
    .error-card {
      border: 1px solid #ef4444;
      background: rgba(239, 68, 68, 0.08);
      border-radius: 8px;
      padding: 16px 20px;
      max-width: 800px;
      margin: 0 auto;
    }
    .error-card h3 {
      color: #ef4444;
      font-size: 16px;
      margin-bottom: 8px;
    }
    .error-card p {
      color: #fca5a5;
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 12px;
      word-break: break-word;
    }
    .error-card pre {
      background: #09090b;
      padding: 12px;
      border-radius: 6px;
      font-size: 11px;
      color: #d4d4d8;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <div class="component-title">
        ${componentName}
        <span id="status-badge" class="badge badge-live">Live</span>
      </div>
      <div class="file-path" title="${relativePath}">${relativePath}</div>
    </div>
    <div class="toolbar">
      ${props.length > 0 ? '<button id="btn-toggle-props" class="btn active">Props</button>' : ''}
      <button id="btn-refresh" class="btn" title="Refresh Preview">↻ Refresh</button>
    </div>
  </header>

  ${props.length > 0 ? `
  <div id="props-panel" class="props-panel">
    ${props.map((p) => {
        const curVal = this.currentProps[p.name];
        if (p.type === 'boolean') {
            return `
            <div class="prop-item">
              <span class="prop-label">${p.name} ${p.required ? '*' : ''}</span>
              <label class="prop-checkbox-label">
                <input type="checkbox" id="prop-${p.name}" class="prop-checkbox" ${curVal ? 'checked' : ''} />
                <span>${curVal ? 'true' : 'false'}</span>
              </label>
            </div>`;
        } else if (p.type === 'union' && Array.isArray(p.options)) {
            return `
            <div class="prop-item">
              <span class="prop-label">${p.name} ${p.required ? '*' : ''}</span>
              <select id="prop-${p.name}" class="prop-input">
                ${p.options.map((opt) => `<option value="${opt}" ${opt === curVal ? 'selected' : ''}>${opt}</option>`).join('')}
              </select>
            </div>`;
        } else if (p.type === 'number') {
            return `
            <div class="prop-item">
              <span class="prop-label">${p.name} ${p.required ? '*' : ''}</span>
              <input type="number" id="prop-${p.name}" class="prop-input" value="${curVal !== undefined ? curVal : 0}" />
            </div>`;
        } else if (p.type === 'string') {
            return `
            <div class="prop-item">
              <span class="prop-label">${p.name} ${p.required ? '*' : ''}</span>
              <input type="text" id="prop-${p.name}" class="prop-input" value="${curVal || ''}" />
            </div>`;
        } else {
            return `
            <div class="prop-item">
              <span class="prop-label">${p.name} (complex)</span>
              <span style="font-size: 11px; color: var(--text-muted); font-style: italic;">Auto-mocked</span>
            </div>`;
        }
    }).join('')}
  </div>` : ''}

  <div class="content-area">
    <div id="loading" class="loading-overlay">
      <div class="spinner"></div>
      <div style="font-size: 13px; color: var(--text-muted);">Starting preview server...</div>
    </div>

    <div id="error-screen" class="error-container">
      <div class="error-card">
        <h3 id="error-title">Preview Error</h3>
        <p id="error-message"></p>
        <pre id="error-stack" style="display: none;"></pre>
        <button id="error-retry-btn" class="btn" style="margin-top: 12px;">Retry</button>
      </div>
    </div>

    <iframe
      id="preview-frame"
      src="${externalUriString}"
      sandbox="allow-scripts allow-same-origin allow-forms"
    ></iframe>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const iframe = document.getElementById('preview-frame');
    const loading = document.getElementById('loading');
    const errorScreen = document.getElementById('error-screen');
    const errorTitle = document.getElementById('error-title');
    const errorMessage = document.getElementById('error-message');
    const errorStack = document.getElementById('error-stack');
    const statusBadge = document.getElementById('status-badge');
    const btnRefresh = document.getElementById('btn-refresh');
    const btnToggleProps = document.getElementById('btn-toggle-props');
    const propsPanel = document.getElementById('props-panel');
    const errorRetryBtn = document.getElementById('error-retry-btn');

    let isLoaded = false;

    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        if (iframe) {
          loading.style.display = 'flex';
          iframe.src = iframe.src;
        }
      });
    }

    if (errorRetryBtn) {
      errorRetryBtn.addEventListener('click', () => {
        errorScreen.style.display = 'none';
        loading.style.display = 'flex';
        if (iframe) iframe.src = iframe.src;
      });
    }

    if (btnToggleProps && propsPanel) {
      btnToggleProps.addEventListener('click', () => {
        const isHidden = propsPanel.style.display === 'none';
        propsPanel.style.display = isHidden ? 'flex' : 'none';
        btnToggleProps.classList.toggle('active', isHidden);
      });
    }

    // Set up prop input change handlers
    document.querySelectorAll('.prop-input').forEach(input => {
      const propName = input.id.replace('prop-', '');
      input.addEventListener('input', (e) => {
        let val = e.target.value;
        if (input.type === 'number') val = Number(val);
        vscode.postMessage({ type: 'PROP_CHANGE', name: propName, value: val });
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            type: 'DEVPREVIEW_SET_PROPS',
            props: collectProps()
          }, '*');
        }
      });
    });

    document.querySelectorAll('.prop-checkbox').forEach(chk => {
      const propName = chk.id.replace('prop-', '');
      chk.addEventListener('change', (e) => {
        const checked = e.target.checked;
        chk.nextElementSibling.textContent = String(checked);
        vscode.postMessage({ type: 'PROP_CHANGE', name: propName, value: checked });
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            type: 'DEVPREVIEW_SET_PROPS',
            props: collectProps()
          }, '*');
        }
      });
    });

    function collectProps() {
      const props = {};
      document.querySelectorAll('.prop-input').forEach(input => {
        const name = input.id.replace('prop-', '');
        props[name] = input.type === 'number' ? Number(input.value) : input.value;
      });
      document.querySelectorAll('.prop-checkbox').forEach(chk => {
        const name = chk.id.replace('prop-', '');
        props[name] = chk.checked;
      });
      return props;
    }

    // Listen for messages from extension host
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message) return;

      if (message.type === 'UPDATE_IFRAME_PROPS') {
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            type: 'DEVPREVIEW_SET_PROPS',
            props: message.props
          }, '*');
        }
      } else if (message.type === 'RELOAD_IFRAME') {
        if (iframe) {
          loading.style.display = 'flex';
          iframe.src = iframe.src;
        }
      } else if (message.type === 'SERVER_ERROR') {
        loading.style.display = 'none';
        errorScreen.style.display = 'block';
        errorTitle.textContent = 'Preview Server Error';
        errorMessage.textContent = message.error;
        statusBadge.textContent = 'Error';
        statusBadge.className = 'badge badge-error';
      }
    });

    // Listen for messages from inside the iframe (Render success / error)
    window.addEventListener('message', (event) => {
      if (!event.data) return;

      if (event.data.type === 'DEVPREVIEW_RENDER_SUCCESS') {
        loading.style.display = 'none';
        errorScreen.style.display = 'none';
        statusBadge.textContent = 'Live';
        statusBadge.className = 'badge badge-live';
      } else if (event.data.type === 'DEVPREVIEW_RENDER_ERROR') {
        loading.style.display = 'none';
        statusBadge.textContent = 'Render Error';
        statusBadge.className = 'badge badge-error';
      }
    });

    // Iframe load fallback
    if (iframe) {
      iframe.addEventListener('load', () => {
        setTimeout(() => {
          loading.style.display = 'none';
        }, 500);
      });
    }
  </script>
</body>
</html>`;
    }

    reveal() {
        this.panel.reveal();
    }

    dispose() {
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) d.dispose();
        }
        if (this.previewServer) {
            this.previewServer.dispose();
        }
    }
}

module.exports = {
    PreviewPanel
};
