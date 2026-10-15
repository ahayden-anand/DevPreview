const assert = require('assert');
const path = require('path');
const { analyzeProject } = require('../analyzer/projectAnalyzer');
const { analyzeComponent, analyzeComponentSource } = require('../analyzer/componentAnalyzer');

suite('Analyzer Test Suite', () => {
    const fixtureDir = path.resolve(__dirname, 'fixtures/react-vite-app');

    test('projectAnalyzer detects standard React + Vite project', () => {
        const buttonPath = path.join(fixtureDir, 'src/components/Button.tsx');
        const info = analyzeProject(buttonPath);

        assert.strictEqual(info.usesReact, true);
        assert.strictEqual(info.usesVite, true);
        assert.strictEqual(info.nodeModulesExists, true);
        assert.strictEqual(info.isSupported, true);
        assert.strictEqual(info.supportError, null);
        assert.strictEqual(info.packageManager, 'npm');
        assert.strictEqual(info.componentRelativePath, path.join('src', 'components', 'Button.tsx'));
    });

    test('projectAnalyzer flags project without React', () => {
        const noReactDir = path.resolve(__dirname, 'fixtures/no-react-project');
        const utilPath = path.join(noReactDir, 'src/util.ts');
        const info = analyzeProject(utilPath);

        assert.strictEqual(info.usesReact, false);
        assert.strictEqual(info.isSupported, false);
        assert.ok(info.supportError.includes('requires React'));
    });

    test('projectAnalyzer flags missing node_modules', () => {
        const missingDepsDir = path.resolve(__dirname, 'fixtures/missing-deps');
        const info = analyzeProject(path.join(missingDepsDir, 'Button.tsx'));

        assert.strictEqual(info.nodeModulesExists, false);
        assert.strictEqual(info.isSupported, false);
        assert.ok(info.supportError.includes('node_modules'));
    });

    test('componentAnalyzer extracts default export component', () => {
        const buttonPath = path.join(fixtureDir, 'src/components/Button.tsx');
        const res = analyzeComponent(buttonPath);

        assert.strictEqual(res.hasComponents, true);
        assert.strictEqual(res.components.length, 1);
        assert.strictEqual(res.components[0].name, 'Button');
        assert.strictEqual(res.components[0].exportName, 'default');
        assert.strictEqual(res.components[0].isDefault, true);
    });

    test('componentAnalyzer extracts named export component', () => {
        const cardPath = path.join(fixtureDir, 'src/components/Card.tsx');
        const res = analyzeComponent(cardPath);

        assert.strictEqual(res.hasComponents, true);
        assert.strictEqual(res.components.length, 1);
        assert.strictEqual(res.components[0].name, 'Card');
        assert.strictEqual(res.components[0].exportName, 'Card');
        assert.strictEqual(res.components[0].isDefault, false);
    });

    test('componentAnalyzer extracts props with types and defaults', () => {
        const propsPath = path.join(fixtureDir, 'src/components/PropsButton.tsx');
        const res = analyzeComponent(propsPath);

        assert.strictEqual(res.hasComponents, true);
        const comp = res.components[0];
        assert.strictEqual(comp.name, 'PropsButton');

        const labelProp = comp.props.find((p) => p.name === 'label');
        assert.ok(labelProp, 'label prop should exist');
        assert.strictEqual(labelProp.type, 'string');
        assert.strictEqual(labelProp.required, true);

        const variantProp = comp.props.find((p) => p.name === 'variant');
        assert.ok(variantProp, 'variant prop should exist');
        assert.strictEqual(variantProp.type, 'union');
        assert.deepStrictEqual(variantProp.options, ['primary', 'secondary', 'danger']);
        assert.strictEqual(variantProp.defaultValue, 'primary');

        const countProp = comp.props.find((p) => p.name === 'count');
        assert.ok(countProp, 'count prop should exist');
        assert.strictEqual(countProp.type, 'number');
        assert.strictEqual(countProp.defaultValue, 0);

        const disabledProp = comp.props.find((p) => p.name === 'disabled');
        assert.ok(disabledProp, 'disabled prop should exist');
        assert.strictEqual(disabledProp.type, 'boolean');
    });

    test('componentAnalyzer detects non-component files', () => {
        const code = `
            export function calculateTotal(a: number, b: number): number {
                return a + b;
            }
            export const PI = 3.14159;
        `;
        const res = analyzeComponentSource(code);
        assert.strictEqual(res.hasComponents, false);
        assert.strictEqual(res.components.length, 0);
        assert.ok(res.error.includes('No React components'));
    });

    test('componentAnalyzer handles multiple component exports and aliases', () => {
        const code = `
            function InternalBadge() { return <span>Badge</span>; }
            export { InternalBadge as Badge };
            export default function Header() { return <header>Title</header>; }
            export const Footer = () => <footer>Bottom</footer>;
        `;
        const res = analyzeComponentSource(code);
        assert.strictEqual(res.hasComponents, true);
        assert.strictEqual(res.components.length, 3);

        const names = res.components.map((c) => c.name);
        assert.ok(names.includes('Header'));
        assert.ok(names.includes('Badge'));
        assert.ok(names.includes('Footer'));
    });
});
