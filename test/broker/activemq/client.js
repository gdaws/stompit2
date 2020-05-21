const { inspectContainer } = require('../../run_utils');

const { 
  containerName, 
  stompPort,
  connectHeaders
} = require('./config'); 

function getConnectionConfig() {
  
  const container = inspectContainer(containerName);

  if (!container) {
    return;
  }

  return {
    host: 'localhost',
    port: stompPort,
    connectHeaders
  };
}

module.exports = {
  getConnectionConfig
};
