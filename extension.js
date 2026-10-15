const vscode = require('vscode');
const path = require('path');
const { analyzeProject } = require('./analyzer/projectAnalyzer');
const { analyzeComponent } = require('./analyzer/componentAnalyzer');
const { PreviewServer } = require('./server/previewServer');
const { PreviewPanel } = require('./webview/previewPanel');

const activeSessions = new Map();
let outputChannel = null;

function getOutputChannel() {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('DevPreview');
    }
    return outputChannel;
}

function formatProjectInfo(projectInfo) {
    const framework = projectInfo.usesReact ? 'React' : 'Not detected';
    const bundler = projectInfo.usesVite ? 'Vite' : 'Not detected';
    const nodeModules = projectInfo.nodeModulesExists ? 'Found' : 'Not found';

    return [
        'DevPreview Project Detected',
        '',
        `Project: ${projectInfo.projectRoot}`,
        `Component: ${projectInfo.componentRelativePath}`,
        `Framework: ${framework}`,
        `React: ${projectInfo.reactVersion || 'Not found'}`,
        `React DOM: ${projectInfo.reactDomVersion || 'Not found'}`,
        `Bundler: ${bundler}`,
        `Vite: ${projectInfo.viteVersion || 'Not found'}`,
        `Node modules: ${nodeModules}`,
        `Package manager: ${projectInfo.packageManager}`
    ].join('\n');
}

async function previewComponentCommand(uri) {
    const channel = getOutputChannel();

    let targetUri = uri;
    if (!targetUri && vscode.window.activeTextEditor) {
        targetUri = vscode.window.activeTextEditor.document.uri;
    }

    if (!targetUri || !targetUri.fsPath) {
        vscode.window.showErrorMessage(
            'DevPreview: No component file selected. Please open or right-click a .tsx or .jsx file.'
        );
        return;
    }

    const filePath = targetUri.fsPath;
    const ext = path.extname(filePath).toLowerCase();
    if (!['.tsx', '.jsx', '.ts', '.js'].includes(ext)) {
        vscode.window.showErrorMessage(
            `DevPreview: '${path.basename(filePath)}' is not a supported file type. Please select a .tsx or .jsx file.`
        );
        return;
    }

    channel.appendLine(`\n[${new Date().toLocaleTimeString()}] Preview requested for: ${filePath}`);

    // 1. Analyze Project
    let projectInfo;
    try {
        projectInfo = analyzeProject(filePath);
        channel.appendLine(formatProjectInfo(projectInfo));
    } catch (error) {
        const msg = `DevPreview could not detect the project: ${error.message}`;
        channel.appendLine(`[Error] ${msg}`);
        vscode.window.showErrorMessage(msg);
        return;
    }

    if (!projectInfo.isSupported) {
        channel.appendLine(`[Error] Project unsupported: ${projectInfo.supportError}`);
        vscode.window.showErrorMessage(projectInfo.supportError);
        return;
    }

    // 2. Analyze Component
    let componentAnalysis;
    try {
        componentAnalysis = analyzeComponent(filePath);
    } catch (error) {
        const msg = `DevPreview failed to analyze component: ${error.message}`;
        channel.appendLine(`[Error] ${msg}`);
        vscode.window.showErrorMessage(msg);
        return;
    }

    if (!componentAnalysis.hasComponents || componentAnalysis.components.length === 0) {
        const errorMsg = componentAnalysis.error || `No React components found in '${path.basename(filePath)}'.`;
        channel.appendLine(`[Error] ${errorMsg}`);
        vscode.window.showErrorMessage(`DevPreview: ${errorMsg}`);
        return;
    }

    // 3. Component Selection (if multiple)
    let selectedComponent = componentAnalysis.components[0];
    if (componentAnalysis.components.length > 1) {
        const pickItems = componentAnalysis.components.map((comp) => ({
            label: comp.name,
            description: comp.isDefault ? 'Default export' : `Named export (${comp.exportName})`,
            detail: comp.props.length > 0 ? `Props: ${comp.props.map((p) => p.name).join(', ')}` : 'No props',
            component: comp
        }));

        const picked = await vscode.window.showQuickPick(pickItems, {
            placeHolder: `Multiple components found in ${path.basename(filePath)}. Choose one to preview:`
        });

        if (!picked) {
            channel.appendLine('Component preview selection cancelled by user.');
            return;
        }
        selectedComponent = picked.component;
    }

    const sessionKey = `${filePath}::${selectedComponent.name}`;

    // 4. Check if session already exists
    if (activeSessions.has(sessionKey)) {
        channel.appendLine(`Revealing existing preview session for: ${sessionKey}`);
        const existingPanel = activeSessions.get(sessionKey);
        existingPanel.reveal();
        return;
    }

    // 5. Start Server and Webview Panel with progress indicator
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `DevPreview: Starting preview for ${selectedComponent.name}...`,
            cancellable: false
        },
        async () => {
            let previewServer = null;
            try {
                previewServer = new PreviewServer(projectInfo, selectedComponent, {
                    logger: (msg) => channel.appendLine(msg),
                    onExit: (code) => {
                        channel.appendLine(`[DevPreview] Preview server exited with code ${code}.`);
                    }
                });

                await previewServer.start();
                channel.appendLine(`[DevPreview] Server ready at: ${previewServer.serverUrl}`);

                const previewPanel = await PreviewPanel.create(
                    projectInfo,
                    selectedComponent,
                    previewServer,
                    channel
                );

                activeSessions.set(sessionKey, previewPanel);

                // When panel is closed, clean up session
                previewPanel.panel.onDidDispose(() => {
                    channel.appendLine(`[DevPreview] Closed session for: ${sessionKey}`);
                    activeSessions.delete(sessionKey);
                });

            } catch (err) {
                channel.appendLine(`[DevPreview Server Failure] ${err.message}`);
                vscode.window.showErrorMessage(
                    `DevPreview failed to start preview server: ${err.message}`
                );
                if (previewServer) {
                    previewServer.dispose();
                }
            }
        }
    );
}

function activate(context) {
    const channel = getOutputChannel();
    channel.appendLine('DevPreview extension activated.');

    const previewCommand = vscode.commands.registerCommand(
        'devpreview.previewComponent',
        previewComponentCommand
    );

    context.subscriptions.push(previewCommand);
    context.subscriptions.push(channel);
}

function deactivate() {
    if (outputChannel) {
        outputChannel.appendLine('DevPreview deactivating. Cleaning up all active sessions...');
    }
    for (const panel of activeSessions.values()) {
        try {
            panel.dispose();
        } catch {
            // ignore
        }
    }
    activeSessions.clear();
}

module.exports = {
    activate,
    deactivate,
    previewComponentCommand,
    formatProjectInfo,
    activeSessions
};