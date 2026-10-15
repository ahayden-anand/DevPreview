const fs = require('fs');
const babelParser = require('@babel/parser');

function isPascalCase(str) {
    return typeof str === 'string' && /^[A-Z][A-Za-z0-9_]*$/.test(str);
}

function hasJsx(node) {
    let found = false;
    function traverse(n) {
        if (!n || found) return;
        if (n.type === 'JSXElement' || n.type === 'JSXFragment') {
            found = true;
            return;
        }
        for (const key of Object.keys(n)) {
            if (key === 'parent' || key === 'leadingComments' || key === 'trailingComments' || key === 'loc') {
                continue;
            }
            const child = n[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item === 'object' && item.type) {
                        traverse(item);
                    }
                }
            } else if (child && typeof child === 'object' && child.type) {
                traverse(child);
            }
        }
    }
    traverse(node);
    return found;
}

function extractPropsFromTypeAnnotation(typeAnnotation, typeAliases, interfaces) {
    const props = [];
    if (!typeAnnotation) return props;

    let targetMembers = [];
    if (typeAnnotation.type === 'TSTypeLiteral') {
        targetMembers = typeAnnotation.members;
    } else if (typeAnnotation.type === 'TSTypeReference') {
        const typeName = typeAnnotation.typeName && typeAnnotation.typeName.name;
        if (typeName && interfaces[typeName]) {
            targetMembers = interfaces[typeName].body.body;
        } else if (typeName && typeAliases[typeName] && typeAliases[typeName].typeAnnotation && typeAliases[typeName].typeAnnotation.type === 'TSTypeLiteral') {
            targetMembers = typeAliases[typeName].typeAnnotation.members;
        }
    }

    if (!Array.isArray(targetMembers)) return props;

    for (const member of targetMembers) {
        if (member.type === 'TSPropertySignature' && member.key && member.key.name) {
            const propName = member.key.name;
            const required = !member.optional;
            let propType = 'other';
            let options = undefined;

            const typeAnn = member.typeAnnotation && member.typeAnnotation.typeAnnotation;
            if (typeAnn) {
                if (typeAnn.type === 'TSStringKeyword') {
                    propType = 'string';
                } else if (typeAnn.type === 'TSNumberKeyword') {
                    propType = 'number';
                } else if (typeAnn.type === 'TSBooleanKeyword') {
                    propType = 'boolean';
                } else if (typeAnn.type === 'TSUnionType') {
                    const stringLiterals = typeAnn.types.filter(
                        (t) => t.type === 'TSLiteralType' && typeof t.literal?.value === 'string'
                    );
                    if (stringLiterals.length === typeAnn.types.length && stringLiterals.length > 0) {
                        propType = 'union';
                        options = stringLiterals.map((t) => t.literal.value);
                    } else if (typeAnn.types.some((t) => t.type === 'TSBooleanKeyword')) {
                        propType = 'boolean';
                    }
                }
            }

            props.push({
                name: propName,
                type: propType,
                required,
                options
            });
        }
    }
    return props;
}

function extractPropsFromParams(params, typeAliases, interfaces) {
    if (!params || params.length === 0) return [];
    const firstParam = params[0];
    let props = [];

    // Check if first param has type annotation
    if (firstParam.typeAnnotation && firstParam.typeAnnotation.typeAnnotation) {
        props = extractPropsFromTypeAnnotation(firstParam.typeAnnotation.typeAnnotation, typeAliases, interfaces);
    }

    // Check destructured object pattern
    let objPattern = null;
    if (firstParam.type === 'ObjectPattern') {
        objPattern = firstParam;
    } else if (firstParam.type === 'AssignmentPattern' && firstParam.left.type === 'ObjectPattern') {
        objPattern = firstParam.left;
    }

    if (objPattern && Array.isArray(objPattern.properties)) {
        for (const prop of objPattern.properties) {
            if (prop.type === 'ObjectProperty' && prop.key && prop.key.name) {
                const name = prop.key.name;
                let defaultValue = undefined;
                if (prop.value && prop.value.type === 'AssignmentPattern') {
                    const right = prop.value.right;
                    if (right.type === 'StringLiteral') defaultValue = right.value;
                    else if (right.type === 'NumericLiteral') defaultValue = right.value;
                    else if (right.type === 'BooleanLiteral') defaultValue = right.value;
                }

                const existing = props.find((p) => p.name === name);
                if (existing) {
                    if (defaultValue !== undefined) {
                        existing.defaultValue = defaultValue;
                        existing.required = false;
                    }
                } else {
                    let inferredType = 'other';
                    if (typeof defaultValue === 'string') inferredType = 'string';
                    else if (typeof defaultValue === 'number') inferredType = 'number';
                    else if (typeof defaultValue === 'boolean') inferredType = 'boolean';

                    props.push({
                        name,
                        type: inferredType,
                        required: defaultValue === undefined,
                        defaultValue
                    });
                }
            }
        }
    }

    return props;
}

function analyzeComponentSource(source, filePath = 'unknown') {
    let ast;
    try {
        ast = babelParser.parse(source, {
            sourceType: 'module',
            plugins: [
                'jsx',
                'typescript'
            ]
        });
    } catch (err) {
        return {
            filePath,
            hasComponents: false,
            components: [],
            error: `Failed to parse file: ${err.message}`
        };
    }

    const interfaces = {};
    const typeAliases = {};
    const topLevelDeclarations = new Map();
    const rawExports = [];

    // Pass 1: gather interfaces, types, declarations, exports
    for (const node of ast.program.body) {
        if (node.type === 'TSInterfaceDeclaration') {
            interfaces[node.id.name] = node;
        } else if (node.type === 'TSTypeAliasDeclaration') {
            typeAliases[node.id.name] = node;
        } else if (node.type === 'FunctionDeclaration') {
            if (node.id) topLevelDeclarations.set(node.id.name, node);
        } else if (node.type === 'VariableDeclaration') {
            for (const decl of node.declarations) {
                if (decl.id && decl.id.type === 'Identifier') {
                    topLevelDeclarations.set(decl.id.name, decl.init);
                }
            }
        } else if (node.type === 'ClassDeclaration') {
            if (node.id) topLevelDeclarations.set(node.id.name, node);
        } else if (node.type === 'ExportDefaultDeclaration') {
            let name = 'default';
            if (node.declaration) {
                if (node.declaration.id && node.declaration.id.name) {
                    name = node.declaration.id.name;
                } else if (node.declaration.type === 'Identifier') {
                    name = node.declaration.name;
                }
            }
            rawExports.push({
                exportName: 'default',
                isDefault: true,
                preferredName: name,
                declaration: node.declaration
            });
        } else if (node.type === 'ExportNamedDeclaration') {
            if (node.declaration) {
                if (node.declaration.type === 'TSInterfaceDeclaration') {
                    interfaces[node.declaration.id.name] = node.declaration;
                } else if (node.declaration.type === 'TSTypeAliasDeclaration') {
                    typeAliases[node.declaration.id.name] = node.declaration;
                } else if (node.declaration.type === 'FunctionDeclaration') {
                    rawExports.push({
                        exportName: node.declaration.id.name,
                        isDefault: false,
                        preferredName: node.declaration.id.name,
                        declaration: node.declaration
                    });
                } else if (node.declaration.type === 'VariableDeclaration') {
                    for (const decl of node.declaration.declarations) {
                        if (decl.id.type === 'Identifier') {
                            rawExports.push({
                                exportName: decl.id.name,
                                isDefault: false,
                                preferredName: decl.id.name,
                                declaration: decl.init
                            });
                        }
                    }
                } else if (node.declaration.type === 'ClassDeclaration') {
                    rawExports.push({
                        exportName: node.declaration.id.name,
                        isDefault: false,
                        preferredName: node.declaration.id.name,
                        declaration: node.declaration
                    });
                }
            }
            if (node.specifiers) {
                for (const spec of node.specifiers) {
                    if (spec.type === 'ExportSpecifier') {
                        const exportName = spec.exported.name;
                        const localName = spec.local.name;
                        rawExports.push({
                            exportName,
                            isDefault: exportName === 'default',
                            preferredName: exportName === 'default' ? localName : exportName,
                            localName
                        });
                    }
                }
            }
        }
    }

    // Pass 2: resolve component declarations
    const components = [];

    for (const exp of rawExports) {
        let declNode = exp.declaration;
        let componentName = exp.preferredName || exp.exportName;

        if (!declNode && exp.localName) {
            declNode = topLevelDeclarations.get(exp.localName);
        }

        if (!declNode) continue;

        if (declNode.type === 'Identifier' && topLevelDeclarations.has(declNode.name)) {
            if (componentName === 'default') {
                componentName = declNode.name;
            }
            declNode = topLevelDeclarations.get(declNode.name);
        }

        let isComponent = false;
        let params = [];

        if (
            declNode.type === 'FunctionDeclaration' ||
            declNode.type === 'FunctionExpression' ||
            declNode.type === 'ArrowFunctionExpression'
        ) {
            params = declNode.params || [];
            const returnsJsx = hasJsx(declNode.body);
            const nameIsPascal = isPascalCase(componentName) || (declNode.id && isPascalCase(declNode.id.name));

            // If it returns JSX or has PascalCase name, it is a component
            if (returnsJsx || nameIsPascal) {
                isComponent = true;
            }
        } else if (declNode.type === 'ClassDeclaration') {
            const isReactClass = declNode.superClass && (
                declNode.superClass.name === 'Component' ||
                declNode.superClass.name === 'PureComponent' ||
                (declNode.superClass.property && declNode.superClass.property.name === 'Component')
            );
            if (isReactClass || isPascalCase(componentName) || hasJsx(declNode.body)) {
                isComponent = true;
            }
        }

        if (isComponent) {
            const props = extractPropsFromParams(params, typeAliases, interfaces);
            components.push({
                name: componentName,
                exportName: exp.exportName,
                isDefault: exp.isDefault,
                props
            });
        }
    }

    return {
        filePath,
        hasComponents: components.length > 0,
        components,
        error: components.length === 0 ? 'No React components found in file.' : null
    };
}

function analyzeComponent(componentPath) {
    if (!fs.existsSync(componentPath)) {
        throw new Error(`Component file does not exist: ${componentPath}`);
    }
    const source = fs.readFileSync(componentPath, 'utf8');
    return analyzeComponentSource(source, componentPath);
}

module.exports = {
    analyzeComponent,
    analyzeComponentSource,
    isPascalCase,
    hasJsx
};
