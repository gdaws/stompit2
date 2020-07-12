
const {
  stompPort,
  connectHeaders
} = require('./config'); 

function getConnectionConfig() {

  return {
    host: 'localhost',
    port: stompPort,
    connectHeaders
  };
}

module.exports = {
  getConnectionConfig
};
