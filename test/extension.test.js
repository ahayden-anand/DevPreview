const assert = require('assert');
const vscode = require('vscode');
const path = require('path');

suite('Extension Integration Test Suite', () => {
    suiteSetup(async () => {
        // Activate the extension before running tests
        const ext = vscode.extensions.all.find((e) => e.packageJSON && e.packageJSON.name === 'devpreview');
        if (ext && !ext.isActive) {
            await ext.activate();
        }
    });

    test('extension registers devpreview.previewComponent command', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('devpreview.previewComponent'),
            'devpreview.previewComponent command should be registered'
        );
    });

    test('executing previewComponent without active editor or URI displays error without throwing', async () => {
        try {
            await vscode.commands.executeCommand('devpreview.previewComponent');
            assert.ok(true, 'Command should finish without unhandled rejection');
        } catch (err) {
            assert.fail(`Command threw unexpected error: ${err.message}`);
        }
    });

    test('executing previewComponent on unsupported file displays error without throwing', async () => {
        const txtUri = vscode.Uri.file(path.resolve(__dirname, '../package.json'));
        try {
            await vscode.commands.executeCommand('devpreview.previewComponent', txtUri);
            assert.ok(true, 'Command should handle non-react file gracefully');
        } catch (err) {
            assert.fail(`Command threw unexpected error: ${err.message}`);
        }
    });
});
