#!/usr/bin/env node
/**
 * NODE SOURCE CODE COMPILER
 * 
 * This script compiles all XGENIA runtime node source files into a searchable
 * knowledge base that AI tools can query at runtime.
 * 
 * Benefits over pre-compiled registry:
 * - AI can see actual code, not summaries
 * - AI can understand node behavior and logic
 * - AI can search for patterns across all nodes
 * - Automatically updates with source changes
 * 
 * Usage: npm run build:node-docs
 * 
 * Output: Generated as JSON that AI tools can import and search
 */

const fs = require('fs');
const path = require('path');

// All source directories containing node definitions
// We scan multiple packages to ensure complete coverage
const PRIVATE_PRO_NODES_DIR = path.join(__dirname, '../../../private/xgenia-pro-nodes/src');

const NODE_SOURCE_DIRS = [
    // Core runtime nodes (maths, std-library)
    path.join(__dirname, '../../xgenia-runtime/src/nodes'),

    // Pro nodes (slot-games, maths, AI) — only included if the private directory exists
    ...(fs.existsSync(PRIVATE_PRO_NODES_DIR) && process.env.XGENIA_INCLUDE_PRIVATE !== '0'
        ? [PRIVATE_PRO_NODES_DIR]
        : []),

    // React viewer nodes (visual, navigation, hyve-mind)
    path.join(__dirname, '../../xgenia-viewer-react/src/nodes'),

    // Cloud viewer nodes
    path.join(__dirname, '../../xgenia-viewer-cloud/src/nodes'),
];

const OUTPUT_DIR = path.join(__dirname, '../src/editor/src/views/panels/ChatPanel/StreamlinedToolRegistry/compiled-node-docs');


/**
 * Find which source directory a file belongs to
 */
function findSourceDir(filePath) {
    for (const dir of NODE_SOURCE_DIRS) {
        if (filePath.startsWith(dir)) {
            return dir;
        }
    }
    // Fallback to first directory
    return NODE_SOURCE_DIRS[0];
}

/**
 * Extract relevant code sections from a node file
 */
function extractNodeDocumentation(filePath) {

    const source = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);

    // Extract node name
    const nameMatch = source.match(/name:\s*['"]([^'"]+)['"]/);
    if (!nameMatch) return null;

    const nodeName = nameMatch[1];

    // Extract the entire node definition object
    const nodeDefMatch = source.match(/const\s+\w+\s*=\s*(?:[\w\.]+\s*\(\s*)?{([^]*?)}\s*(?:\)|;)/s);
    const nodeDef = nodeDefMatch ? nodeDefMatch[1] : '';

    // Extract inputs and outputs sections first
    const inputsSection = extractSection(source, 'inputs');
    const outputsSection = extractSection(source, 'outputs');

    // Extract specific sections
    const sections = {
        name: nodeName,
        file: fileName,
        relativePath: path.relative(findSourceDir(filePath), filePath),

        // Extract inputs section (with full code)
        inputs: inputsSection,

        // Extract outputs section (with full code)
        outputs: outputsSection,

        // 🎯 NEW: Format hints extracted at compile time!
        // This tells AI what format each port expects without hardcoded education
        inputFormatHints: inputsSection ? parseFormatHints(inputsSection.code) : {},
        outputFormatHints: outputsSection ? parseFormatHints(outputsSection.code) : {},

        // Extract prototypeExtensions (contains behavior logic)
        prototypeExtensions: extractSection(source, 'prototypeExtensions'),

        // Extract any helper functions defined outside the node object
        helpers: extractHelperFunctions(source),

        // Full node definition for complete context
        fullDefinition: nodeDef,

        // Metadata
        category: extractValue(source, 'category'),
        docs: extractValue(source, 'docs'),
        color: extractValue(source, 'color'),

        // File stats
        lineCount: source.split('\n').length,
        byteSize: Buffer.byteLength(source, 'utf8')
    };

    return sections;
}


/**
 * Extract a specific section from source code
 */
function extractSection(source, sectionName) {
    // Match section with nested braces
    const regex = new RegExp(`${sectionName}:\\s*{`, 'g');
    const match = regex.exec(source);

    if (!match) return null;

    const startIndex = match.index + match[0].length - 1;
    const sectionCode = extractBalancedBraces(source, startIndex);

    return {
        code: sectionCode,
        startLine: source.substring(0, match.index).split('\n').length
    };
}

/**
 * Extract balanced braces content
 */
function extractBalancedBraces(source, startIndex) {
    let depth = 1;
    let i = startIndex + 1;

    while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        i++;
    }

    return source.substring(startIndex, i);
}

/**
 * Extract a simple value from source
 */
function extractValue(source, key) {
    const match = source.match(new RegExp(`${key}:\\s*['"]([^'"]+)['"]`));
    return match ? match[1] : null;
}

/**
 * Extract helper functions defined outside the node object
 */
function extractHelperFunctions(source) {
    const functions = [];

    // Match function declarations
    const functionRegex = /function\s+(\w+)\s*\([^)]*\)\s*{/g;
    let match;

    while ((match = functionRegex.exec(source)) !== null) {
        const functionName = match[1];
        const startIndex = match.index;
        const functionCode = extractBalancedBraces(source, source.indexOf('{', startIndex));

        functions.push({
            name: functionName,
            code: source.substring(startIndex, source.indexOf('{', startIndex) + functionCode.length)
        });
    }

    return functions;
}

/**
 * Build searchable index
 */
function buildSearchIndex(nodeDocs) {
    const index = {
        nodes: {},
        byCategory: {},
        portIndex: {},
        keywords: {}
    };

    for (const doc of nodeDocs) {
        // Node index
        index.nodes[doc.name] = doc;

        // Category index
        if (doc.category) {
            if (!index.byCategory[doc.category]) {
                index.byCategory[doc.category] = [];
            }
            index.byCategory[doc.category].push(doc.name);
        }

        // Port index (for searching by port name)
        if (doc.inputs) {
            const inputPorts = extractPortNames(doc.inputs.code);
            inputPorts.forEach(portName => {
                if (!index.portIndex[portName]) {
                    index.portIndex[portName] = [];
                }
                index.portIndex[portName].push({
                    node: doc.name,
                    direction: 'input'
                });
            });
        }

        if (doc.outputs) {
            const outputPorts = extractPortNames(doc.outputs.code);
            outputPorts.forEach(portName => {
                if (!index.portIndex[portName]) {
                    index.portIndex[portName] = [];
                }
                index.portIndex[portName].push({
                    node: doc.name,
                    direction: 'output'
                });
            });
        }
    }

    return index;
}

/**
 * Extract port names from inputs/outputs code
 */
function extractPortNames(code) {
    if (!code) return [];

    const portRegex = /(\w+):\s*{/g;
    const ports = [];
    let match;

    while ((match = portRegex.exec(code)) !== null) {
        ports.push(match[1]);
    }

    return ports;
}

/**
 * Parse format hints from port definition code
 * Extracts type, default value, displayName for each port
 * This helps AI understand WHAT FORMAT a port expects without hardcoded education
 */
function parseFormatHints(code) {
    if (!code) return {};

    const hints = {};

    try {
        // Match each port definition block: portName: { ... }
        // Use a more robust regex that handles nested braces
        const portBlockRegex = /(\w+):\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
        let match;

        while ((match = portBlockRegex.exec(code)) !== null) {
            const portName = match[1];
            const portBody = match[2];

            const portHint = {};

            // Extract type: 'string' or type: 'number' etc.
            const typeMatch = portBody.match(/type:\s*['"](\w+)['"]/);
            if (typeMatch) {
                portHint.type = typeMatch[1];
            }

            // Extract displayName
            const displayMatch = portBody.match(/displayName:\s*['"]([^'"]+)['"]/);
            if (displayMatch) {
                portHint.displayName = displayMatch[1];
            }

            // Extract default value - this is KEY for format understanding
            const defaultMatch = portBody.match(/default:\s*(['"][^'"]*['"]|\d+(?:\.\d+)?|true|false|\[[^\]]*\]|\{[^}]*\})/);
            if (defaultMatch) {
                portHint.default = defaultMatch[1];

                // Generate format hint from default value
                const defaultVal = defaultMatch[1];
                if (defaultVal.includes('exp(') || defaultVal.includes('Math.')) {
                    portHint.format_hint = 'Mathematical formula expression (e.g., "exp(-x / 15)")';
                } else if (/^\d+$/.test(defaultVal)) {
                    portHint.format_hint = 'Integer number';
                } else if (/^\d+\.\d+$/.test(defaultVal)) {
                    portHint.format_hint = 'Decimal number';
                } else if (defaultVal.startsWith('[')) {
                    portHint.format_hint = 'Array';
                } else if (defaultVal.startsWith('{')) {
                    portHint.format_hint = 'Object';
                }
            }

            // Check for pattern hints in port names
            if (portName.toLowerCase().includes('formula')) {
                portHint.format_hint = portHint.format_hint || 'Formula expression (NOT a raw string!)';
            }

            if (Object.keys(portHint).length > 0) {
                hints[portName] = portHint;
            }
        }
    } catch (e) {
        console.warn(`[parseFormatHints] Failed to parse: ${e.message}`);
    }

    return hints;
}


/**
 * Find all node source files
 */
function findNodeFiles(dir) {
    const files = [];

    function walk(currentDir) {
        const items = fs.readdirSync(currentDir);

        for (const item of items) {
            const itemPath = path.join(currentDir, item);
            const stat = fs.statSync(itemPath);

            if (stat.isDirectory()) {
                walk(itemPath);
            } else if (item.endsWith('.js') && !item.includes('test') && !item.includes('spec')) {
                files.push(itemPath);
            }
        }
    }

    walk(dir);
    return files;
}

/**
 * Main build function
 */
function build() {
    console.log('📚 Building XGENIA Node Source Documentation...\n');

    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Find all node files from all configured source directories
    let nodeFiles = [];

    for (const sourceDir of NODE_SOURCE_DIRS) {
        if (fs.existsSync(sourceDir)) {
            console.log(`📂 Scanning ${sourceDir}`);
            const files = findNodeFiles(sourceDir);
            nodeFiles = nodeFiles.concat(files);
            console.log(`   Found ${files.length} node files`);
        } else {
            console.log(`⚠️  Directory not found: ${sourceDir}`);
        }
    }

    console.log(`\n   Total: ${nodeFiles.length} node files\n`);


    // Extract documentation from each file
    console.log('🔍 Extracting documentation...');
    const nodeDocs = [];
    let processed = 0;
    let skipped = 0;

    for (const file of nodeFiles) {
        try {
            const doc = extractNodeDocumentation(file);
            if (doc) {
                nodeDocs.push(doc);
                processed++;
                console.log(`   ✅ ${doc.name} (${doc.lineCount} lines)`);
            } else {
                skipped++;
                console.log(`   ⚠️  Skipped ${path.basename(file)}`);
            }
        } catch (error) {
            console.error(`   ❌ Error processing ${path.basename(file)}:`, error.message);
            skipped++;
        }
    }


    console.log(`\n📊 Processed ${processed} nodes, skipped ${skipped}\n`);

    // Build search index
    console.log('🔎 Building search index...');
    const searchIndex = buildSearchIndex(nodeDocs);
    console.log(`   - ${Object.keys(searchIndex.nodes).length} nodes indexed`);
    console.log(`   - ${Object.keys(searchIndex.portIndex).length} unique port names`);
    console.log(`   - ${Object.keys(searchIndex.byCategory).length} categories\n`);

    // Write individual node files (for targeted loading)
    console.log('💾 Writing individual node documentation files...');
    const nodesDir = path.join(OUTPUT_DIR, 'nodes');
    if (!fs.existsSync(nodesDir)) {
        fs.mkdirSync(nodesDir, { recursive: true });
    }

    for (const doc of nodeDocs) {
        const safeName = doc.name.replace(/[\/\\]/g, '_');
        const nodeFile = path.join(nodesDir, `${safeName}.json`);
        fs.writeFileSync(nodeFile, JSON.stringify(doc, null, 2), 'utf-8');
    }
    console.log(`   Written ${nodeDocs.length} node files\n`);

    // Write search index
    console.log('💾 Writing search index...');
    const indexFile = path.join(OUTPUT_DIR, 'search-index.json');
    fs.writeFileSync(indexFile, JSON.stringify(searchIndex, null, 2), 'utf-8');
    console.log(`   Written to ${indexFile}\n`);

    // Write metadata
    const metadata = {
        generatedAt: new Date().toISOString(),
        nodeCount: nodeDocs.length,
        totalLines: nodeDocs.reduce((sum, doc) => sum + doc.lineCount, 0),
        totalBytes: nodeDocs.reduce((sum, doc) => sum + doc.byteSize, 0),
        categories: Object.keys(searchIndex.byCategory),
        sourceDirectories: NODE_SOURCE_DIRS
    };

    const metadataFile = path.join(OUTPUT_DIR, 'metadata.json');
    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2), 'utf-8');

    // Generate TypeScript loader
    console.log('📝 Generating TypeScript loader...');
    generateTypeScriptLoader(OUTPUT_DIR, nodeDocs);

    console.log('\n✅ Done! Node documentation compiled.\n');
    console.log(`📈 Statistics:`);
    console.log(`   - Total nodes: ${nodeDocs.length}`);
    console.log(`   - Total source lines: ${metadata.totalLines.toLocaleString()}`);
    console.log(`   - Total source bytes: ${(metadata.totalBytes / 1024).toFixed(2)} KB`);
    console.log(`   - Unique port names: ${Object.keys(searchIndex.portIndex).length}`);
    console.log(`\n📂 Output directory: ${OUTPUT_DIR}`);
}

/**
 * Generate TypeScript loader for AI tools
 */
function generateTypeScriptLoader(outputDir, nodeDocs) {
    const loaderCode = `/**
 * NODE SOURCE CODE DOCUMENTATION LOADER
 * AUTO-GENERATED - DO NOT EDIT
 * 
 * Generated: ${new Date().toISOString()}
 * 
 * This file provides access to compiled XGENIA node source documentation
 * for AI tools to search and understand node behavior.
 */

import searchIndex from './search-index.json';
import metadata from './metadata.json';

export interface NodeDocumentation {
  name: string;
  file: string;
  relativePath: string;
  inputs: { code: string; startLine: number } | null;
  outputs: { code: string; startLine: number } | null;
  prototypeExtensions: { code: string; startLine: number } | null;
  helpers: Array<{ name: string; code: string }>;
  fullDefinition: string;
  category: string | null;
  docs: string | null;
  lineCount: number;
  byteSize: number;
}

export interface SearchIndex {
  nodes: Record<string, NodeDocumentation>;
  byCategory: Record<string, string[]>;
  portIndex: Record<string, Array<{ node: string; direction: 'input' | 'output' }>>;
}

// Available node types
export const AVAILABLE_NODES = ${JSON.stringify(nodeDocs.map(d => d.name))};

// Load specific node documentation
export async function loadNodeDocs(nodeName: string): Promise<NodeDocumentation | null> {
  try {
    const safeName = nodeName.replace(/[\\/\\\\]/g, '_');
    const doc = await import(\`./nodes/\${safeName}.json\`);
    return doc.default || doc;
  } catch (error) {
    console.error(\`Failed to load docs for \${nodeName}:\`, error);
    return null;
  }
}

// Search capabilities
export function searchByPortName(portName: string): Array<{ node: string; direction: 'input' | 'output' }> {
  return (searchIndex as SearchIndex).portIndex[portName] || [];
}

export function getNodesByCategory(category: string): string[] {
  return (searchIndex as SearchIndex).byCategory[category] || [];
}

export function getAllCategories(): string[] {
  return Object.keys((searchIndex as SearchIndex).byCategory);
}

export function searchNodes(query: string): string[] {
  const lowerQuery = query.toLowerCase();
  return AVAILABLE_NODES.filter(name => 
    name.toLowerCase().includes(lowerQuery)
  );
}

// Metadata
export const DOCUMENTATION_METADATA = metadata;

// Re-export search index for direct access
export { searchIndex };
`;

    const loaderFile = path.join(outputDir, 'index.ts');
    fs.writeFileSync(loaderFile, loaderCode, 'utf-8');
    console.log(`   Generated ${loaderFile}`);
}

// Run build
if (require.main === module) {
    try {
        build();
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

module.exports = { build };
