const { 
  run, 
  removeContainer,
  stopContainer, 
  inspectContainer
} = require('../../run_utils');

const { 
  imageName, 
  containerName,
  buildPath,
  envFile,
  webAdminPort,
  connectHeaders
} = require('./config'); 

const command = process.argv[2] || 'start';

try {

  switch (command) {
    
    case 'build': {
      run('docker', ['build', '-t', imageName, buildPath]);
      break;
    }

    case 'cleanup': {

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
      
      break;
    }

    case 'start': {
      
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

      break;
    }
  
    case 'stop':
      stopContainer(containerName);
      break;

    case 'info': {

      console.log(`Management Url: http://localhost:${webAdminPort}/`);

      console.log(`Username: ${connectHeaders.login}`);
      console.log(`Password: ${connectHeaders.passcode}`);

      break;
    }
  }
}
catch(error) {
  process.stderr.write(error.message);
  process.exit(1);
}
