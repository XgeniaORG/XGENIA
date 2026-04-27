/**
 * RGS Maths Round-Trip Test
 * 
 * This script tests the full pipeline:
 * 1. Feed Zeus node graph → CloudFunctionConverter → evaluate(ctx) script
 * 2. Upload script to maths-deployer
 * 3. Call spin endpoint
 * 4. Verify results
 * 
 * Usage: npx tsx packages/xgenia-runtime/src/api/test-rgs-roundtrip.ts
 */

import { CloudFunctionConverter } from './supabase-converter';

// ─── Helper: map export format to converter format ──────────────────────────
// Project export uses `type` on nodes; CloudFunctionConverter expects `typename`
function mapNode(n: any): any {
    return { ...n, typename: n.type || n.typename, type: undefined };
}

// ─── Zeus Maths Component (from project export) ─────────────────────────────
const zeusExport = {
    name: '/#__maths__/Slot Controller Main ',
    id: 'b002463d-51f4-f6a2-ab85-4a115a12a3fe',
    graph: {
        connections: [
            { fromId: '6fbfac3e-317c-4136-ff5c-874e30341e6b', fromProperty: 'DoInit', toId: 'd4044696-42de-559c-edce-61b93accb5f2', toProperty: 'Do' },
            { fromId: '6fbfac3e-317c-4136-ff5c-874e30341e6b', fromProperty: 'DoInit', toId: '63db6aa0-1d67-0346-ff59-833d7cd75b5a', toProperty: 'Do' },
            { fromId: 'd4044696-42de-559c-edce-61b93accb5f2', fromProperty: 'value', toId: '0e9e9815-7a8b-37ae-2f54-5746079beca4', toProperty: 'seed' },
            { fromId: 'd4044696-42de-559c-edce-61b93accb5f2', fromProperty: 'Done', toId: '0e9e9815-7a8b-37ae-2f54-5746079beca4', toProperty: 'Do' },
            { fromId: 'd4044696-42de-559c-edce-61b93accb5f2', fromProperty: 'Done', toId: 'a6bea429-a096-a7aa-b476-3171c74fcd9c', toProperty: 'Do' },
            { fromId: 'a6bea429-a096-a7aa-b476-3171c74fcd9c', fromProperty: 'normalizedBaseWeights', toId: 'a00b4ff4-e99b-0b36-addb-1dd3928b66fb', toProperty: 'symbolWeights' },
            { fromId: '0e9e9815-7a8b-37ae-2f54-5746079beca4', fromProperty: 'array', toId: 'a00b4ff4-e99b-0b36-addb-1dd3928b66fb', toProperty: 'randomSeeds' },
            { fromId: '0e9e9815-7a8b-37ae-2f54-5746079beca4', fromProperty: 'Done', toId: 'a00b4ff4-e99b-0b36-addb-1dd3928b66fb', toProperty: 'Do' },
            { fromId: 'a00b4ff4-e99b-0b36-addb-1dd3928b66fb', fromProperty: 'reelStrips', toId: 'c85c67f7-449f-3bae-362f-0a6f4b3b294a', toProperty: 'value' },
            { fromId: '6fbfac3e-317c-4136-ff5c-874e30341e6b', fromProperty: 'Spin', toId: '2e1e1309-0409-ebf2-12a5-bb271476e6d3', toProperty: 'Do' },
            { fromId: '2e1e1309-0409-ebf2-12a5-bb271476e6d3', fromProperty: 'value', toId: '0da6c4a6-a74a-5110-8fb6-843d25d96339', toProperty: 'seed' },
            { fromId: '2e1e1309-0409-ebf2-12a5-bb271476e6d3', fromProperty: 'Done', toId: '0da6c4a6-a74a-5110-8fb6-843d25d96339', toProperty: 'Do' },
            { fromId: '0da6c4a6-a74a-5110-8fb6-843d25d96339', fromProperty: 'array', toId: 'e893f8d5-3754-b38f-07bf-45f011489def', toProperty: 'Seeds' },
            { fromId: 'c85c67f7-449f-3bae-362f-0a6f4b3b294a', fromProperty: 'value', toId: 'e893f8d5-3754-b38f-07bf-45f011489def', toProperty: 'reelStrips' },
            { fromId: '0da6c4a6-a74a-5110-8fb6-843d25d96339', fromProperty: 'Done', toId: 'e893f8d5-3754-b38f-07bf-45f011489def', toProperty: 'Do' },
            { fromId: 'e893f8d5-3754-b38f-07bf-45f011489def', fromProperty: 'reels', toId: '0b5dbdc1-42bb-e339-e3d6-d4611424968a', toProperty: 'reels' },
            { fromId: 'e893f8d5-3754-b38f-07bf-45f011489def', fromProperty: 'Done', toId: '0b5dbdc1-42bb-e339-e3d6-d4611424968a', toProperty: 'Do' },
            { fromId: '0b5dbdc1-42bb-e339-e3d6-d4611424968a', fromProperty: 'winningLines', toId: 'dd315e83-4b06-bf73-cb92-2ca4b06ec3d8', toProperty: 'winningLines' },
            { fromId: '0b5dbdc1-42bb-e339-e3d6-d4611424968a', fromProperty: 'paylines', toId: 'dd315e83-4b06-bf73-cb92-2ca4b06ec3d8', toProperty: 'paylines' },
            { fromId: '63db6aa0-1d67-0346-ff59-833d7cd75b5a', fromProperty: 'paytable', toId: 'dd315e83-4b06-bf73-cb92-2ca4b06ec3d8', toProperty: 'paytable' },
            { fromId: '0b5dbdc1-42bb-e339-e3d6-d4611424968a', fromProperty: 'Done', toId: 'dd315e83-4b06-bf73-cb92-2ca4b06ec3d8', toProperty: 'Do' },
            { fromId: 'dd315e83-4b06-bf73-cb92-2ca4b06ec3d8', fromProperty: 'Done', toId: '2e9be4be-9b80-1c0a-60db-84182a2b1fd4', toProperty: 'Do' },
            { fromId: '2e9be4be-9b80-1c0a-60db-84182a2b1fd4', fromProperty: 'finalResult', toId: '6ad0be71-a211-a9f5-7256-f9c0c3d47ef8', toProperty: 'finalResult' },
            { fromId: '2e9be4be-9b80-1c0a-60db-84182a2b1fd4', fromProperty: 'Done', toId: '6ad0be71-a211-a9f5-7256-f9c0c3d47ef8', toProperty: 'Done' },
            { fromId: 'e893f8d5-3754-b38f-07bf-45f011489def', fromProperty: 'reels', toId: '6ad0be71-a211-a9f5-7256-f9c0c3d47ef8', toProperty: 'reels' },
            { fromId: 'e893f8d5-3754-b38f-07bf-45f011489def', fromProperty: 'stopPosList', toId: '6ad0be71-a211-a9f5-7256-f9c0c3d47ef8', toProperty: 'stopPositions' },
            { fromId: 'c85c67f7-449f-3bae-362f-0a6f4b3b294a', fromProperty: 'value', toId: '6ad0be71-a211-a9f5-7256-f9c0c3d47ef8', toProperty: 'reelstrip' },
            { fromId: 'dd315e83-4b06-bf73-cb92-2ca4b06ec3d8', fromProperty: 'Done', toId: '6ad0be71-a211-a9f5-7256-f9c0c3d47ef8', toProperty: 'Done' },
            { fromId: 'a6bea429-a096-a7aa-b476-3171c74fcd9c', fromProperty: 'Done', toId: 'a00b4ff4-e99b-0b36-addb-1dd3928b66fb', toProperty: 'Do' },
            { fromId: 'dd315e83-4b06-bf73-cb92-2ca4b06ec3d8', fromProperty: 'spinWinnings', toId: '2e9be4be-9b80-1c0a-60db-84182a2b1fd4', toProperty: 'spinWinnings' },
            { fromId: 'e893f8d5-3754-b38f-07bf-45f011489def', fromProperty: 'reels', toId: '2e9be4be-9b80-1c0a-60db-84182a2b1fd4', toProperty: 'reels' },
            { fromId: 'e893f8d5-3754-b38f-07bf-45f011489def', fromProperty: 'stopPosList', toId: '2e9be4be-9b80-1c0a-60db-84182a2b1fd4', toProperty: 'stopPosList' },
            { fromId: 'a6bea429-a096-a7aa-b476-3171c74fcd9c', fromProperty: 'normalizedBaseWeights', toId: 'e893f8d5-3754-b38f-07bf-45f011489def', toProperty: 'symbolWeights' },
        ],
        roots: [
            {
                id: '6fbfac3e-317c-4136-ff5c-874e30341e6b',
                type: 'Component Inputs',
                x: 0, y: 0,
                parameters: {
                    ports: [
                        { name: 'DoInit', plug: 'output', type: 'signal' },
                        { name: 'Spin', plug: 'output', type: 'signal' },
                    ],
                },
                ports: [
                    { name: 'Init', plug: 'output', type: { name: 'signal' }, index: 3 },
                    { name: 'DoInit', plug: 'output', type: { name: 'signal' }, index: 1 },
                    { name: 'Spin', plug: 'output', type: { name: 'signal' }, index: 2 },
                ],
                dynamicports: [],
                children: [],
            },
            {
                id: '6ad0be71-a211-a9f5-7256-f9c0c3d47ef8',
                type: 'Component Outputs',
                x: 300, y: 0,
                parameters: {
                    ports: [
                        { name: 'finalResult', plug: 'input', type: '*' },
                        { name: 'Done', plug: 'input', type: 'signal' },
                        { name: 'reels', plug: 'input', type: '*' },
                        { name: 'stopPositions', plug: 'input', type: '*' },
                        { name: 'reelstrip', plug: 'input', type: '*' },
                    ],
                },
                ports: [],
                dynamicports: [],
                children: [],
            },
            {
                id: 'd4044696-42de-559c-edce-61b93accb5f2',
                type: 'True Random Number Generator',
                x: 0, y: 0,
                parameters: { name: 'TRNG_Init', label: 'TRNG_Init' },
                ports: [], dynamicports: [], children: [],
            },
            {
                id: '0e9e9815-7a8b-37ae-2f54-5746079beca4',
                type: 'ISAAC Random Number Array Generator',
                x: 0, y: 0,
                parameters: { size: 100, name: 'ISAAC_Init', label: 'ISAAC_Init' },
                ports: [], dynamicports: [], children: [],
            },
            {
                id: 'a6bea429-a096-a7aa-b476-3171c74fcd9c',
                type: 'Generate Symbol Weights',
                x: 0, y: 0,
                parameters: {
                    numberOfSymbols: 12,
                    weightFormula: 'exp(-x / 15)',
                    name: 'Weights_Gen',
                    label: 'Weights_Gen',
                },
                ports: [],
                dynamicports: [
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight1', displayName: 'Symbol 1 Custom Weight', default: 0.9355069850316178, index: 5 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight2', displayName: 'Symbol 2 Custom Weight', default: 0.8751733190429475, index: 6 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight3', displayName: 'Symbol 3 Custom Weight', default: 0.8187307530779818, index: 7 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight4', displayName: 'Symbol 4 Custom Weight', default: 0.7659283383646487, index: 8 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight5', displayName: 'Symbol 5 Custom Weight', default: 0.7165313105737893, index: 9 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight6', displayName: 'Symbol 6 Custom Weight', default: 0.6703200460356393, index: 10 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight7', displayName: 'Symbol 7 Custom Weight', default: 0.6270890852730562, index: 11 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight8', displayName: 'Symbol 8 Custom Weight', default: 0.5866462195100318, index: 12 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight9', displayName: 'Symbol 9 Custom Weight', default: 0.5488116360940265, index: 13 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight10', displayName: 'Symbol 10 Custom Weight', default: 0.513417119032592, index: 14 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight11', displayName: 'Symbol 11 Custom Weight', default: 0.4803053010897994, index: 15 },
                    { type: 'number', plug: 'input', group: 'Custom Weights', name: 'symbolWeight12', displayName: 'Symbol 12 Custom Weight', default: 0.44932896411722156, index: 16 },
                ],
                children: [],
            },
            {
                id: 'a00b4ff4-e99b-0b36-addb-1dd3928b66fb',
                type: 'Reel Strips Generator',
                x: 0, y: 0,
                parameters: { columnSize: 5, name: 'Strips_Gen', label: 'Strips_Gen' },
                ports: [], dynamicports: [], children: [],
            },
            {
                id: '63db6aa0-1d67-0346-ff59-833d7cd75b5a',
                type: 'Get Paytable',
                x: 0, y: 0,
                parameters: {
                    numberOfSymbols: 12,
                    columnSize: 5,
                    minConsecutiveSymbols: 3,
                    payoutFormula: '2.25 + 0.75 * x',
                    name: 'Paytable_Gen',
                    label: 'Paytable_Gen',
                },
                ports: [],
                dynamicports: [
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout1', displayName: 'Symbol 1 Custom Payout', default: 3, index: 7 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout2', displayName: 'Symbol 2 Custom Payout', default: 3.75, index: 8 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout3', displayName: 'Symbol 3 Custom Payout', default: 4.5, index: 9 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout4', displayName: 'Symbol 4 Custom Payout', default: 5.25, index: 10 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout5', displayName: 'Symbol 5 Custom Payout', default: 6, index: 11 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout6', displayName: 'Symbol 6 Custom Payout', default: 6.75, index: 12 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout7', displayName: 'Symbol 7 Custom Payout', default: 7.5, index: 13 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout8', displayName: 'Symbol 8 Custom Payout', default: 8.25, index: 14 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout9', displayName: 'Symbol 9 Custom Payout', default: 9, index: 15 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout10', displayName: 'Symbol 10 Custom Payout', default: 9.75, index: 16 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout11', displayName: 'Symbol 11 Custom Payout', default: 10.5, index: 17 },
                    { type: 'number', plug: 'input', group: 'Custom Payouts', name: 'symbolPayout12', displayName: 'Symbol 12 Custom Payout', default: 11.25, index: 18 },
                ],
                children: [],
            },
            {
                id: 'c85c67f7-449f-3bae-362f-0a6f4b3b294a',
                type: 'Variable2',
                x: 0, y: 0,
                parameters: {
                    name: 'Strips_Var', label: 'Strips_Var',
                    value: [
                        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2],
                        [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4],
                        [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6],
                        [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8],
                    ],
                },
                ports: [], dynamicports: [], children: [],
            },
            {
                id: '2e1e1309-0409-ebf2-12a5-bb271476e6d3',
                type: 'True Random Number Generator',
                x: 0, y: 0,
                parameters: { name: 'TRNG_Spin', label: 'TRNG_Spin' },
                ports: [], dynamicports: [], children: [],
            },
            {
                id: '0da6c4a6-a74a-5110-8fb6-843d25d96339',
                type: 'ISAAC Random Number Array Generator',
                x: 0, y: 0,
                parameters: { size: 100, name: 'ISAAC_Spin', label: 'ISAAC_Spin' },
                ports: [], dynamicports: [], children: [],
            },
            {
                id: 'e893f8d5-3754-b38f-07bf-45f011489def',
                type: 'Weighted Reels',
                x: 0, y: 0,
                parameters: { rowSize: 3, name: 'Weighted_Reels', label: 'Weighted_Reels' },
                ports: [], dynamicports: [], children: [],
            },
            {
                id: '0b5dbdc1-42bb-e339-e3d6-d4611424968a',
                type: 'Check Wins',
                x: 0, y: 0,
                parameters: {
                    wildSymbol: 5,
                    freeSpinsSymbol: 6,
                    minConsecutiveSymbols: 3,
                    name: 'Check_Wins', label: 'Check_Wins',
                },
                ports: [], dynamicports: [], children: [],
            },
            {
                id: 'dd315e83-4b06-bf73-cb92-2ca4b06ec3d8',
                type: 'Calculate Winnings',
                x: 0, y: 0,
                parameters: { wildSymbol: 5, name: 'Calc_Winnings', label: 'Calc_Winnings' },
                ports: [], dynamicports: [], children: [],
            },
            {
                id: '2e9be4be-9b80-1c0a-60db-84182a2b1fd4',
                type: 'Spin Result',
                x: 0, y: 0,
                parameters: { name: 'Spin_Result', label: 'Spin_Result' },
                ports: [], dynamicports: [], children: [],
            },
        ],
    },
};

// Map export format (type) → converter format (typename) on all root nodes
const zeusMathsComponent = {
    ...zeusExport,
    graph: {
        ...zeusExport.graph,
        roots: zeusExport.graph.roots.map(mapNode),
    },
};

const projectContext = {
    name: 'Beautiful Zeus Style',
    components: [zeusMathsComponent],
};

// ─── Config ──────────────────────────────────────────────────────────────────
const XRGS_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/functions/v1';
const API_KEY = process.env.XRGS_API_KEY || '';
const GAME_ID = process.env.XRGS_GAME_ID || '';

async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  RGS Maths Round-Trip Test');
    console.log('═══════════════════════════════════════════════════════\n');

    // ── Step 1: Generate RGS script from graph ──────────────────────────────
    console.log('Step 1: Converting node graph → evaluate(ctx) script...');
    const converter = new CloudFunctionConverter(
        zeusMathsComponent as any,
        projectContext as any
    );

    const { script, configData } = converter.generateRgsScript();

    console.log(`  ✓ Script generated (${script.length} chars)`);
    console.log(`  ✓ Config data keys: ${Object.keys(configData).join(', ') || '(none)'}`);
    console.log('\n--- Script preview (first 500 chars) ---');
    console.log(script.substring(0, 500));
    console.log('...\n');

    // Save the full script for inspection
    const fs = await import('fs');
    const outPath = '/tmp/zeus-rgs-script.js';
    fs.writeFileSync(outPath, script);
    console.log(`  ✓ Full script saved to ${outPath}\n`);

    if (!API_KEY) {
        console.log('⚠ No XRGS_API_KEY set. Skipping API tests.');
        console.log('  Set: export XRGS_API_KEY=your_key XRGS_GAME_ID=your_game_id');
        console.log('\n--- Script can be manually tested by pasting into maths-deployer ---');
        return;
    }

    // ── Step 2: List games to verify connection ─────────────────────────────
    console.log('Step 2: Verifying RGS connection...');
    const listRes = await fetch(`${XRGS_URL}/maths-deployer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Operator-Key': API_KEY },
        body: JSON.stringify({ action: 'list-games' }),
    });
    const listData = await listRes.json();

    if (listData.error) {
        console.error(`  ✗ Connection failed: ${listData.error}`);
        return;
    }
    console.log(`  ✓ Connected. Games: ${listData.games?.map((g: any) => g.name).join(', ')}`);

    const gameId = GAME_ID || listData.games?.[0]?.id;
    if (!gameId) {
        console.error('  ✗ No game ID available');
        return;
    }
    const game = listData.games?.find((g: any) => g.id === gameId);
    const gameSlug = game?.slug || 'zeus-slot-olympus-v4';
    console.log(`  ✓ Using game: ${game?.name || gameId} (slug: ${gameSlug})\n`);

    // ── Step 3: Upload the script ───────────────────────────────────────────
    console.log('Step 3: Uploading maths script...');
    const uploadRes = await fetch(`${XRGS_URL}/maths-deployer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Operator-Key': API_KEY },
        body: JSON.stringify({
            action: 'upload',
            game_id: gameId,
            maths_mode: 'script',
            script: script,
            config_data: configData,
            declared_rtp: game?.default_rtp || '96.00',
        }),
    });
    const uploadData = await uploadRes.json();

    if (uploadData.error) {
        console.error(`  ✗ Upload failed: ${uploadData.error}`);
        // Try to show more detail
        console.error('  Response:', JSON.stringify(uploadData, null, 2));
        return;
    }
    const mathsConfigId = uploadData.maths_config_id;
    console.log(`  ✓ Uploaded! Version: ${uploadData.version}, Status: ${uploadData.status}`);
    console.log(`  Config ID: ${mathsConfigId}\n`);

    // ── Step 4: Deploy (set to testing) ─────────────────────────────────────
    console.log('Step 4: Deploying config (testing status)...');
    const deployRes = await fetch(`${XRGS_URL}/maths-deployer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Operator-Key': API_KEY },
        body: JSON.stringify({
            action: 'stress-test',
            maths_config_id: mathsConfigId,
        }),
    });
    const deployData = await deployRes.json();

    if (deployData.error) {
        console.error(`  ✗ Stress test failed: ${deployData.error}`);
    } else {
        console.log(`  ✓ Stress test: ${deployData.verdict}, status → ${deployData.status}`);
        if (deployData.tests) {
            for (const [name, result] of Object.entries(deployData.tests)) {
                const r = result as any;
                console.log(`    ${r.passed ? '✓' : '✗'} ${name}${r.measured_rtp ? ` (RTP: ${r.measured_rtp}%)` : ''}`);
            }
        }
        console.log();
    }

    // Step 4b: If stress test passed (status is now 'approved'), deploy to live
    if (deployData.status === 'approved') {
        console.log('Step 4b: Deploying to live...');
        const liveRes = await fetch(`${XRGS_URL}/maths-deployer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Operator-Key': API_KEY },
            body: JSON.stringify({ action: 'deploy', maths_config_id: mathsConfigId }),
        });
        const liveData = await liveRes.json();
        if (liveData.error) {
            console.error(`  ✗ Deploy failed: ${liveData.error}`);
        } else {
            console.log(`  ✓ Deployed to live!\n`);
        }
    }

    // ── Step 5: Run a spin ──────────────────────────────────────────────────
    console.log('Step 5: Running a test spin...');
    const spinRes = await fetch(`${XRGS_URL}/spin`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Operator-Key': API_KEY,
        },
        body: JSON.stringify({
            game_slug: gameSlug,
            bet_amount: 100,        // cents
            currency: 'USD',
            demo: true,             // demo mode — no wallet needed
        }),
    });
    const spinData = await spinRes.json();

    if (spinData.error) {
        console.error(`  ✗ Spin failed: ${spinData.error}`);
        console.error('  Response:', JSON.stringify(spinData, null, 2));
        return;
    }

    console.log('  ✓ Spin completed!');
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  SPIN RESULT');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Win:       ${spinData.win ?? spinData.total_win ?? 'N/A'}`);
    console.log(`  Reels:     ${JSON.stringify(spinData.data?.reels || spinData.reels || 'N/A')}`);
    console.log(`  Round ID:  ${spinData.round_id || 'N/A'}`);

    if (spinData.data?.winningLines?.length) {
        console.log(`  Wins:`);
        for (const line of spinData.data.winningLines) {
            console.log(`    Line ${line.line}: ${JSON.stringify(line.symbols)} → $${line.payout}`);
        }
    } else {
        console.log('  No winning lines this spin');
    }

    console.log('\n  Full response:');
    console.log(JSON.stringify(spinData, null, 2));

    // ── Step 6: Run 10 more spins for stat check ────────────────────────────
    console.log('\n\nStep 6: Running 10 spins for statistics...');
    let totalBet = 0;
    let totalWin = 0;
    let wins = 0;

    for (let i = 0; i < 10; i++) {
        const sr = await fetch(`${XRGS_URL}/spin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Operator-Key': API_KEY },
            body: JSON.stringify({ game_slug: gameSlug, bet_amount: 100, currency: 'USD', demo: true }),
        });
        const sd = await sr.json();
        const w = sd.win ?? sd.total_win ?? 0;
        totalBet += 100;
        totalWin += w;
        if (w > 0) wins++;
        process.stdout.write(`  Spin ${i + 1}: bet=100 win=${w} ${w > 0 ? '✓' : '·'}\n`);
    }

    console.log(`\n  Summary: ${wins}/10 wins, Total bet=${totalBet}, Total win=${totalWin}`);
    console.log(`  Hit rate: ${(wins / 10 * 100).toFixed(1)}%, RTP: ${(totalWin / totalBet * 100).toFixed(1)}%`);
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  ROUND-TRIP TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
