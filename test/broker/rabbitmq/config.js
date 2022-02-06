// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

module.exports = {
  imageName: 'stompit2/rabbitmq-server:latest',
  containerName: 'stompit2_rabbitmq_server',
  buildPath: __dirname,
  envFile: path.join(__dirname, '.env'),
  stompPort: 61613,
  stompTlsPort: 61614,
  webStompPort: 15674,
  webAdminPort: 15672,
  connectHeaders: {
    host: '/',
    login: 'guest',
    passcode: 'guest'
  }
};
