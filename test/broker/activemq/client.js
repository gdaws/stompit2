
const {
  stompPort,
  connectHeaders
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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
