try {
    const pro = require('@xgenia/pro-nodes');
    console.log('SUCCESS: Loaded @xgenia/pro-nodes');
    console.log('Version:', pro.version);
    console.log('Total Nodes:', pro.nodes ? pro.nodes.length : 0);
    console.log('Slot Nodes:', pro.slotGameNodes ? pro.slotGameNodes.length : 0);
    console.log('ML Nodes:', pro.mlNodes ? pro.mlNodes.length : 0);
    console.log('PIXI Nodes:', pro.pixiNodes ? pro.pixiNodes.length : 0);
} catch (e) {
    console.error('FAILURE: Could not load @xgenia/pro-nodes');
    console.error(e);
}
