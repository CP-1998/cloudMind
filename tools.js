// tools.js

// 🔄 Cycle through all nodes and mark them 'pinged'
function cycleNodes(nodeRegistry) {
    const updated = {};
    for (const node in nodeRegistry) {
      updated[node] = {
        ...nodeRegistry[node],
        last_ping: new Date().toISOString(),
        status: 'pinged'
      };
    }
    return updated;
  }
  
  // 🔍 Return a simplified snapshot of all nodes
  function introspectRegistry(nodeRegistry) {
    return Object.entries(nodeRegistry).map(([node, data]) => ({
      node_id: node,
      status: data.status,
      assistant_id_present: !!data.assistant_id
    }));
  }
  
  // 🪞 Return the status of a specific node
  function echoNode(nodeId, nodeRegistry) {
    const node = nodeRegistry[nodeId];
    if (!node) {
      return { error: `Node '${nodeId}' not found.` };
    }
    return {
      node_id: nodeId,
      status: node.status,
      assistant_id_present: !!node.assistant_id,
      timestamp: new Date().toISOString()
    };
  }
  
  module.exports = {
    cycleNodes,
    introspectRegistry,
    echoNode
  };
  