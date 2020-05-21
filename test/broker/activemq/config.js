
module.exports = {
  imageName: 'stompit2/activemq-server:latest',
  containerName: 'stompit2_activemq_server',
  buildPath: __dirname,
  stompPort: 61613,
  webStompPort: 61614,
  webAdminPort: 8161,
  connectHeaders: {
    host: '/',
    login: 'admin',
    passcode: 'admin'
  }
};
