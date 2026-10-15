const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { analyzeProject } = require('../analyzer/projectAnalyzer');
const { analyzeComponent } = require('../analyzer/componentAnalyzer');
const { PreviewServer } = require('../server/previewServer');

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        }).on('error', reject);
    });
}

suite('PreviewServer Lifecycle and Rendering Tests', function () {
    this.timeout(45000);

    const fixtureDir = path.resolve(__dirname, 'fixtures/react-vite-app');

    test('preview server renders Button.tsx (default export) and cleans up', async () => {
        const buttonPath = path.join(fixtureDir, 'src/components/Button.tsx');
        const projectInfo = analyzeProject(buttonPath);
        const compAnalysis = analyzeComponent(buttonPath);
        const server = new PreviewServer(projectInfo, compAnalysis.components[0]);

        try {
            const url = await server.start();
            assert.ok(url.startsWith('http://127.0.0.1:'), `Expected loopback URL, got ${url}`);
            assert.ok(fs.existsSync(server.tempDir), 'Temp directory must exist');

            // 1. Fetch index.html
            const indexRes = await fetchUrl(url + '/');
            assert.strictEqual(indexRes.statusCode, 200);
            assert.ok(indexRes.body.includes('<div id="root"></div>'));
            assert.ok(indexRes.body.includes('/entry.tsx'));

            // 2. Fetch transformed entry.tsx
            const entryRes = await fetchUrl(url + '/entry.tsx');
            assert.strictEqual(entryRes.statusCode, 200);
            assert.ok(entryRes.body.includes('Button'), 'Transformed entry should reference component');

        } finally {
            const tempDir = server.tempDir;
            server.dispose();
            // Wait slightly for process and file cleanup
            await new Promise((r) => setTimeout(r, 600));
            assert.strictEqual(fs.existsSync(tempDir), false, 'Temp directory must be cleaned up on disposal');
        }
    });

    test('preview server renders Card.tsx (named export)', async () => {
        const cardPath = path.join(fixtureDir, 'src/components/Card.tsx');
        const projectInfo = analyzeProject(cardPath);
        const compAnalysis = analyzeComponent(cardPath);
        const server = new PreviewServer(projectInfo, compAnalysis.components[0]);

        try {
            const url = await server.start();
            const entryRes = await fetchUrl(url + '/entry.tsx');
            assert.strictEqual(entryRes.statusCode, 200);
            assert.ok(entryRes.body.includes('Card'), 'Entry should reference Card component');
        } finally {
            server.dispose();
        }
    });

    test('preview server handles StyledButton.tsx with CSS import', async () => {
        const styledBtnPath = path.join(fixtureDir, 'src/components/StyledButton.tsx');
        const projectInfo = analyzeProject(styledBtnPath);
        const compAnalysis = analyzeComponent(styledBtnPath);
        const server = new PreviewServer(projectInfo, compAnalysis.components[0]);

        try {
            const url = await server.start();
            const entryRes = await fetchUrl(url + '/entry.tsx');
            assert.strictEqual(entryRes.statusCode, 200);
            assert.ok(entryRes.body.includes('StyledButton'));
        } finally {
            server.dispose();
        }
    });

    test('preview server handles WithRelativeImport.tsx', async () => {
        const relImportPath = path.join(fixtureDir, 'src/components/WithRelativeImport.tsx');
        const projectInfo = analyzeProject(relImportPath);
        const compAnalysis = analyzeComponent(relImportPath);
        const server = new PreviewServer(projectInfo, compAnalysis.components[0]);

        try {
            const url = await server.start();
            const entryRes = await fetchUrl(url + '/entry.tsx');
            assert.strictEqual(entryRes.statusCode, 200);
            assert.ok(entryRes.body.includes('WithRelativeImport'));
        } finally {
            server.dispose();
        }
    });

    test('two concurrent preview sessions run on isolated ports and directories', async () => {
        const btnPath = path.join(fixtureDir, 'src/components/Button.tsx');
        const cardPath = path.join(fixtureDir, 'src/components/Card.tsx');

        const pInfo1 = analyzeProject(btnPath);
        const cInfo1 = analyzeComponent(btnPath).components[0];
        const server1 = new PreviewServer(pInfo1, cInfo1);

        const pInfo2 = analyzeProject(cardPath);
        const cInfo2 = analyzeComponent(cardPath).components[0];
        const server2 = new PreviewServer(pInfo2, cInfo2);

        try {
            const url1 = await server1.start();
            const url2 = await server2.start();

            assert.notStrictEqual(url1, url2, 'Servers must run on different ports');
            assert.notStrictEqual(server1.tempDir, server2.tempDir, 'Temp dirs must be distinct');

            const res1 = await fetchUrl(url1 + '/');
            const res2 = await fetchUrl(url2 + '/');

            assert.strictEqual(res1.statusCode, 200);
            assert.strictEqual(res2.statusCode, 200);
        } finally {
            server1.dispose();
            server2.dispose();
        }
    });

    test('confirms user App.tsx, main.tsx, and package.json remain untouched', () => {
        const appPath = path.join(fixtureDir, 'src/App.tsx');
        const mainPath = path.join(fixtureDir, 'src/main.tsx');
        const pkgPath = path.join(fixtureDir, 'package.json');

        const appContent = fs.readFileSync(appPath, 'utf8');
        const mainContent = fs.readFileSync(mainPath, 'utf8');
        const pkgContent = fs.readFileSync(pkgPath, 'utf8');

        assert.ok(appContent.includes('Original App Root'), 'App.tsx must not be modified');
        assert.ok(mainContent.includes("ReactDOM.createRoot"), 'main.tsx must not be modified');
        assert.ok(pkgContent.includes('"name": "react-vite-app"'), 'package.json must not be modified');
    });
});
