const { 
  run, 
  removeContainer,
  stopContainer, 
  inspectContainer,
  main
} = require('../../run_utils');

const { 
  imageName, 
  containerName,
  buildPath,
  webAdminPort,
  connectHeaders
} = require('./config'); 

const build = () => run('docker', ['build', '-t', imageName, buildPath]);

const cleanup = () => {

  try {
    run('docker', ['container', 'stop', containerName]);
    console.log('Stopped container');
  }
  catch(error) {}
  
  try {
    run('docker', ['container', 'rm', containerName]);
    console.log('Removed container');
  }
  catch(error) {}
};

const start = () => {

  const container = inspectContainer(containerName);
      
  if (container) {

    if(container.State.Running) {
      console.warn('Restarting server');
    }

    removeContainer(containerName);
  }

  run('docker', [
    'run',
    `--name "${containerName}"`,
    `-e "RABBITMQ_DEFAULT_VHOST=${connectHeaders.host}"`,
    `-e "RABBITMQ_DEFAULT_USER=${connectHeaders.login}"`,
    `-e "RABBITMQ_DEFAULT_PASS=${connectHeaders.passcode}"`,
    '-p 61613:61613',
    '-p 61614:61614',
    '-p 15672:15672',
    '-p 15674:15674',
    '-d',
    imageName
  ]);
};

const stop = () => stopContainer(containerName);

const info = () => {

  console.log(`Management Url: http://localhost:${webAdminPort}/`);

  console.log(`Username: ${connectHeaders.login}`);
  console.log(`Password: ${connectHeaders.passcode}`);
};

main({
  build,
  cleanup, 
  start, 
  stop, 
  info, 
  defaultCommand: start
});
